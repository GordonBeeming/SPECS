//! The sweep itself. Pure-ish: everything operates on data the command
//! layer prefetched, except the per-factory plan/power recomputes which
//! arrive as closures' results. Each check appends `Finding`s; nothing
//! here blocks or mutates.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::features::factory::dto::FactoryMachine;
use crate::features::logistics::dto::{LogisticsLink, TransportPlan};
use crate::features::planner::domain::{export_slice_ipm, FLOW_EPS_IPM};
use crate::features::planner::dto::{PlanGraph, PlanNode};
use crate::features::planner::repo::PlanTargetRow;
use crate::features::power::dto::PowerFuelFlow;
use crate::features::resource_nodes::domain::{
    allowed_extractors, best_belt_tier, best_pipe_tier, extractor_output_ipm, port_capacity,
    PortCapacity,
};
use crate::features::resource_nodes::repo::ClaimRow;
use crate::shared::gamedata::GameData;

use super::dto::{AltToUnlock, Category, FactoryRef, Finding, FindingKind, Severity};

/// The sweep compares flows the planner produced, so it has to use the
/// planner's tolerance — a stricter one here would report a plan the
/// planner considers balanced as overdrawn.
const EPS: f32 = FLOW_EPS_IPM;

fn err(category: Category, kind: FindingKind) -> Finding {
    Finding { severity: Severity::Error, category, kind }
}

fn warn(category: Category, kind: FindingKind) -> Finding {
    Finding { severity: Severity::Warning, category, kind }
}

fn note(category: Category, kind: FindingKind) -> Finding {
    Finding { severity: Severity::Info, category, kind }
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

/// Plan-graph capacity, in two passes with two different severities,
/// because "this line carries more than one belt" and "this line
/// *cannot be built*" are different findings that happen to share
/// arithmetic.
///
/// **Pass one — machine output ports, warnings.** A machine has one
/// output port per item it makes, exactly as a miner does, and a
/// splitter after the port can only divide what already came through.
/// So a bank's per-machine rate (`output ÷ machine_count`) above the
/// best carrier unlocked is unbuildable at any belt count: the fixes
/// are a lower clock or the same output spread over more machines,
/// both of which the app then reads as fixed. Several recipes reach
/// this from one machine at stock clock — Biomass (Wood) is 300/min
/// against Tier 0's 60/min belt, Steel Screws 260/min against Tier 3's
/// 120 — a live case, not a theoretical one.
///
/// The bank is the right unit, not the edge. One machine feeding two
/// consumers splits into two under-cap edges while its single port
/// still carries the sum, so an edge-level test would wave it through.
///
/// **Pass two — segments, notes.** What's left is aggregate flow: `N`
/// parallel belts/headers of the best unlocked tier carry it, which is
/// ordinary play, and the segment reads the same rate before and after
/// they go down, so a warning here could never be cleared. The count
/// still earns a row — the app has the belt/pipe table and a beginner
/// doesn't. Segments a pass-one warning already covers are skipped:
/// "lay two belts" isn't an available move when there's one port to
/// attach them to, and the warning carries the fix that is.
///
/// Extractor ports are the same physical rule one layer out, and stay
/// with `check_claim_port_capacity` — it works from the claims, so it
/// knows the extractor's clock and can name the node.
///
/// Fluids below Tier 3 get a distinct finding and keep warning
/// severity: with no pipe unlocked there's no multiple to lay, and the
/// fix (reach Tier 3) is real and observable here.
pub fn check_plan_graph_capacity(
    factory: &FactoryRef,
    graph: &PlanGraph,
    tier: u8,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
    let best_belt = best_belt_tier(tier, gd);
    let best_pipe = best_pipe_tier(tier, gd);
    // `None` means no carrier is unlocked for that state of matter yet,
    // never a capacity of zero — below Tier 3 there is no pipe to
    // measure a fluid against, and `FluidSegmentNoPipeAtTier` is the
    // finding that covers it.
    let carrier_for = |item_id: &str| -> Option<Carrier> {
        let is_fluid = gd.item(item_id).map(|i| i.is_fluid).unwrap_or(false);
        if is_fluid {
            best_pipe.map(|p| Carrier {
                cap: p.cubic_meters_per_minute as f32,
                mark: p.mark,
                is_fluid,
            })
        } else {
            best_belt.map(|b| Carrier { cap: b.items_per_minute as f32, mark: b.mark, is_fluid })
        }
    };

    // (node_key, item_id) pairs whose port is already reported as
    // unbuildable, so pass two doesn't offer parallel belts for them.
    let mut over_port: HashSet<(&str, &str)> = HashSet::new();
    for node in &graph.nodes {
        let PlanNode::Recipe {
            node_key,
            recipe_name,
            building_name,
            machine_count,
            clock_pct,
            outputs,
            ..
        } = node
        else {
            continue;
        };
        // A bank is never zero machines in a computed plan, but the
        // division below has to hold for a hand-edited saved graph too.
        if *machine_count < 1 {
            continue;
        }
        for flow in outputs {
            if flow.per_minute <= EPS {
                continue;
            }
            let Some(carrier) = carrier_for(&flow.item_id) else { continue };
            let per_machine_ipm = flow.per_minute / *machine_count as f32;
            if per_machine_ipm <= carrier.cap + EPS {
                continue;
            }
            over_port.insert((node_key.as_str(), flow.item_id.as_str()));
            out.push(warn(
                Category::Capacity,
                FindingKind::MachineOverPortCapacity {
                    factory_id: factory.factory_id.clone(),
                    factory_name: factory.factory_name.clone(),
                    node_key: node_key.clone(),
                    recipe_name: recipe_name.clone(),
                    building_name: building_name.clone(),
                    item_id: flow.item_id.clone(),
                    item_name: flow.item_name.clone(),
                    machine_count: *machine_count,
                    per_machine_ipm,
                    capacity_ipm: carrier.cap,
                    capacity_mark: carrier.mark,
                    is_fluid: carrier.is_fluid,
                    // Output scales linearly with clock, so the ratio to
                    // the cap carries straight onto the clock axis.
                    max_fitting_clock_pct: (carrier.cap / per_machine_ipm) * clock_pct,
                    // Splitting the same total output over this many
                    // machines puts every port at or under the cap.
                    machines_needed: (flow.per_minute / carrier.cap).ceil() as i64,
                },
            ));
        }
    }

    for edge in &graph.edges {
        if edge.ipm <= EPS {
            continue;
        }
        if over_port.contains(&(edge.from_node.as_str(), edge.item_id.as_str())) {
            continue;
        }
        let Some(carrier) = carrier_for(&edge.item_id) else {
            // Reachable only for a fluid: `best_belt` is `None` just
            // when the dataset ships no belt tier at all, which is a
            // data-integrity problem rather than a playthrough state.
            if gd.item(&edge.item_id).map(|i| i.is_fluid).unwrap_or(false) {
                out.push(warn(
                    Category::Capacity,
                    FindingKind::FluidSegmentNoPipeAtTier {
                        factory_id: factory.factory_id.clone(),
                        factory_name: factory.factory_name.clone(),
                        item_id: edge.item_id.clone(),
                        item_name: edge.item_name.clone(),
                        ipm: edge.ipm,
                    },
                ));
            }
            continue;
        };
        if edge.ipm <= carrier.cap + EPS {
            continue;
        }
        let needed = (edge.ipm / carrier.cap).ceil() as u32;
        out.push(note(
            Category::Capacity,
            if carrier.is_fluid {
                FindingKind::SegmentOverPipeCapacity {
                    factory_id: factory.factory_id.clone(),
                    factory_name: factory.factory_name.clone(),
                    item_id: edge.item_id.clone(),
                    item_name: edge.item_name.clone(),
                    ipm: edge.ipm,
                    pipe_mark: carrier.mark,
                    pipe_capacity_ipm: carrier.cap,
                    pipes_needed: needed,
                }
            } else {
                FindingKind::SegmentOverBeltCapacity {
                    factory_id: factory.factory_id.clone(),
                    factory_name: factory.factory_name.clone(),
                    item_id: edge.item_id.clone(),
                    item_name: edge.item_name.clone(),
                    ipm: edge.ipm,
                    belt_mark: carrier.mark,
                    belt_capacity_ipm: carrier.cap,
                    belts_needed: needed,
                }
            },
        ));
    }
}

/// What one belt or pipe of the best tier unlocked carries, resolved
/// per item so a solid and a fluid on the same graph each measure
/// against their own carrier.
struct Carrier {
    cap: f32,
    mark: u8,
    is_fluid: bool,
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
///
/// Reads the **raw** `extractor_output_ipm`, never the port-capped
/// `extractor_deliverable_ipm` that factory supply is derived from —
/// the whole check is "raw exceeds cap", so feeding it the capped
/// figure would make the test `cap > cap` and retire the warning with
/// every test still green. The raw rate is also the honest thing to
/// show the player: they're paying hardware and power for it.
pub fn check_claim_port_capacity(
    claims: &HashMap<String, ClaimRow>,
    tier: u8,
    gd: &GameData,
    out: &mut Vec<Finding>,
) {
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
        // Same resolution `extractor_deliverable_ipm` caps against, so
        // the warning and the supply figure can never disagree about
        // where the ceiling sits. `None` (no pipe unlocked yet) means
        // there's no cap to state and no "add a pipe" advice to give —
        // deliverable leaves the rate uncapped there for the same
        // reason this stays silent.
        let Some(PortCapacity { ipm: cap, mark, is_fluid }) = port_capacity(node, tier, gd) else {
            continue;
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
                    node_purity: node.purity,
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
///
/// A fuel is exempt from the claims comparison when **both** halves
/// hold: this factory reports no supply for it at all, *and* no
/// arrangement of extractors and machines could ever give it any
/// (`no_automated_supply`, from `tier::items_with_no_automated_supply`).
/// Then "claims cover 0.0" is not a shortfall — there is no number the
/// app could ever print there — so it comes back as an `Info` note
/// carrying the burn rate and no claimed figure.
///
/// **Neither half works alone, and both have been tried.** Gating on
/// the item's chain by itself exempts a Fuel Generator drinking
/// 270/min of Liquid Biofuel against 60/min piped in, which is a real
/// shortfall the player built and can close. Gating on "the player
/// picks it up off the ground" by itself leaves a Tier 0 Biomass
/// Burner warned about Biomass — machine-made, and permanently
/// unsuppliable, because every recipe for it starts at Wood. The
/// closable ones are the ones with a supply figure to compare against.
///
/// Zero-supply-and-never-suppliable is also why the note doesn't tell
/// the player to go build something: the Constructor that would
/// "close" a Biomass gap has to be hand-fed Wood itself, so the advice
/// would just move the hand-feeding one link along.
pub fn check_generator_supply(
    factory: &FactoryRef,
    machine_raw_demand: &HashMap<String, f32>,
    machine_demand_reported_elsewhere: &HashMap<String, f32>,
    fuel_flows: &[PowerFuelFlow],
    supply: &HashMap<String, f32>,
    no_automated_supply: &HashSet<String>,
    out: &mut Vec<Finding>,
) {
    for flow in fuel_flows {
        if flow.per_minute <= 0.0 {
            continue;
        }
        let available = supply.get(&flow.item_id).copied().unwrap_or(0.0);
        if available <= EPS && no_automated_supply.contains(&flow.item_id) {
            out.push(note(
                Category::SupplyPower,
                FindingKind::GeneratorFuelHandGathered {
                    factory_id: factory.factory_id.clone(),
                    factory_name: factory.factory_name.clone(),
                    item_id: flow.item_id.clone(),
                    item_name: flow.item_name.clone(),
                    demand_ipm: flow.per_minute,
                },
            ));
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

    let mut available: HashMap<(String, String), f32> = HashMap::new();
    let mut planned: HashSet<(String, String)> = HashSet::new();
    for (fid, t) in targets {
        planned.insert((fid.clone(), t.item_id.clone()));
        let export = export_slice_ipm(t.export_ipm, t.ipm);
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
    use crate::features::planner::dto::{PlanEdge, RecipeFlow};

    fn fref() -> FactoryRef {
        FactoryRef { factory_id: "f1".into(), factory_name: "Coal Power".into() }
    }

    fn fuel_flow(item_id: &str, item_name: &str, per_minute: f32) -> PowerFuelFlow {
        PowerFuelFlow { item_id: item_id.into(), item_name: item_name.into(), is_fluid: false, per_minute }
    }

    fn fluid_fuel_flow(item_id: &str, item_name: &str, per_minute: f32) -> PowerFuelFlow {
        PowerFuelFlow { item_id: item_id.into(), item_name: item_name.into(), is_fluid: true, per_minute }
    }

    /// The real set, so these tests exercise the same membership the
    /// sweep does rather than a hand-picked stand-in.
    fn stranded() -> HashSet<String> {
        crate::features::planner::tier::items_with_no_automated_supply(&GameData::from_bundled().expect("bundled"))
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
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &HashMap::new(), &stranded(),
            &mut findings,
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
    fn a_hand_fed_burner_reports_its_burn_rate_instead_of_a_shortfall() {
        // A Tier 0 Biomass Burner on Wood. No node on the map produces
        // Wood, so measuring it against claims can only ever print
        // "claims cover 0.0" — a warning the player has no move to
        // clear, on the only generator the tier gives them.
        let fuel_flows = vec![fuel_flow("Desc_Wood_C", "Wood", 18.0)];
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &HashMap::new(), &stranded(),
            &mut findings,
        );

        assert_eq!(findings.len(), 1, "got {findings:?}");
        assert_eq!(findings[0].severity, Severity::Info, "not a warning — nothing is wrong");
        assert_eq!(findings[0].category, Category::SupplyPower);
        match &findings[0].kind {
            FindingKind::GeneratorFuelHandGathered { item_name, demand_ipm, .. } => {
                assert_eq!(item_name, "Wood");
                // The burn rate survives: it's the part a player acts on.
                assert_eq!(*demand_ipm, 18.0);
            }
            other => panic!("expected GeneratorFuelHandGathered, got {other:?}"),
        }
    }

    #[test]
    fn a_note_reports_the_burn_rate_and_ignores_machine_draw() {
        // Machine draw on the same item doesn't turn the note into a
        // shortfall, and the figure stays the generator's own burn
        // rate rather than a combined total — there's nothing to total
        // it against.
        let fuel_flows = vec![fuel_flow("Desc_Wood_C", "Wood", 18.0)];
        let machine_demand: HashMap<String, f32> = [("Desc_Wood_C".to_string(), 40.0)].into();
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &machine_demand, &HashMap::new(), &fuel_flows, &HashMap::new(), &stranded(),
            &mut findings,
        );

        assert_eq!(findings.len(), 1, "got {findings:?}");
        assert_eq!(findings[0].severity, Severity::Info);
        assert!(
            matches!(&findings[0].kind, FindingKind::GeneratorFuelHandGathered { demand_ipm, .. } if *demand_ipm == 18.0),
            "the generator's own burn rate: {findings:?}"
        );
    }

    #[test]
    fn a_link_carrying_a_pickup_makes_the_comparison_mean_something_again() {
        // Nothing produces Wood, but a player can still tell the app
        // that 5/min arrives on a logistics link. That's a supply
        // figure they chose, so an 18/min burn against it is a gap
        // worth reporting rather than a fact of life.
        let fuel_flows = vec![fuel_flow("Desc_Wood_C", "Wood", 18.0)];
        let supply: HashMap<String, f32> = [("Desc_Wood_C".to_string(), 5.0)].into();
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &supply, &stranded(),
            &mut findings,
        );

        assert_eq!(findings.len(), 1, "got {findings:?}");
        assert_eq!(findings[0].severity, Severity::Warning);
        assert!(
            matches!(
                &findings[0].kind,
                FindingKind::GeneratorFuelShort { demand_ipm, claimed_ipm, .. }
                    if *demand_ipm == 18.0 && *claimed_ipm == 5.0
            ),
            "{findings:?}"
        );
    }

    #[test]
    fn a_piped_biofuel_generator_keeps_its_shortfall_warning() {
        // Liquid Biofuel's chain grounds out in Wood, which makes it
        // hand-*derived* but not hand-*gathered*: it comes out of a
        // Refinery and reaches the generator through a pipe. Exempting
        // it would hand every biofuel plant in the game a permanent
        // blind spot — 30 Fuel Generators drinking 270/min against 60
        // supplied would report as a note saying nothing is wrong.
        let fuel_flows = vec![fuel_flow("Desc_LiquidBiofuel_C", "Liquid Biofuel", 270.0)];
        let supply: HashMap<String, f32> = [("Desc_LiquidBiofuel_C".to_string(), 60.0)].into();
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &supply, &stranded(),
            &mut findings,
        );

        assert_eq!(findings.len(), 1, "got {findings:?}");
        assert_eq!(findings[0].severity, Severity::Warning, "a real, closable shortfall");
        match &findings[0].kind {
            FindingKind::GeneratorFuelShort { demand_ipm, claimed_ipm, .. } => {
                assert_eq!(*demand_ipm, 270.0);
                assert_eq!(*claimed_ipm, 60.0);
            }
            other => panic!("expected GeneratorFuelShort, got {other:?}"),
        }
    }

    #[test]
    fn a_machine_made_fuel_with_no_possible_supply_is_a_note_too() {
        // Biomass comes out of a Constructor, so "is it machine-made"
        // reads as closable — and it isn't. Every recipe for it starts
        // at Wood, Leaves, Mycelia or Alien Protein, none of which a
        // belt can deliver, so a Tier 0 burner running it had a
        // warning with no move behind it. Same for Solid Biofuel from
        // Tier 2.
        for (item_id, item_name) in
            [("Desc_GenericBiomass_C", "Biomass"), ("Desc_Biofuel_C", "Solid Biofuel")]
        {
            let fuel_flows = vec![fuel_flow(item_id, item_name, 10.0)];
            let mut findings = Vec::new();
            check_generator_supply(
                &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &HashMap::new(),
                &stranded(), &mut findings,
            );
            assert_eq!(findings.len(), 1, "{item_name}: got {findings:?}");
            assert_eq!(findings[0].severity, Severity::Info, "{item_name} can never be supplied");
        }
    }

    #[test]
    fn a_zero_supply_fluid_fuel_is_the_same_note_as_a_solid_one() {
        // Liquid Biofuel is the case the note's old wording got wrong.
        // A Refinery does make it, so it reads automatable — but the
        // Refinery eats Solid Biofuel, which eats Biomass, which eats
        // Wood, Leaves, Mycelia or Alien Protein, and no recipe or node
        // in the dataset produces any of those. Building the whole
        // chain moves the gathering, it doesn't remove it, so zero
        // supply here is a standing chore rather than a shortfall.
        // Pinned separately from the solids because the fluid is the
        // one nobody can pour into a generator by hand.
        let fuel_flows = vec![fluid_fuel_flow("Desc_LiquidBiofuel_C", "Liquid Biofuel", 270.0)];
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &HashMap::new(), &stranded(),
            &mut findings,
        );

        assert_eq!(findings.len(), 1, "got {findings:?}");
        assert_eq!(findings[0].severity, Severity::Info);
        assert_eq!(findings[0].category, Category::SupplyPower);
        match &findings[0].kind {
            FindingKind::GeneratorFuelHandGathered { item_name, demand_ipm, .. } => {
                assert_eq!(item_name, "Liquid Biofuel");
                assert_eq!(*demand_ipm, 270.0);
            }
            other => panic!("expected GeneratorFuelHandGathered, got {other:?}"),
        }
    }

    #[test]
    fn a_fuel_the_factory_does_supply_is_measured_however_its_chain_grounds_out() {
        // The other half of the rule. Once a factory reports *any*
        // supply, the comparison means something and the note is the
        // wrong answer — a Constructor bank making 5/min of Biomass
        // against a 10/min burn is a gap the player closes by adding
        // Constructors.
        let fuel_flows = vec![fuel_flow("Desc_GenericBiomass_C", "Biomass", 10.0)];
        let supply: HashMap<String, f32> = [("Desc_GenericBiomass_C".to_string(), 5.0)].into();
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &supply, &stranded(),
            &mut findings,
        );

        assert_eq!(findings.len(), 1, "got {findings:?}");
        assert_eq!(findings[0].severity, Severity::Warning);
        match &findings[0].kind {
            FindingKind::GeneratorFuelShort { demand_ipm, claimed_ipm, .. } => {
                assert_eq!(*demand_ipm, 10.0);
                assert_eq!(*claimed_ipm, 5.0);
            }
            other => panic!("expected GeneratorFuelShort, got {other:?}"),
        }
    }

    #[test]
    fn a_coal_generator_still_reports_a_real_shortfall_alongside_a_hand_fed_burner() {
        // The hand-fed branch must not become a blanket exemption for
        // the whole factory: coal has nodes, so its shortfall is still
        // a warning the player can act on.
        let fuel_flows = vec![
            fuel_flow("Desc_Wood_C", "Wood", 18.0),
            fuel_flow("Desc_Coal_C", "Coal", 15.0),
        ];
        let mut findings = Vec::new();
        check_generator_supply(
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &HashMap::new(), &stranded(),
            &mut findings,
        );

        assert_eq!(findings.len(), 2, "got {findings:?}");
        assert_eq!(
            findings.iter().filter(|f| f.severity == Severity::Warning).count(),
            1,
            "coal is still a warning: {findings:?}"
        );
        assert!(
            findings.iter().any(|f| matches!(
                &f.kind,
                FindingKind::GeneratorFuelShort { item_id, .. } if item_id == "Desc_Coal_C"
            )),
            "{findings:?}"
        );
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
        check_generator_supply(
            &fref(), &machine_demand, &machine_demand, &fuel_flows, &supply, &stranded(),
            &mut findings,
        );

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
        check_generator_supply(
            &fref(), &machine_demand, &machine_demand, &fuel_flows, &supply, &stranded(),
            &mut findings,
        );
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
            &fref(), &machine_demand, &HashMap::new(), &fuel_flows, &supply, &stranded(),
            &mut findings,
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
            &fref(), &machine_demand, &reported_elsewhere, &fuel_flows, &supply, &stranded(),
            &mut findings,
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
            &fref(), &HashMap::new(), &HashMap::new(), &fuel_flows, &supply, &stranded(),
            &mut findings,
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

    fn graph(nodes: Vec<PlanNode>, edges: Vec<PlanEdge>) -> PlanGraph {
        PlanGraph { nodes, edges, ..PlanGraph::default() }
    }

    fn edge_from(from_node: &str, item_id: &str, item_name: &str, ipm: f32) -> PlanEdge {
        PlanEdge { from_node: from_node.into(), ..plan_edge(item_id, item_name, ipm) }
    }

    /// A machine bank sized the way `planner::domain::build_stage`
    /// sizes one — enough machines to cover the demand, clocked down to
    /// land exactly on it — reading every rate out of the bundled
    /// dataset. Hand-picked numbers would pin the arithmetic without
    /// proving any recipe in the game actually reaches it, and the
    /// whole question here is whether real single-machine rates clear
    /// the belt.
    fn recipe_bank(gd: &GameData, recipe_id: &str, item_id: &str, demand_ipm: f32) -> PlanNode {
        let per_machine = gd
            .recipe(recipe_id)
            .expect("recipe is in the bundled dataset")
            .outputs
            .iter()
            .find(|io| io.item_id == item_id)
            .expect("recipe produces the item")
            .per_minute;
        let machine_count = (demand_ipm / per_machine).ceil().max(1.0) as i64;
        let clock_pct = demand_ipm / (machine_count as f32 * per_machine) * 100.0;
        recipe_bank_at_clock(gd, recipe_id, item_id, machine_count, clock_pct)
    }

    /// The bank builder for the cases the planner's own sizing can't
    /// produce — it never clocks a bank above 100%, so an overclocked
    /// graph only ever arrives from a saved plan.
    fn recipe_bank_at_clock(
        gd: &GameData,
        recipe_id: &str,
        item_id: &str,
        machine_count: i64,
        clock_pct: f32,
    ) -> PlanNode {
        let r = gd.recipe(recipe_id).expect("recipe is in the bundled dataset");
        let name_of = |id: &str| gd.item(id).map(|i| i.name.clone()).unwrap_or_else(|| id.into());
        let scaler = machine_count as f32 * clock_pct / 100.0;
        let flows = |ios: &[crate::shared::gamedata::types::RecipeIo]| {
            ios.iter()
                .map(|io| RecipeFlow {
                    item_id: io.item_id.clone(),
                    item_name: name_of(&io.item_id),
                    per_minute: io.per_minute * scaler,
                })
                .collect::<Vec<_>>()
        };
        let outputs = flows(&r.outputs);
        let output_ipm =
            outputs.iter().find(|f| f.item_id == item_id).map(|f| f.per_minute).unwrap_or(0.0);
        PlanNode::Recipe {
            node_key: format!("recipe:{item_id}"),
            item_id: item_id.into(),
            item_name: name_of(item_id),
            recipe_id: r.id.clone(),
            recipe_name: r.name.clone(),
            building_id: r.building_id.clone(),
            building_name: gd
                .building(&r.building_id)
                .map(|b| b.name.clone())
                .unwrap_or_else(|| r.building_id.clone()),
            machine_count,
            clock_pct,
            power_mw: 0.0,
            output_ipm,
            free_output_ipm: 0.0,
            is_alt: r.is_alt,
            is_target: true,
            target_ipm: None,
            inputs: flows(&r.inputs),
            outputs,
        }
    }

    /// Every `Capacity` finding, so each assertion below is bounded by
    /// the full set the check produced rather than by whichever one
    /// happened to land first.
    fn capacity(findings: &[Finding]) -> Vec<&Finding> {
        findings.iter().filter(|f| f.category == Category::Capacity).collect()
    }

    #[test]
    fn one_constructor_over_the_tier0_belt_is_a_warning_not_a_belt_count() {
        // Biomass (Wood) is 300/min out of one Constructor at stock
        // clock, against the 60/min Mk1 belt that is all Tier 0 has.
        // One machine has one output port and a splitter after it only
        // divides what already came through, so "needs 5 belts" is not
        // a build anyone can lay — the player has to clock down or add
        // machines, both of which this then reads as fixed.
        let gd = GameData::from_bundled().unwrap();
        let bank = recipe_bank(&gd, "Recipe_Biomass_Wood_C", "Desc_GenericBiomass_C", 300.0);
        let g = graph(vec![bank], vec![]);
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &g, 0, &gd, &mut findings);

        let cap = capacity(&findings);
        assert_eq!(cap.len(), 1, "got {findings:?}");
        assert_eq!(cap[0].severity, Severity::Warning, "unbuildable, not a layout note");
        match &cap[0].kind {
            FindingKind::MachineOverPortCapacity {
                machine_count,
                per_machine_ipm,
                capacity_ipm,
                capacity_mark,
                is_fluid,
                max_fitting_clock_pct,
                machines_needed,
                item_id,
                ..
            } => {
                assert_eq!(item_id, "Desc_GenericBiomass_C");
                assert_eq!(*machine_count, 1);
                assert!((*per_machine_ipm - 300.0).abs() < 0.01);
                assert!((*capacity_ipm - 60.0).abs() < 0.01);
                assert_eq!(*capacity_mark, 1);
                assert!(!*is_fluid);
                // 60/300 × 100% = 20%.
                assert!((*max_fitting_clock_pct - 20.0).abs() < 0.01, "got {max_fitting_clock_pct}");
                assert_eq!(*machines_needed, 5, "300/min over 60/min ports");
            }
            other => panic!("expected MachineOverPortCapacity, got {other:?}"),
        }
    }

    #[test]
    fn the_steel_screws_bank_warns_and_never_offers_a_second_belt_on_one_port() {
        // The reported repro: Tier 3, 225/min of Screws on Steel Screws
        // sizes to one Constructor at 86.5% (260/min at stock), and the
        // 225/min segment leaving it used to read "needs 2 belts at
        // Mk.2" as a note — two belts on one output port, and a plan
        // that cannot be built passing a clean sweep. The segment note
        // has to be suppressed here, not stacked on top: laying belts
        // is not the move.
        let gd = GameData::from_bundled().unwrap();
        let bank = recipe_bank(&gd, "Recipe_Alternate_Screw_2_C", "Desc_IronScrew_C", 225.0);
        let g = graph(
            vec![bank],
            vec![edge_from("recipe:Desc_IronScrew_C", "Desc_IronScrew_C", "Screws", 225.0)],
        );
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &g, 3, &gd, &mut findings);

        let cap = capacity(&findings);
        assert_eq!(cap.len(), 1, "the warning replaces the belt note: {findings:?}");
        assert_eq!(cap[0].severity, Severity::Warning);
        match &cap[0].kind {
            FindingKind::MachineOverPortCapacity {
                recipe_name,
                building_name,
                machine_count,
                per_machine_ipm,
                capacity_ipm,
                capacity_mark,
                max_fitting_clock_pct,
                machines_needed,
                ..
            } => {
                assert_eq!(recipe_name, "Alternate: Steel Screws");
                assert_eq!(building_name, "Constructor");
                assert_eq!(*machine_count, 1);
                assert!((*per_machine_ipm - 225.0).abs() < 0.01);
                assert!((*capacity_ipm - 120.0).abs() < 0.01);
                assert_eq!(*capacity_mark, 2);
                // 120/225 × 86.538% = 46.15…%, which the panel floors
                // to 46 — rounding it up hands back a clock that still
                // overshoots the port.
                assert!(
                    (*max_fitting_clock_pct - 46.153_846).abs() < 0.01,
                    "got {max_fitting_clock_pct}"
                );
                assert_eq!(*machines_needed, 2);
            }
            other => panic!("expected MachineOverPortCapacity, got {other:?}"),
        }
    }

    #[test]
    fn one_machine_feeding_two_consumers_is_still_over_its_single_port() {
        // The case an edge-level check waves through. One Constructor
        // on Steel Screws at 200/min splits to two consumers at 100/min
        // each — both segments sit under the Mk.2 belt's 120, so
        // nothing measured per edge sees a problem, while the single
        // port they both leave through carries the full 200.
        let gd = GameData::from_bundled().unwrap();
        let bank = recipe_bank(&gd, "Recipe_Alternate_Screw_2_C", "Desc_IronScrew_C", 200.0);
        let g = graph(
            vec![bank],
            vec![
                edge_from("recipe:Desc_IronScrew_C", "Desc_IronScrew_C", "Screws", 100.0),
                edge_from("recipe:Desc_IronScrew_C", "Desc_IronScrew_C", "Screws", 100.0),
            ],
        );
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &g, 3, &gd, &mut findings);

        let cap = capacity(&findings);
        assert_eq!(cap.len(), 1, "got {findings:?}");
        assert_eq!(cap[0].severity, Severity::Warning);
        match &cap[0].kind {
            FindingKind::MachineOverPortCapacity { per_machine_ipm, machines_needed, .. } => {
                assert!(
                    (*per_machine_ipm - 200.0).abs() < 0.01,
                    "the port carries the sum, not one branch: got {per_machine_ipm}"
                );
                assert_eq!(*machines_needed, 2);
            }
            other => panic!("expected MachineOverPortCapacity, got {other:?}"),
        }
    }

    #[test]
    fn a_bank_whose_own_ports_fit_still_gets_the_aggregate_belt_note() {
        // The other half of the split, and the case #130 was right
        // about. Base Screws is 40/min a machine, so 500/min is 13
        // Constructors each well inside the Mk.2 belt — no port is
        // over. The 500/min line out of the bank is ordinary parallel
        // belts, so it stays a note with the count on it.
        let gd = GameData::from_bundled().unwrap();
        let bank = recipe_bank(&gd, "Recipe_Screw_C", "Desc_IronScrew_C", 500.0);
        let g = graph(
            vec![bank],
            vec![edge_from("recipe:Desc_IronScrew_C", "Desc_IronScrew_C", "Screws", 500.0)],
        );
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &g, 3, &gd, &mut findings);

        let cap = capacity(&findings);
        assert_eq!(cap.len(), 1, "got {findings:?}");
        assert_eq!(cap[0].severity, Severity::Info, "parallel belts are normal play");
        match &cap[0].kind {
            FindingKind::SegmentOverBeltCapacity { belts_needed, belt_mark, ipm, .. } => {
                assert_eq!(*belts_needed, 5);
                assert_eq!(*belt_mark, 2);
                assert!((*ipm - 500.0).abs() < 0.01);
            }
            other => panic!("expected SegmentOverBeltCapacity, got {other:?}"),
        }
    }

    #[test]
    fn suppressing_the_note_is_scoped_to_the_producer_that_warned() {
        // A factory with one over-port bank must not go quiet about
        // every other line in it. The raw ore feed is four miners'
        // worth of aggregate flow — still parallel belts, still a note
        // — alongside the Steel Screws bank's warning.
        let gd = GameData::from_bundled().unwrap();
        let bank = recipe_bank(&gd, "Recipe_Alternate_Screw_2_C", "Desc_IronScrew_C", 225.0);
        let g = graph(
            vec![bank],
            vec![
                edge_from("recipe:Desc_IronScrew_C", "Desc_IronScrew_C", "Screws", 225.0),
                edge_from("raw:Desc_OreIron_C", "Desc_OreIron_C", "Iron Ore", 280.9),
            ],
        );
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &g, 3, &gd, &mut findings);

        let cap = capacity(&findings);
        assert_eq!(cap.len(), 2, "got {findings:?}");
        assert_eq!(cap.iter().filter(|f| f.severity == Severity::Warning).count(), 1);
        assert!(
            cap.iter().any(|f| matches!(
                &f.kind,
                FindingKind::SegmentOverBeltCapacity { item_id, belts_needed, .. }
                    if item_id == "Desc_OreIron_C" && *belts_needed == 3
            )),
            "the ore note survives: {findings:?}"
        );
    }

    #[test]
    fn a_bank_exactly_on_its_port_capacity_is_silent() {
        // 120/min out of one Constructor is the Mk.2 belt's capacity,
        // not over it — the boundary the `> cap + EPS` test has to hold
        // at, or every full belt in the game reads as unbuildable.
        let gd = GameData::from_bundled().unwrap();
        let bank = recipe_bank(&gd, "Recipe_Alternate_Screw_2_C", "Desc_IronScrew_C", 120.0);
        let g = graph(
            vec![bank],
            vec![edge_from("recipe:Desc_IronScrew_C", "Desc_IronScrew_C", "Screws", 120.0)],
        );
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &g, 3, &gd, &mut findings);
        assert!(capacity(&findings).is_empty(), "got {findings:?}");
    }

    #[test]
    fn a_fluid_bank_over_its_port_reads_against_the_pipe_not_the_belt() {
        // Symmetry with the solid case, from the state that reaches it:
        // a saved graph built at a higher tier than the playthrough now
        // sits at. No fluid recipe clears its pipe at a legal clock on
        // its own tier's pipe — Sloppy Alumina is the closest at 240
        // m³/min, and 250% of that is exactly the Mk2 pipe — so the
        // over-port case only appears once the pipe underneath it drops
        // back to Mk1's 300. `check_plan_graph` reports the tier
        // violation itself; this check still has to measure the graph
        // in front of it rather than go quiet.
        let gd = GameData::from_bundled().unwrap();
        let bank = recipe_bank_at_clock(
            &gd,
            "Recipe_Alternate_SloppyAlumina_C",
            "Desc_AluminaSolution_C",
            1,
            250.0,
        );
        let g = graph(vec![bank], vec![]);
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &g, 3, &gd, &mut findings);

        let cap = capacity(&findings);
        assert_eq!(cap.len(), 1, "got {findings:?}");
        assert_eq!(cap[0].severity, Severity::Warning);
        match &cap[0].kind {
            FindingKind::MachineOverPortCapacity {
                is_fluid,
                capacity_ipm,
                capacity_mark,
                per_machine_ipm,
                max_fitting_clock_pct,
                ..
            } => {
                assert!(*is_fluid);
                assert!((*per_machine_ipm - 600.0).abs() < 0.01);
                assert!((*capacity_ipm - 300.0).abs() < 0.01);
                assert_eq!(*capacity_mark, 1);
                assert!((*max_fitting_clock_pct - 125.0).abs() < 0.01);
            }
            other => panic!("expected MachineOverPortCapacity, got {other:?}"),
        }
    }

    #[test]
    fn a_fluid_bank_before_any_pipe_tier_is_left_to_the_segment_warning() {
        // With no pipe unlocked there's no capacity to measure a port
        // against, and `FluidSegmentNoPipeAtTier` already says the only
        // useful thing (reach Tier 3). Same reason
        // `check_claim_port_capacity` stays silent on a `None` cap.
        let gd = GameData::from_bundled().unwrap();
        let bank = recipe_bank_at_clock(
            &gd,
            "Recipe_Alternate_SloppyAlumina_C",
            "Desc_AluminaSolution_C",
            1,
            250.0,
        );
        let g = graph(
            vec![bank],
            vec![edge_from(
                "recipe:Desc_AluminaSolution_C",
                "Desc_AluminaSolution_C",
                "Alumina Solution",
                600.0,
            )],
        );
        let mut findings = Vec::new();
        check_plan_graph_capacity(&fref(), &g, 0, &gd, &mut findings);

        let cap = capacity(&findings);
        assert_eq!(cap.len(), 1, "got {findings:?}");
        assert_eq!(cap[0].severity, Severity::Warning);
        assert!(
            matches!(&cap[0].kind, FindingKind::FluidSegmentNoPipeAtTier { ipm, .. } if (*ipm - 600.0).abs() < 0.01),
            "got {findings:?}"
        );
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
        // Aggregate flow: two Mk1 belts carry it, and laying them leaves
        // the segment reading 90/min — a warning here could never clear.
        assert_eq!(findings[0].severity, Severity::Info);
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
        // Stays a warning while the over-capacity pair are notes:
        // reaching Tier 3 really does retire this one.
        assert_eq!(findings[0].severity, Severity::Warning);
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
        // Same reasoning as the belt pair: three headers carry it, and
        // building them leaves this segment reading 630 m³/min.
        assert_eq!(findings[0].severity, Severity::Info);
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
