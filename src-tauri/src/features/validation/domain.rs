//! The sweep itself. Pure-ish: everything operates on data the command
//! layer prefetched, except the per-factory plan/power recomputes which
//! arrive as closures' results. Each check appends `Finding`s; nothing
//! here blocks or mutates.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::features::factory::dto::FactoryMachine;
use crate::features::logistics::dto::{LogisticsLink, TransportPlan};
use crate::features::planner::dto::{PlanGraph, PlanNode};
use crate::features::planner::repo::PlanTargetRow;
use crate::features::resource_nodes::domain::allowed_extractors;
use crate::features::resource_nodes::repo::ClaimRow;
use crate::shared::gamedata::GameData;

use super::dto::{AltToUnlock, Category, FactoryRef, Finding, FindingKind, Severity};

const EPS: f32 = 1e-3;

fn err(category: Category, kind: FindingKind) -> Finding {
    Finding { severity: Severity::Error, category, kind }
}

fn warn(category: Category, kind: FindingKind) -> Finding {
    Finding { severity: Severity::Warning, category, kind }
}

/// Machines whose recipe or building unlocks above the current tier.
/// Deduped per (factory, recipe/building) — twenty banks of the same
/// over-tier recipe is one problem, not twenty.
pub fn check_machines_tier(
    factory: &FactoryRef,
    machines: &[FactoryMachine],
    tier: u8,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
    let mut seen_recipes = HashSet::new();
    let mut seen_buildings = HashSet::new();
    for m in machines {
        if let Some(r) = gd.recipe(&m.recipe_id) {
            if r.unlock_tier > tier && seen_recipes.insert(r.id.clone()) {
                out.push(err(
                    Category::TierGating,
                    FindingKind::MachineRecipeAboveTier {
                        factory_id: factory.factory_id.clone(),
                        factory_name: factory.factory_name.clone(),
                        recipe_id: r.id.clone(),
                        recipe_name: r.name.clone(),
                        unlock_tier: r.unlock_tier,
                    },
                ));
            }
        }
        if let Some(b) = gd.building(&m.building_id) {
            if b.unlock_tier > tier && seen_buildings.insert(b.id.clone()) {
                out.push(err(
                    Category::TierGating,
                    FindingKind::MachineBuildingAboveTier {
                        factory_id: factory.factory_id.clone(),
                        factory_name: factory.factory_name.clone(),
                        building_id: b.id.clone(),
                        building_name: b.name.clone(),
                        unlock_tier: b.unlock_tier,
                    },
                ));
            }
        }
    }
}

/// Locked-alt usage in machine banks. Returns the alt ids found so the
/// caller can fold them into the shopping list. Only tier-reachable
/// alts count — an alt above the current tier is already a TierGating
/// error, and listing it as collectable would mislead.
pub fn check_machines_locked_alts(
    machines: &[FactoryMachine],
    tier: u8,
    unlocked: &HashSet<String>,
    gd: &GameData,
) -> Vec<String> {
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    for m in machines {
        let Some(r) = gd.recipe(&m.recipe_id) else { continue };
        if r.is_alt
            && r.unlock_tier <= tier
            && !unlocked.contains(&r.id)
            && seen.insert(r.id.clone())
        {
            found.push(r.id.clone());
        }
    }
    found
}

/// Plan-graph checks: recipe nodes above tier, locked alts in use.
/// Returns the locked alt ids for the shopping list.
pub fn check_plan_graph(
    factory: &FactoryRef,
    graph: &PlanGraph,
    tier: u8,
    unlocked: &HashSet<String>,
    gd: &GameData,
    out: &mut Vec<Finding>,
) -> Vec<String> {
    let mut locked_alts = Vec::new();
    let mut seen_tier = HashSet::new();
    let mut seen_alt = HashSet::new();
    for node in &graph.nodes {
        let PlanNode::Recipe { recipe_id, recipe_name, is_alt, .. } = node else {
            continue;
        };
        if let Some(r) = gd.recipe(recipe_id) {
            if r.unlock_tier > tier && seen_tier.insert(r.id.clone()) {
                out.push(err(
                    Category::TierGating,
                    FindingKind::PlanRecipeAboveTier {
                        factory_id: factory.factory_id.clone(),
                        factory_name: factory.factory_name.clone(),
                        recipe_id: recipe_id.clone(),
                        recipe_name: recipe_name.clone(),
                        unlock_tier: r.unlock_tier,
                    },
                ));
            }
        }
        if *is_alt && !unlocked.contains(recipe_id) && seen_alt.insert(recipe_id.clone()) {
            locked_alts.push(recipe_id.clone());
        }
    }
    // Per-factory plan warnings ride along with factory context.
    for w in &graph.warnings {
        out.push(warn(
            Category::SupplyPower,
            FindingKind::PlanIssue {
                factory_id: factory.factory_id.clone(),
                factory_name: factory.factory_name.clone(),
                warning: w.clone(),
            },
        ));
    }
    locked_alts
}

/// Claims using an invalid extractor for the node, or one above tier.
pub fn check_claims(
    claims: &HashMap<String, ClaimRow>,
    tier: u8,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
    for (node_id, claim) in claims {
        let Some(miner_id) = claim.miner_id.as_deref() else { continue };
        let Some(node) = gd.node(node_id) else {
            out.push(warn(
                Category::TierGating,
                FindingKind::CheckFailed {
                    area: "claims".to_string(),
                    factory_name: None,
                    reason: format!("claimed node {node_id} is not in the catalog"),
                },
            ));
            continue;
        };
        let resource_name = gd
            .item(&node.resource_item_id)
            .map(|i| i.name.clone())
            .unwrap_or_else(|| node.resource_item_id.clone());
        let allowed = allowed_extractors(node, gd);
        match allowed.iter().find(|e| e.id == miner_id) {
            None => out.push(err(
                Category::TierGating,
                FindingKind::ClaimInvalidExtractor {
                    node_id: node_id.clone(),
                    resource_item_name: resource_name,
                    extractor_id: miner_id.to_string(),
                    allowed_names: allowed.iter().map(|e| e.name.clone()).collect(),
                },
            )),
            Some(e) if e.unlock_tier > tier => out.push(err(
                Category::TierGating,
                FindingKind::ClaimExtractorAboveTier {
                    node_id: node_id.clone(),
                    resource_item_name: resource_name,
                    extractor_id: e.id.clone(),
                    extractor_name: e.name.clone(),
                    unlock_tier: e.unlock_tier,
                },
            )),
            Some(_) => {}
        }
    }
}

/// Links whose transport plan needs a tier the playthrough hasn't
/// reached (recomputed from `min_unlock_tier`, not the stale `locked`
/// flag stored at plan time).
pub fn check_links_tier(
    links: &[LogisticsLink],
    factory_names: &HashMap<String, String>,
    tier: u8,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
    let name = |id: &str| factory_names.get(id).cloned().unwrap_or_else(|| id.to_string());
    for l in links {
        let Ok(plan) = serde_json::from_str::<TransportPlan>(&l.transport_plan_json) else {
            // Legacy/hand-edited rows without a parseable plan aren't a
            // tier violation; the flow checks still cover their rates.
            continue;
        };
        if plan.min_unlock_tier > tier {
            out.push(err(
                Category::TierGating,
                FindingKind::LinkTransportAboveTier {
                    link_id: l.id.clone(),
                    from_factory_name: name(&l.from_factory_id),
                    to_factory_name: name(&l.to_factory_id),
                    item_name: gd
                        .item(&l.item_id)
                        .map(|i| i.name.clone())
                        .unwrap_or_else(|| l.item_id.clone()),
                    transport_kind: l.transport_kind.clone(),
                    min_unlock_tier: plan.min_unlock_tier,
                },
            ));
        }
    }
}

/// Flow consistency: per (source factory, item), links must not draw
/// more than the production-clamped export slice; links for items the
/// source neither plans nor makes in manual machine banks are flagged
/// per link.
///
/// `manual_produced` is (factory, item) pairs coming out of manual
/// machines — legacy factories without a saved plan still legitimately
/// feed links. They satisfy the missing-product check but skip the
/// overdraw math: with no export slice declared there's no stated
/// capacity to enforce against.
pub fn check_flows(
    targets: &[(String, PlanTargetRow)],
    links: &[LogisticsLink],
    manual_produced: &HashSet<(String, String)>,
    factory_names: &HashMap<String, String>,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
    let name = |id: &str| factory_names.get(id).cloned().unwrap_or_else(|| id.to_string());
    let item_name = |id: &str| {
        gd.item(id).map(|i| i.name.clone()).unwrap_or_else(|| id.to_string())
    };

    // Same clamp as the planner's export offers: an export slice larger
    // than the production rate is a wish, not capacity.
    let mut available: HashMap<(String, String), f32> = HashMap::new();
    let mut planned: HashSet<(String, String)> = HashSet::new();
    for (fid, t) in targets {
        planned.insert((fid.clone(), t.item_id.clone()));
        let export = t.export_ipm.unwrap_or(0.0).min(t.ipm).max(0.0);
        *available.entry((fid.clone(), t.item_id.clone())).or_insert(0.0) += export;
    }

    let mut drawn: BTreeMap<(String, String), f32> = BTreeMap::new();
    for l in links {
        let key = (l.from_factory_id.clone(), l.item_id.clone());
        if !planned.contains(&key) {
            if !manual_produced.contains(&key) {
                out.push(err(
                    Category::Flow,
                    FindingKind::LinkSourceMissingProduct {
                        link_id: l.id.clone(),
                        from_factory_id: l.from_factory_id.clone(),
                        from_factory_name: name(&l.from_factory_id),
                        to_factory_name: name(&l.to_factory_id),
                        item_id: l.item_id.clone(),
                        item_name: item_name(&l.item_id),
                    },
                ));
            }
            continue;
        }
        *drawn.entry(key).or_insert(0.0) += l.items_per_minute;
    }

    for ((fid, item), total_drawn) in drawn {
        let avail = *available.get(&(fid.clone(), item.clone())).unwrap_or(&0.0);
        if total_drawn > avail + EPS {
            out.push(err(
                Category::Flow,
                FindingKind::LinkOverdraw {
                    from_factory_id: fid.clone(),
                    from_factory_name: name(&fid),
                    item_id: item.clone(),
                    item_name: item_name(&item),
                    drawn_ipm: total_drawn,
                    available_ipm: avail,
                },
            ));
        }
    }
}

/// Fold per-factory locked-alt hits into findings + the distinct
/// shopping list ("unlock these to build what you planned").
pub fn build_alt_shopping_list(
    hits: &[(FactoryRef, String, bool, bool)], // (factory, recipe_id, in_plan, in_machines)
    gd: &GameData,
    out: &mut Vec<Finding>,
) -> Vec<AltToUnlock> {
    let mut by_recipe: BTreeMap<String, Vec<&(FactoryRef, String, bool, bool)>> = BTreeMap::new();
    for hit in hits {
        by_recipe.entry(hit.1.clone()).or_default().push(hit);
    }
    let mut list = Vec::new();
    for (recipe_id, recipe_hits) in by_recipe {
        let (recipe_name, unlock_tier) = gd
            .recipe(&recipe_id)
            .map(|r| (r.name.clone(), r.unlock_tier))
            .unwrap_or((recipe_id.clone(), 0));
        let mut wanted_by = Vec::new();
        for (factory, _, in_plan, in_machines) in recipe_hits {
            out.push(warn(
                Category::LockedAlts,
                FindingKind::LockedAltInUse {
                    factory_id: factory.factory_id.clone(),
                    factory_name: factory.factory_name.clone(),
                    recipe_id: recipe_id.clone(),
                    recipe_name: recipe_name.clone(),
                    in_plan: *in_plan,
                    in_machines: *in_machines,
                },
            ));
            wanted_by.push(factory.clone());
        }
        list.push(AltToUnlock { recipe_id, recipe_name, unlock_tier, wanted_by });
    }
    list
}
