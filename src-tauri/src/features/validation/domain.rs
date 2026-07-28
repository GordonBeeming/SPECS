//! The sweep itself. Pure-ish: everything operates on data the command
//! layer prefetched, except the per-factory plan/power recomputes which
//! arrive as closures' results. Each check appends `Finding`s; nothing
//! here blocks or mutates.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::features::factory::dto::FactoryMachine;
use crate::features::logistics::dto::{LogisticsLink, TransportPlan};
use crate::features::planner::dto::{PlanGraph, PlanNode};
use crate::features::planner::repo::PlanTargetRow;
use crate::features::power::dto::PowerFuelFlow;
use crate::features::resource_nodes::domain::{allowed_extractors, extractor_output_ipm};
use crate::features::resource_nodes::repo::ClaimRow;
use crate::shared::gamedata::types::{BeltTier, PipeTier};
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

/// Best belt/pipe tier unlocked at `tier`, ranked by capacity. `None`
/// for pipes below Tier 3 (nothing unlocked yet); belts always resolve
/// since Mk1 lands at Tier 0.
fn best_belt_tier(tier: u8, gd: &GameData) -> Option<&BeltTier> {
    gd.belt_tiers().iter().filter(|t| t.unlock_tier <= tier).max_by_key(|t| t.items_per_minute)
}

fn best_pipe_tier(tier: u8, gd: &GameData) -> Option<&PipeTier> {
    gd.pipe_tiers().iter().filter(|t| t.unlock_tier <= tier).max_by_key(|t| t.cubic_meters_per_minute)
}

/// Plan-graph edges (within-factory segments) whose rate exceeds the
/// best belt/pipe tier unlocked at the current playthrough tier.
///
/// Deliberately *not* an error and deliberately not silent about the
/// fix: `N` parallel belts/headers of the best unlocked tier cover the
/// rate just fine — running two Mk3 belts side by side for a 439.5/min
/// line is correct play, not a problem — but the app has the belt/pipe
/// table already and a beginner doesn't, so the count is worth stating
/// instead of leaving the segment rendered identically to a compliant
/// one. Fluids below Tier 3 get a distinct finding: there's no pipe to
/// count multiples of yet.
pub fn check_plan_graph_capacity(
    factory: &FactoryRef,
    graph: &PlanGraph,
    tier: u8,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
    let best_belt = best_belt_tier(tier, gd);
    let best_pipe = best_pipe_tier(tier, gd);
    for edge in &graph.edges {
        if edge.ipm <= EPS {
            continue;
        }
        let is_fluid = gd.item(&edge.item_id).map(|i| i.is_fluid).unwrap_or(false);
        if is_fluid {
            match best_pipe {
                None => out.push(warn(
                    Category::Capacity,
                    FindingKind::FluidSegmentNoPipeAtTier {
                        factory_id: factory.factory_id.clone(),
                        factory_name: factory.factory_name.clone(),
                        item_id: edge.item_id.clone(),
                        item_name: edge.item_name.clone(),
                        ipm: edge.ipm,
                    },
                )),
                Some(p) => {
                    let cap = p.cubic_meters_per_minute as f32;
                    if edge.ipm > cap + EPS {
                        out.push(warn(
                            Category::Capacity,
                            FindingKind::SegmentOverPipeCapacity {
                                factory_id: factory.factory_id.clone(),
                                factory_name: factory.factory_name.clone(),
                                item_id: edge.item_id.clone(),
                                item_name: edge.item_name.clone(),
                                ipm: edge.ipm,
                                pipe_mark: p.mark,
                                pipe_capacity_ipm: cap,
                                pipes_needed: (edge.ipm / cap).ceil() as u32,
                            },
                        ));
                    }
                }
            }
        } else if let Some(b) = best_belt {
            let cap = b.items_per_minute as f32;
            if edge.ipm > cap + EPS {
                out.push(warn(
                    Category::Capacity,
                    FindingKind::SegmentOverBeltCapacity {
                        factory_id: factory.factory_id.clone(),
                        factory_name: factory.factory_name.clone(),
                        item_id: edge.item_id.clone(),
                        item_name: edge.item_name.clone(),
                        ipm: edge.ipm,
                        belt_mark: b.mark,
                        belt_capacity_ipm: cap,
                        belts_needed: (edge.ipm / cap).ceil() as u32,
                    },
                ));
            }
        }
        // `best_belt` is `None` only if the dataset ships no belt tier
        // at all — a data-integrity problem out of scope for a
        // per-segment finding, not a real playthrough state.
    }
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

/// A claimed extractor clocked past what its one output port can carry
/// off the node — a Miner Mk.1 at 250% still only delivers whatever the
/// best belt unlocked at `tier` moves, because the port is a single belt
/// connection and a splitter downstream can only divide what already
/// made it through. Distinct from `check_claims` (which is about
/// legality/tier of the *building*, not throughput) and from
/// `check_plan_graph_capacity`'s segment findings (which are about
/// aggregate flow inside a factory, where running another belt in
/// parallel really does fix it) — so this only ever fires for a claim
/// whose extractor is both a legal pick and tier-reachable, leaving the
/// building-choice advice to `check_claims`.
pub fn check_claim_port_capacity(
    claims: &HashMap<String, ClaimRow>,
    tier: u8,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
    let best_belt = best_belt_tier(tier, gd);
    let best_pipe = best_pipe_tier(tier, gd);
    for (node_id, claim) in claims {
        let Some(extractor_id) = claim.miner_id.as_deref() else { continue };
        let Some(node) = gd.node(node_id) else { continue }; // reported by check_claims
        let allowed = allowed_extractors(node, gd);
        let Some(extractor) = allowed.iter().find(|e| e.id == extractor_id) else { continue };
        if extractor.unlock_tier > tier {
            continue; // reported by check_claims as ClaimExtractorAboveTier
        }
        let output_ipm = extractor_output_ipm(node, Some(extractor_id), claim.clock_pct, gd);
        if output_ipm <= EPS {
            continue;
        }
        let is_fluid = gd.item(&node.resource_item_id).map(|i| i.is_fluid).unwrap_or(false);
        let (cap, mark) = if is_fluid {
            match best_pipe {
                Some(p) => (p.cubic_meters_per_minute as f32, p.mark),
                // No pipe tier unlocked yet: not reachable with the
                // bundled dataset (oil/wells both unlock after Mk1
                // pipes do), but a future dataset could change that —
                // there's no "add a pipe" advice to give here yet, so
                // stay silent rather than invent one.
                None => continue,
            }
        } else {
            match best_belt {
                Some(b) => (b.items_per_minute as f32, b.mark),
                None => continue,
            }
        };
        if output_ipm > cap + EPS {
            let resource_name = gd
                .item(&node.resource_item_id)
                .map(|i| i.name.clone())
                .unwrap_or_else(|| node.resource_item_id.clone());
            // output_ipm scales linearly with clock, so the ratio to the
            // port's capacity carries straight over onto the clock axis.
            // Left un-rounded here on purpose: this is the exact ceiling,
            // and it's the *renderer's* job to floor it to a clock that
            // actually fits (rounding up hands back a value that still
            // overshoots the port).
            let max_fitting_clock_pct = (cap / output_ipm) * claim.clock_pct;
            // Same (resource, purity) bucket, same order Resources lists
            // them in (`list_resource_nodes_impl` walks `gd.nodes()`
            // unsorted) — so this index lines up with the row's own `#N`
            // label without the UI having to fetch the node catalog.
            let node_index = gd
                .nodes()
                .iter()
                .filter(|n| n.resource_item_id == node.resource_item_id && n.purity == node.purity)
                .position(|n| n.id == *node_id)
                .unwrap_or(0) as u32;
            out.push(warn(
                Category::Capacity,
                FindingKind::ClaimOverPortCapacity {
                    node_id: node_id.clone(),
                    resource_item_name: resource_name,
                    node_index,
                    node_x: node.x,
                    node_y: node.y,
                    extractor_name: extractor.name.clone(),
                    output_ipm,
                    capacity_ipm: cap,
                    is_fluid,
                    capacity_mark: mark,
                    max_fitting_clock_pct,
                },
            ));
        }
    }
}

/// Alts ticked "unlocked" on the Alts screen whose own unlock tier is
/// above the playthrough's current one. The screen deliberately doesn't
/// block the tick (warn, don't block — someone may really have found
/// the hard drive early), so this is the safety net that keeps that
/// permissiveness from reading as "everything's fine".
pub fn check_unlocked_alts_tier(
    unlocked: &HashSet<String>,
    tier: u8,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
    for recipe_id in unlocked {
        let Some(r) = gd.recipe(recipe_id) else { continue };
        if r.unlock_tier > tier {
            out.push(warn(
                Category::TierGating,
                FindingKind::UnlockedAltAboveTier {
                    recipe_id: r.id.clone(),
                    recipe_name: r.name.clone(),
                    unlock_tier: r.unlock_tier,
                },
            ));
        }
    }
}

/// ipm per item arriving into `factory_id` via logistics links — the
/// import leg of "total available supply" for `check_generator_supply`.
/// `factory::commands::incoming_link_supply` already computes the same
/// thing straight off the DB connection for the ledger commands, but
/// it's private to that slice and this sweep already has every link
/// loaded once for the whole playthrough, so recomputing the per-factory
/// slice here avoids a second query and a cross-slice visibility change
/// for a three-line fold.
pub fn incoming_link_supply(links: &[LogisticsLink], factory_id: &str) -> HashMap<String, f32> {
    let mut out: HashMap<String, f32> = HashMap::new();
    for link in links {
        if link.to_factory_id == factory_id {
            *out.entry(link.item_id.clone()).or_insert(0.0) += link.items_per_minute;
        }
    }
    out
}

/// Generator fuel/supplemental draw (coal, water, oil...) against a
/// factory's total available supply of the item — `supply` is expected
/// to be claimed-node output *plus* whatever the factory manufactures
/// itself *plus* imports, not claims alone. An item with no claimable
/// node and no producing recipe (Coal, Water) will naturally end up
/// with only the claimed-node figure in there, which is exactly the
/// pre-existing behaviour for those; an item the factory refines itself
/// (Fuel from an Oil Refinery) now has its production counted too,
/// instead of permanently reading as zero.
///
/// Fuel demand never enters the recipe graph the machine-side check
/// (`PlanIssue`'s `RawShort`, forwarded from `check_plan_graph`) walks —
/// a generator bank's coal and water draw is invisible to it, which is
/// exactly how a factory with a real water shortfall validated clean.
/// `machine_raw_demand` is the same supply pool's other claimant, so
/// this compares the *combined* total against supply rather than the
/// generator draw alone: a coal claim shared between a smelter and a
/// generator bank is one pool, not two independent checks.
///
/// Skips an item where the *already-reported* portion of machine demand
/// alone already exceeds supply — that shortfall is already covered
/// (conservatively, since it won't include the generator draw on top)
/// by the forwarded `RawShort` above, and re-reporting it here under a
/// second finding kind would just be noise for the same root cause.
///
/// `machine_demand_reported_elsewhere` is deliberately a *separate* map
/// from `machine_raw_demand`, not a blanket "there's a plan graph"
/// flag: a factory can have both a computed plan graph *and* manual
/// machine rows the graph knows nothing about (plan saves leave
/// `plan_node_key IS NULL` rows untouched), and only the graph's own
/// portion of demand is what `RawShort` actually covers. Gating the
/// skip on the *combined* total once let a manual machine's contribution
/// hide behind a plan graph's unrelated shortfall on the same item —
/// the skip fired even though nothing had reported the manual portion
/// anywhere. Pass an empty map (no reported-elsewhere demand) for a
/// factory with no saved plan.
pub fn check_generator_supply(
    factory: &FactoryRef,
    machine_raw_demand: &HashMap<String, f32>,
    machine_demand_reported_elsewhere: &HashMap<String, f32>,
    fuel_flows: &[PowerFuelFlow],
    supply: &HashMap<String, f32>,
    out: &mut Vec<Finding>,
) {
    for flow in fuel_flows {
        if flow.per_minute <= 0.0 {
            continue;
        }
        let machine_demand = machine_raw_demand.get(&flow.item_id).copied().unwrap_or(0.0);
        let reported_elsewhere =
            machine_demand_reported_elsewhere.get(&flow.item_id).copied().unwrap_or(0.0);
        let claimed = supply.get(&flow.item_id).copied().unwrap_or(0.0);
        if reported_elsewhere > claimed + EPS {
            continue;
        }
        let total_demand = machine_demand + flow.per_minute;
        if total_demand > claimed + EPS {
            out.push(warn(
                Category::SupplyPower,
                FindingKind::GeneratorFuelShort {
                    factory_id: factory.factory_id.clone(),
                    factory_name: factory.factory_name.clone(),
                    item_id: flow.item_id.clone(),
                    item_name: flow.item_name.clone(),
                    demand_ipm: total_demand,
                    claimed_ipm: claimed,
                },
            ));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::planner::dto::PlanEdge;

    fn fref() -> FactoryRef {
        FactoryRef { factory_id: "f1".into(), factory_name: "Coal Power".into() }
    }

    fn fuel_flow(item_id: &str, item_name: &str, per_minute: f32) -> PowerFuelFlow {
        PowerFuelFlow { item_id: item_id.into(), item_name: item_name.into(), is_fluid: false, per_minute }
    }

    #[test]
    fn fourteen_coal_generators_against_zero_claims_flags_both_fuel_and_water() {
        // Pins the exact numbers from the reported bug: 14 Coal
        // Generators at 100% clock draw 14×15 = 210 coal/min and
        // 14×45 = 630 water/min (the real per-generator rates from the
        // dataset), against a factory that claimed neither.
        let fuel_flows = vec![fuel_flow("Desc_Coal_C", "Coal", 210.0), fuel_flow("Desc_Water_C", "Water", 630.0)];
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &HashMap::new(), &mut findings,
        );

        assert_eq!(findings.len(), 2, "got {findings:?}");
        for (item_id, demand) in [("Desc_Coal_C", 210.0_f32), ("Desc_Water_C", 630.0_f32)] {
            let f = findings
                .iter()
                .find(|f| matches!(&f.kind, FindingKind::GeneratorFuelShort { item_id: id, .. } if id == item_id))
                .unwrap_or_else(|| panic!("missing shortfall for {item_id}: {findings:?}"));
            assert_eq!(f.severity, Severity::Warning);
            assert_eq!(f.category, Category::SupplyPower);
            match &f.kind {
                FindingKind::GeneratorFuelShort { demand_ipm, claimed_ipm, .. } => {
                    assert_eq!(*demand_ipm, demand);
                    assert_eq!(*claimed_ipm, 0.0);
                }
                other => panic!("expected GeneratorFuelShort, got {other:?}"),
            }
        }
    }

    #[test]
    fn generator_draw_is_added_to_machine_draw_on_the_same_claimed_pool() {
        // A Foundry burning 45 coal/min for Steel Ingot plus one Coal
        // Generator (15 coal/min) is 60 total against 50 claimed — the
        // machine side alone (45) is fine, so only the combined check
        // catches this.
        let mut machine_demand = HashMap::new();
        machine_demand.insert("Desc_Coal_C".to_string(), 45.0);
        let mut supply = HashMap::new();
        supply.insert("Desc_Coal_C".to_string(), 50.0);
        let fuel_flows = vec![fuel_flow("Desc_Coal_C", "Coal", 15.0)];

        let mut findings = Vec::new();
        check_generator_supply(&fref(), &machine_demand, &machine_demand, &fuel_flows, &supply, &mut findings);

        assert_eq!(findings.len(), 1, "got {findings:?}");
        match &findings[0].kind {
            FindingKind::GeneratorFuelShort { demand_ipm, claimed_ipm, .. } => {
                assert_eq!(*demand_ipm, 60.0);
                assert_eq!(*claimed_ipm, 50.0);
            }
            other => panic!("expected GeneratorFuelShort, got {other:?}"),
        }
    }

    #[test]
    fn machine_demand_already_over_supply_is_not_double_reported_when_a_plan_graph_covers_it() {
        // Machine draw alone (80) already exceeds the 50 claimed — that
        // shortfall belongs to the forwarded `RawShort` finding
        // upstream, but only when the *reported-elsewhere* map says this
        // exact item's demand came from the plan graph. Piling a second,
        // differently-worded finding on the exact same root cause would
        // just be noise.
        let mut machine_demand = HashMap::new();
        machine_demand.insert("Desc_Coal_C".to_string(), 80.0);
        let mut supply = HashMap::new();
        supply.insert("Desc_Coal_C".to_string(), 50.0);
        let fuel_flows = vec![fuel_flow("Desc_Coal_C", "Coal", 15.0)];

        let mut findings = Vec::new();
        check_generator_supply(&fref(), &machine_demand, &machine_demand, &fuel_flows, &supply, &mut findings);
        assert!(findings.is_empty(), "got {findings:?}");
    }

    #[test]
    fn manual_machine_over_supply_still_reports_when_nothing_else_covers_it() {
        // Codex P1: a factory with manual machine rows and no saved plan
        // graph has no `RawShort` check anywhere — the plan-graph skip
        // above would silently drop this shortage instead of deferring
        // it to a finding that doesn't exist. Same numbers as the
        // plan-graph test, but an empty reported-elsewhere map must
        // still produce the combined shortfall.
        let mut machine_demand = HashMap::new();
        machine_demand.insert("Desc_Coal_C".to_string(), 80.0);
        let mut supply = HashMap::new();
        supply.insert("Desc_Coal_C".to_string(), 50.0);
        let fuel_flows = vec![fuel_flow("Desc_Coal_C", "Coal", 15.0)];

        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &machine_demand, &HashMap::new(), &fuel_flows, &supply, &mut findings,
        );
        assert_eq!(findings.len(), 1, "got {findings:?}");
        match &findings[0].kind {
            FindingKind::GeneratorFuelShort { demand_ipm, claimed_ipm, .. } => {
                assert_eq!(*demand_ipm, 95.0, "80 machine + 15 generator");
                assert_eq!(*claimed_ipm, 50.0);
            }
            other => panic!("expected GeneratorFuelShort, got {other:?}"),
        }
    }

    #[test]
    fn manual_demand_still_reports_even_when_the_graphs_own_demand_is_covered_elsewhere() {
        // Codex P1, round 3: a factory can have both a saved plan graph
        // *and* manual machine rows the graph knows nothing about.
        // Before this, the skip was keyed off a blanket "there's a plan
        // graph" flag, so a manual machine's contribution could hide
        // behind the graph's own (unrelated, already-covered) demand on
        // the same item. The graph's own 30 coal/min is within the 50
        // claimed (no RawShort, so `reported_elsewhere` for it is empty)
        // — a manual machine adding 30 more must still surface: 60
        // combined against 50 claimed.
        let mut machine_demand = HashMap::new();
        machine_demand.insert("Desc_Coal_C".to_string(), 60.0); // 30 graph + 30 manual, merged
        let reported_elsewhere = HashMap::new(); // graph's own 30 never exceeded supply alone
        let mut supply = HashMap::new();
        supply.insert("Desc_Coal_C".to_string(), 50.0);
        let fuel_flows = vec![fuel_flow("Desc_Coal_C", "Coal", 1.0)];

        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &machine_demand, &reported_elsewhere, &fuel_flows, &supply, &mut findings,
        );
        assert_eq!(findings.len(), 1, "got {findings:?}");
        match &findings[0].kind {
            FindingKind::GeneratorFuelShort { demand_ipm, claimed_ipm, .. } => {
                assert_eq!(*demand_ipm, 61.0, "60 combined machine demand + 1 generator");
                assert_eq!(*claimed_ipm, 50.0);
            }
            other => panic!("expected GeneratorFuelShort, got {other:?}"),
        }
    }

    #[test]
    fn sufficient_supply_produces_no_finding() {
        let fuel_flows = vec![fuel_flow("Desc_Coal_C", "Coal", 210.0)];
        let mut supply = HashMap::new();
        supply.insert("Desc_Coal_C".to_string(), 300.0);
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &supply, &mut findings,
        );
        assert!(findings.is_empty(), "got {findings:?}");
    }

    fn plan_edge(item_id: &str, item_name: &str, ipm: f32) -> PlanEdge {
        PlanEdge {
            id: format!("e-{item_id}"),
            from_node: "raw:x".into(),
            to_node: "recipe:x".into(),
            item_id: item_id.into(),
            item_name: item_name.into(),
            ipm,
            is_reuse: false,
        }
    }

    fn empty_graph(edges: Vec<PlanEdge>) -> PlanGraph {
        PlanGraph { edges, ..PlanGraph::default() }
    }

    #[test]
    fn belt_segment_over_tier0_cap_flags_belts_needed() {
        // The reported Tier 0 case: a Pure iron node on Mk1 at 100%
        // yields 120/min feeding a 90/min segment — either way, above
        // the 60/min Mk1 cap, the only belt Tier 0 has.
        let gd = GameData::from_bundled().unwrap();
        let graph = empty_graph(vec![plan_edge("Desc_OreIron_C", "Iron Ore", 90.0)]);
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &graph, 0, &gd, &mut findings);

        assert_eq!(findings.len(), 1, "got {findings:?}");
        match &findings[0].kind {
            FindingKind::SegmentOverBeltCapacity {
                belt_mark, belt_capacity_ipm, belts_needed, ipm, ..
            } => {
                assert_eq!(*belt_mark, 1);
                assert_eq!(*belt_capacity_ipm, 60.0);
                assert_eq!(*belts_needed, 2);
                assert_eq!(*ipm, 90.0);
            }
            other => panic!("expected SegmentOverBeltCapacity, got {other:?}"),
        }
        assert_eq!(findings[0].category, Category::Capacity);
    }

    #[test]
    fn belt_segment_within_cap_is_silent() {
        let gd = GameData::from_bundled().unwrap();
        let graph = empty_graph(vec![plan_edge("Desc_OreIron_C", "Iron Ore", 60.0)]);
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &graph, 0, &gd, &mut findings);
        assert!(findings.is_empty(), "got {findings:?}");
    }

    #[test]
    fn fluid_segment_before_any_pipe_tier_flags_no_pipe_available() {
        // Mk1 pipes unlock at Tier 3 — a fluid segment at Tier 0 can't
        // be moved at all yet, not even by adding more of something.
        let gd = GameData::from_bundled().unwrap();
        let graph = empty_graph(vec![plan_edge("Desc_Water_C", "Water", 30.0)]);
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &graph, 0, &gd, &mut findings);

        assert_eq!(findings.len(), 1, "got {findings:?}");
        assert!(matches!(&findings[0].kind, FindingKind::FluidSegmentNoPipeAtTier { ipm, .. } if *ipm == 30.0));
    }

    #[test]
    fn fluid_segment_over_mk1_pipe_cap_flags_pipes_needed() {
        // The reported Tier 4 case: 630 m³/min against a 300 m³/min
        // Mk1 pipe cap (Mk1 is still the best unlocked at Tier 4 — Mk2
        // lands at Tier 6).
        let gd = GameData::from_bundled().unwrap();
        let graph = empty_graph(vec![plan_edge("Desc_Water_C", "Water", 630.0)]);
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &graph, 4, &gd, &mut findings);

        assert_eq!(findings.len(), 1, "got {findings:?}");
        match &findings[0].kind {
            FindingKind::SegmentOverPipeCapacity {
                pipe_mark, pipe_capacity_ipm, pipes_needed, ipm, ..
            } => {
                assert_eq!(*pipe_mark, 1);
                assert_eq!(*pipe_capacity_ipm, 300.0);
                assert_eq!(*pipes_needed, 3);
                assert_eq!(*ipm, 630.0);
            }
            other => panic!("expected SegmentOverPipeCapacity, got {other:?}"),
        }
    }

    #[test]
    fn fluid_segment_within_pipe_cap_is_silent() {
        let gd = GameData::from_bundled().unwrap();
        let graph = empty_graph(vec![plan_edge("Desc_Water_C", "Water", 300.0)]);
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &graph, 4, &gd, &mut findings);
        assert!(findings.is_empty(), "got {findings:?}");
    }

    // ---------- extractor port-capacity tests (#82) ----------

    use crate::shared::gamedata::types::NodePurity;

    fn extractor_claim(node_id: &str, miner: &str, clock: f32) -> ClaimRow {
        ClaimRow {
            node_id: node_id.to_string(),
            miner_id: Some(miner.to_string()),
            clock_pct: clock,
            factory_id: None,
            notes: None,
            created_at: "n".into(),
            updated_at: "n".into(),
        }
    }

    #[test]
    fn miner_mk1_pure_at_250_pct_exceeds_the_tier1_belt_port_and_names_the_fitting_clock() {
        // The reported case: a Miner Mk.1 on a Pure node clocked to 250%
        // reports 300/min, but Tier 1's only belt (Mk1) carries 60/min
        // off the port. 60/300 × 250% = 50% is the clock that fits.
        let gd = GameData::from_bundled().unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C" && n.purity == NodePurity::Pure)
            .expect("a pure iron node exists");
        let mut claims = HashMap::new();
        claims.insert(iron.id.clone(), extractor_claim(&iron.id, "Build_MinerMk1_C", 250.0));

        let mut findings = Vec::new();
        check_claim_port_capacity(&claims, 1, &gd, &mut findings);

        assert_eq!(findings.len(), 1, "got {findings:?}");
        assert_eq!(findings[0].severity, Severity::Warning);
        assert_eq!(findings[0].category, Category::Capacity);
        match &findings[0].kind {
            FindingKind::ClaimOverPortCapacity {
                output_ipm, capacity_ipm, capacity_mark, is_fluid, max_fitting_clock_pct, ..
            } => {
                assert!((*output_ipm - 300.0).abs() < 0.01);
                assert!((*capacity_ipm - 60.0).abs() < 0.01);
                assert_eq!(*capacity_mark, 1);
                assert!(!*is_fluid);
                assert!((*max_fitting_clock_pct - 50.0).abs() < 0.01, "got {max_fitting_clock_pct}");
            }
            other => panic!("expected ClaimOverPortCapacity, got {other:?}"),
        }
    }

    #[test]
    fn miner_mk3_pure_quartz_at_250_pct_names_the_node_and_leaves_the_ratio_unrounded() {
        // Regression for #101: 780/1200 × 250% = 162.5 exactly, a value
        // that doesn't divide evenly — unlike the Mk1/pure-iron case
        // above (250% → 50.0%), which would pass whether the renderer
        // rounds or floors. The domain layer keeps the exact ratio;
        // flooring it to a clock that actually fits is `ValidationPanel`'s
        // job (163% still overshoots the port at 782.4/min).
        let gd = GameData::from_bundled().unwrap();
        let quartz_nodes: Vec<_> = gd
            .nodes()
            .iter()
            .filter(|n| n.resource_item_id == "Desc_RawQuartz_C" && n.purity == NodePurity::Pure)
            .collect();
        let quartz = quartz_nodes.first().expect("a pure raw quartz node exists");
        let mut claims = HashMap::new();
        claims.insert(quartz.id.clone(), extractor_claim(&quartz.id, "Build_MinerMk3_C", 250.0));

        let mut findings = Vec::new();
        check_claim_port_capacity(&claims, 8, &gd, &mut findings);

        assert_eq!(findings.len(), 1, "got {findings:?}");
        match &findings[0].kind {
            FindingKind::ClaimOverPortCapacity {
                output_ipm,
                capacity_ipm,
                capacity_mark,
                max_fitting_clock_pct,
                node_index,
                node_x,
                node_y,
                ..
            } => {
                assert!((*output_ipm - 1200.0).abs() < 0.01);
                assert!((*capacity_ipm - 780.0).abs() < 0.01);
                assert_eq!(*capacity_mark, 5);
                assert!(
                    (*max_fitting_clock_pct - 162.5).abs() < 0.01,
                    "got {max_fitting_clock_pct}"
                );
                assert_eq!(*node_index, 0);
                assert!((*node_x - quartz.x).abs() < 0.01);
                assert!((*node_y - quartz.y).abs() < 0.01);
            }
            other => panic!("expected ClaimOverPortCapacity, got {other:?}"),
        }
    }

    #[test]
    fn second_node_in_the_same_bucket_gets_the_next_index() {
        // The whole point of `node_index`: two claimed nodes of the same
        // resource + purity must not both read as "node #1".
        let gd = GameData::from_bundled().unwrap();
        let quartz_nodes: Vec<_> = gd
            .nodes()
            .iter()
            .filter(|n| n.resource_item_id == "Desc_RawQuartz_C" && n.purity == NodePurity::Pure)
            .collect();
        let second = quartz_nodes.get(1).expect("at least two pure raw quartz nodes exist");
        let mut claims = HashMap::new();
        claims.insert(second.id.clone(), extractor_claim(&second.id, "Build_MinerMk3_C", 250.0));

        let mut findings = Vec::new();
        check_claim_port_capacity(&claims, 8, &gd, &mut findings);

        assert_eq!(findings.len(), 1, "got {findings:?}");
        match &findings[0].kind {
            FindingKind::ClaimOverPortCapacity { node_index, .. } => {
                assert_eq!(*node_index, 1, "got {node_index}");
            }
            other => panic!("expected ClaimOverPortCapacity, got {other:?}"),
        }
    }

    #[test]
    fn miner_mk1_normal_at_100_pct_exactly_fills_the_mk1_belt_and_is_silent() {
        // 60 base × 1.0 (Normal) × 100% = 60 — exactly the Mk1 belt's
        // capacity, not over it.
        let gd = GameData::from_bundled().unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C" && n.purity == NodePurity::Normal)
            .expect("a normal iron node exists");
        let mut claims = HashMap::new();
        claims.insert(iron.id.clone(), extractor_claim(&iron.id, "Build_MinerMk1_C", 100.0));

        let mut findings = Vec::new();
        check_claim_port_capacity(&claims, 0, &gd, &mut findings);
        assert!(findings.is_empty(), "got {findings:?}");
    }

    #[test]
    fn above_tier_extractor_is_left_to_check_claims_not_double_reported() {
        // A Mk2 claimed at Tier 0 (Mk2 unlocks at T4) is already an error
        // from `check_claims` — the port-capacity check has nothing
        // useful to add ("underclock" doesn't fix "you can't build this
        // yet") so it stays silent rather than piling on.
        let gd = GameData::from_bundled().unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .expect("an iron node exists");
        let mut claims = HashMap::new();
        claims.insert(iron.id.clone(), extractor_claim(&iron.id, "Build_MinerMk2_C", 100.0));

        let mut findings = Vec::new();
        check_claim_port_capacity(&claims, 0, &gd, &mut findings);
        assert!(findings.is_empty(), "got {findings:?}");
    }

    #[test]
    fn invalid_extractor_id_is_left_to_check_claims_not_double_reported() {
        let gd = GameData::from_bundled().unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .expect("an iron node exists");
        let mut claims = HashMap::new();
        claims.insert(iron.id.clone(), extractor_claim(&iron.id, "Build_MadeUpMiner_C", 100.0));

        let mut findings = Vec::new();
        check_claim_port_capacity(&claims, 9, &gd, &mut findings);
        assert!(findings.is_empty(), "got {findings:?}");
    }

    #[test]
    fn oil_extractor_pure_at_100_pct_is_within_the_mk1_pipe_cap() {
        // Pins the issue's own "nothing violates today" note: an Oil
        // Extractor on a Pure seep is 240 m³/min against the Mk1 pipe's
        // 300 — checked for symmetry and future datasets, silent today.
        let gd = GameData::from_bundled().unwrap();
        let oil = gd
            .nodes()
            .iter()
            .find(|n| {
                n.resource_item_id == "Desc_LiquidOil_C"
                    && n.kind == crate::shared::gamedata::types::NodeKind::MinerNode
                    && n.purity == NodePurity::Pure
            })
            .expect("a pure oil seep exists");
        let mut claims = HashMap::new();
        claims.insert(oil.id.clone(), extractor_claim(&oil.id, "Build_OilPump_C", 100.0));

        let mut findings = Vec::new();
        check_claim_port_capacity(&claims, 9, &gd, &mut findings);
        assert!(findings.is_empty(), "got {findings:?}");
    }
}
