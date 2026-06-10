//! Pure planner logic. The Tauri command layer (in `commands.rs`) does
//! nothing more than gather the inputs (claims, alts, target spec) and
//! call `derive_chain`; everything that matters is here so the unit
//! tests can pin behaviour against the bundled dataset without going
//! through IPC.

use std::collections::{HashMap, HashSet};

use crate::shared::gamedata::GameData;
use crate::shared::gamedata::types::Recipe;

use super::dto::{
    ChainStage, ImportAllocation, PlanComputeOptions, PlanEdge, PlanGraph, PlanImportSpec,
    PlanNode, PlanTargetSpec, PlanWarning, PlannerError, RecipeFlow,
};
use super::solver;

/// Per-machine ipm of `item_id` for this recipe at 100% clock with no
/// amplification.
fn recipe_output_rate(recipe: &Recipe, item_id: &str) -> Option<f32> {
    recipe
        .outputs
        .iter()
        .find(|o| o.item_id == item_id)
        .map(|o| o.per_minute)
}

/// Unpackage recipes are inverse-utility — they only exist to recover
/// the underlying liquid/gas from a packaged form (e.g. unpacking
/// "Packaged Alumina" back into "Alumina Solution"). Including them as
/// candidates produces a cycle the moment a chain consumes the liquid:
/// the picker sees an Unpackage recipe with a high output rate, picks
/// it, then recurses into the Packaged form, whose only recipe needs
/// the original liquid back. Filtered out wholesale here for the same
/// reason `PlannerView` (the cross-factory picker) hides them.
fn is_inverse_recipe(recipe_id: &str) -> bool {
    recipe_id.starts_with("Recipe_Unpackage")
}

fn chain_candidates<'a>(
    item_id: &str,
    unlocked: &HashSet<String>,
    game_data: &'a GameData,
) -> Vec<&'a Recipe> {
    game_data
        .recipes_producing(item_id)
        .into_iter()
        .filter(|r| !is_inverse_recipe(&r.id))
        .filter(|r| !r.is_alt || unlocked.contains(&r.id))
        .collect()
}

/// Pick the "best" candidate recipe for an item. The greedy rule is:
/// highest per-machine output rate of the target item, so the chain
/// uses the fewest machines for the demand. Standard recipes win ties
/// over alts (predictable, no surprises). The candidate must be
/// supply-viable — its inputs must trace to raw resources or other
/// viable recipes (handled by the caller's `viable_for_item` check
/// before this fn is invoked).
fn pick_recipe<'a>(
    item_id: &str,
    candidates: &[&'a Recipe],
) -> Option<&'a Recipe> {
    candidates
        .iter()
        .copied()
        .filter_map(|r| recipe_output_rate(r, item_id).map(|rate| (r, rate)))
        .max_by(|a, b| {
            a.1.partial_cmp(&b.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    // Ties → prefer non-alt (standard recipe) so the
                    // planner is deterministic when two recipes share
                    // a rate.
                    a.0.is_alt.cmp(&b.0.is_alt).reverse()
                })
        })
        .map(|(r, _)| r)
}

/// "Supply-viable" — there's a recipe chain to this item whose every
/// extracted-resource leaf is claimed. Used to *prefer* recipes whose
/// inputs the player can actually source. Cut items short-circuit to
/// viable — we trust the user's declaration; the cap check happens
/// after collection.
#[allow(clippy::too_many_arguments)]
fn supply_viable_for_item(
    item_id: &str,
    unlocked: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    cut_items: &HashSet<String>,
    game_data: &GameData,
    cache: &mut HashMap<String, bool>,
    visiting: &mut HashSet<String>,
) -> bool {
    if let Some(v) = cache.get(item_id) {
        return *v;
    }
    if cut_items.contains(item_id) {
        cache.insert(item_id.to_string(), true);
        return true;
    }
    if visiting.contains(item_id) {
        return false;
    }
    visiting.insert(item_id.to_string());

    if game_data.is_extracted_resource(item_id) {
        let ok = available_supply.contains_key(item_id);
        visiting.remove(item_id);
        cache.insert(item_id.to_string(), ok);
        return ok;
    }

    let candidates = chain_candidates(item_id, unlocked, game_data);
    if candidates.is_empty() {
        visiting.remove(item_id);
        cache.insert(item_id.to_string(), false);
        return false;
    }

    let any = candidates.into_iter().any(|r| {
        r.inputs.iter().all(|inp| {
            supply_viable_for_item(
                &inp.item_id,
                unlocked,
                available_supply,
                cut_items,
                game_data,
                cache,
                visiting,
            )
        })
    });
    visiting.remove(item_id);
    cache.insert(item_id.to_string(), any);
    any
}

/// "Structurally viable" — there's *any* recipe chain to this item,
/// ignoring whether the player has actually claimed enough supply. We
/// fall back to this when no supply-viable chain exists so the
/// planner can still produce a `ChainPlan` whose raw_demand exposes
/// exactly which raw is short — yielding a precise `Insufficient`
/// error instead of a vague "no recipe" one. Cut items short-circuit
/// to viable here too.
fn structurally_viable_for_item(
    item_id: &str,
    unlocked: &HashSet<String>,
    cut_items: &HashSet<String>,
    game_data: &GameData,
    cache: &mut HashMap<String, bool>,
    visiting: &mut HashSet<String>,
) -> bool {
    if let Some(v) = cache.get(item_id) {
        return *v;
    }
    if cut_items.contains(item_id) {
        cache.insert(item_id.to_string(), true);
        return true;
    }
    if visiting.contains(item_id) {
        return false;
    }
    visiting.insert(item_id.to_string());

    if game_data.is_extracted_resource(item_id) {
        visiting.remove(item_id);
        cache.insert(item_id.to_string(), true);
        return true;
    }

    let candidates = chain_candidates(item_id, unlocked, game_data);
    if candidates.is_empty() {
        visiting.remove(item_id);
        cache.insert(item_id.to_string(), false);
        return false;
    }

    let any = candidates.into_iter().any(|r| {
        r.inputs.iter().all(|inp| {
            structurally_viable_for_item(&inp.item_id, unlocked, cut_items, game_data, cache, visiting)
        })
    });
    visiting.remove(item_id);
    cache.insert(item_id.to_string(), any);
    any
}

/// Recursively size a stage. `demand_ipm` is how many of `item_id`
/// this stage must produce per minute. Returns the chosen stage and
/// folds raw demand into `raw_demand` so the caller can compare
/// against `available_supply` at the end.
/// Phase 1: walk the recipe graph leaves-first, accumulating total
/// demand per item across every dependency path. The same item showing
/// up twice (e.g. Iron Rod is both a direct Rotor input AND a Screw
/// input on the way to Rotor) gets its demand summed into one entry
/// instead of producing two separate stages — that was the duplicate-
/// stage bug in the earlier `size_stage` recursion.
#[allow(clippy::too_many_arguments)]
fn collect_demands(
    item_id: &str,
    demand_ipm: f32,
    unlocked: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    cut_items: &HashSet<String>,
    game_data: &GameData,
    raw_demand: &mut HashMap<String, f32>,
    imported_demand: &mut HashMap<String, f32>,
    item_demands: &mut HashMap<String, f32>,
    item_recipes: &mut HashMap<String, String>,
    visit_order: &mut Vec<String>,
    supply_cache: &mut HashMap<String, bool>,
    struct_cache: &mut HashMap<String, bool>,
    visiting: &mut HashSet<String>,
) -> Result<(), PlannerError> {
    // Cut items end the chain here: no upstream recursion, no recipe
    // pick, no raw_demand contribution. The cap/source check is
    // deferred to after collection so demand can accumulate across
    // multiple visits (Iron Plate as both a Rotor input and a Modular
    // Frame input lands on one row).
    if cut_items.contains(item_id) {
        *imported_demand.entry(item_id.to_string()).or_insert(0.0) += demand_ipm;
        return Ok(());
    }
    if game_data.is_extracted_resource(item_id) {
        *raw_demand.entry(item_id.to_string()).or_insert(0.0) += demand_ipm;
        return Ok(());
    }
    if visiting.contains(item_id) {
        return Err(PlannerError::CycleDetected {
            item_id: item_id.to_string(),
        });
    }
    visiting.insert(item_id.to_string());

    // Fold the additional demand into this item's running total
    // *before* recursing — if the same item appears again deeper in
    // the chain, all its demand lands on a single stage.
    *item_demands.entry(item_id.to_string()).or_insert(0.0) += demand_ipm;

    // Recipe pick is memoised per item — once the first visit pins
    // a recipe, all subsequent visits inherit it so we don't oscillate
    // between alts on different paths.
    let picked_recipe_id = item_recipes.get(item_id).cloned();

    let all_unlocked = chain_candidates(item_id, unlocked, game_data);

    // Prefer recipes whose every input is supply-viable. If none are,
    // fall back to structurally viable so the chain still builds; the
    // raw_demand vs. available_supply comparison at the end then
    // surfaces a precise Insufficient error.
    let supply_viable: Vec<&Recipe> = all_unlocked
        .iter()
        .copied()
        .filter(|r| {
            r.inputs.iter().all(|inp| {
                supply_viable_for_item(
                    &inp.item_id,
                    unlocked,
                    available_supply,
                    cut_items,
                    game_data,
                    supply_cache,
                    &mut HashSet::new(),
                )
            })
        })
        .collect();
    let candidates: Vec<&Recipe> = if !supply_viable.is_empty() {
        supply_viable
    } else {
        all_unlocked
            .iter()
            .copied()
            .filter(|r| {
                r.inputs.iter().all(|inp| {
                    structurally_viable_for_item(
                        &inp.item_id,
                        unlocked,
                        cut_items,
                        game_data,
                        struct_cache,
                        &mut HashSet::new(),
                    )
                })
            })
            .collect()
    };
    if candidates.is_empty() {
        visiting.remove(item_id);
        return Err(PlannerError::NoRecipeForTarget {
            item_id: item_id.to_string(),
        });
    }

    let recipe = if let Some(rid) = picked_recipe_id.as_deref() {
        game_data
            .recipe(rid)
            .ok_or_else(|| PlannerError::NoRecipeForTarget {
                item_id: item_id.to_string(),
            })?
    } else {
        let r = pick_recipe(item_id, &candidates).ok_or_else(|| {
            PlannerError::NoRecipeForTarget {
                item_id: item_id.to_string(),
            }
        })?;
        item_recipes.insert(item_id.to_string(), r.id.clone());
        r
    };
    let per_machine = recipe_output_rate(recipe, item_id).expect("candidate filter guarantees output");

    // Recurse into upstream demands — the upstream demand from THIS
    // visit only is `recipe_input.per_minute × (demand_ipm /
    // per_machine_output_rate)`. The recipient call sums it into
    // `item_demands` to deduplicate across paths.
    let runs_for_delta = demand_ipm / per_machine;
    let input_demands: Vec<(String, f32)> = recipe
        .inputs
        .iter()
        .map(|io| (io.item_id.clone(), io.per_minute * runs_for_delta))
        .collect();
    for (input_item, input_ipm) in input_demands {
        collect_demands(
            &input_item,
            input_ipm,
            unlocked,
            available_supply,
            cut_items,
            game_data,
            raw_demand,
            imported_demand,
            item_demands,
            item_recipes,
            visit_order,
            supply_cache,
            struct_cache,
            visiting,
        )?;
    }

    // Record first-visit order leaves-first so the eventual stage
    // list reads as "build these in order". Subsequent re-visits skip
    // re-appending; they only contribute to demand accumulation.
    if !visit_order.iter().any(|x| x == item_id) {
        visit_order.push(item_id.to_string());
    }
    visiting.remove(item_id);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn build_stage(
    item_id: &str,
    demand_ipm: f32,
    recipe: &Recipe,
    game_data: &GameData,
) -> ChainStage {
    let per_machine = recipe_output_rate(recipe, item_id).expect("recipe must produce target");
    // Greedy clock choice — overclock only if needed.
    let count_f = (demand_ipm / per_machine).ceil().max(1.0);
    let mut machine_count = count_f as i64;
    let mut clock = demand_ipm / (machine_count as f32 * per_machine) * 100.0;
    if clock < 1.0 {
        clock = 1.0;
    }
    while clock > 250.0 && machine_count < 10_000 {
        machine_count += 1;
        clock = demand_ipm / (machine_count as f32 * per_machine) * 100.0;
    }

    // Total recipe runs/min across the bank: each machine at 100%
    // clock runs the recipe N times/min where N = 60/cycle_seconds.
    // `per_minute` on a RecipeIo already encodes that for one
    // machine at 100% clock, so multiplying by the bank's
    // effective-clock factor gives the right total flow.
    let scaler = machine_count as f32 * clock / 100.0;
    let inputs: Vec<RecipeFlow> = recipe
        .inputs
        .iter()
        .map(|io| flow_for(io.item_id.clone(), io.per_minute * scaler, game_data))
        .collect();
    let outputs: Vec<RecipeFlow> = recipe
        .outputs
        .iter()
        .map(|io| flow_for(io.item_id.clone(), io.per_minute * scaler, game_data))
        .collect();

    let building_name = game_data
        .building(&recipe.building_id)
        .map(|b| b.name.clone())
        .unwrap_or_else(|| recipe.building_id.clone());
    let power_mw = game_data
        .building(&recipe.building_id)
        .map(|b| b.power_mw * machine_count as f32 * (clock / 100.0).powi(2))
        .unwrap_or(0.0);

    ChainStage {
        recipe_id: recipe.id.clone(),
        recipe_name: recipe.name.clone(),
        building_id: recipe.building_id.clone(),
        building_name,
        output_item_id: item_id.to_string(),
        output_ipm: demand_ipm,
        machine_count,
        clock_pct: clock,
        inputs,
        outputs,
        is_alt: recipe.is_alt,
        power_mw,
    }
}

fn flow_for(item_id: String, per_minute: f32, game_data: &GameData) -> RecipeFlow {
    let item_name = game_data
        .item(&item_id)
        .map(|i| i.name.clone())
        .unwrap_or_else(|| item_id.clone());
    RecipeFlow {
        item_id,
        item_name,
        per_minute,
    }
}

// ---- Production-plan graph (graph-first designer) ----

pub fn recipe_node_key(item_id: &str) -> String {
    format!("recipe:{item_id}")
}

pub fn raw_node_key(item_id: &str) -> String {
    format!("raw:{item_id}")
}

pub fn import_node_key(item_id: &str) -> String {
    format!("import:{item_id}")
}

pub fn byproduct_node_key(item_id: &str) -> String {
    format!("byproduct:{item_id}")
}

fn item_name(item_id: &str, game_data: &GameData) -> String {
    game_data
        .item(item_id)
        .map(|i| i.name.clone())
        .unwrap_or_else(|| item_id.to_string())
}

/// What a sourced spec can actually pull. An explicit cap is the
/// user's override and wins outright; without one, the source's real
/// remaining export capacity is the limit — a factory that exports
/// nothing (yet) contributes nothing, instead of notionally absorbing
/// the whole demand and starving the local line.
fn effective_external_cap(
    spec: &PlanImportSpec,
    export_capacity: &HashMap<(String, String), f32>,
) -> f32 {
    if let Some(cap) = spec.ipm_cap {
        return cap.max(0.0);
    }
    match &spec.source_factory_id {
        Some(source_id) => *export_capacity
            .get(&(source_id.clone(), spec.item_id.clone()))
            .unwrap_or(&0.0),
        None => 0.0,
    }
}

/// Distribute one cut item's accumulated demand across its import
/// specs in declared order. Sourced specs take up to their effective
/// cap (explicit cap, else real export capacity); whatever is left is
/// `unassigned` (covered by an unsourced spec — "a future factory" —
/// or by nothing at all if every spec falls short).
fn allocate_import_specs(
    item_id: &str,
    total_demand: f32,
    specs: &[PlanImportSpec],
    export_capacity: &HashMap<(String, String), f32>,
) -> (Vec<ImportAllocation>, f32, bool) {
    let mut remaining = total_demand;
    let mut allocations: Vec<ImportAllocation> = Vec::new();
    let mut has_unsourced_spec = false;
    for spec in specs.iter().filter(|s| s.item_id == item_id) {
        let Some(source_id) = &spec.source_factory_id else {
            has_unsourced_spec = true;
            continue;
        };
        if remaining <= 1e-3 {
            // Source declared but the demand is already covered —
            // record a zero allocation so the UI still lists it.
            allocations.push(ImportAllocation {
                source_factory_id: source_id.clone(),
                resolved_ipm: 0.0,
            });
            continue;
        }
        let cap = effective_external_cap(spec, export_capacity);
        let take = remaining.min(cap).max(0.0);
        allocations.push(ImportAllocation {
            source_factory_id: source_id.clone(),
            resolved_ipm: take,
        });
        remaining -= take;
    }
    let unassigned = if remaining > 1e-3 { remaining } else { 0.0 };
    (allocations, unassigned, has_unsourced_spec)
}

/// Compute the production graph: optimizer first, greedy fallback.
///
/// The optimizer (see `solver.rs`) picks the recipe MIX that minimises
/// rarity-weighted raw consumption with byproducts netted against
/// demand. If it can't (solver error, budget overrun), the greedy
/// chain below still renders a standard tree instantly, plus an
/// `OptimizerFellBack` warning — warn, don't block, always.
#[allow(clippy::too_many_arguments)]
pub fn compute_plan_graph(
    factory_id: &str,
    targets: &[PlanTargetSpec],
    unlocked_alts: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    imports: &[PlanImportSpec],
    recipe_overrides: &HashMap<String, String>,
    export_capacity: &HashMap<(String, String), f32>,
    options: &PlanComputeOptions,
    game_data: &GameData,
) -> Result<PlanGraph, PlannerError> {
    match compute_plan_graph_solved(
        factory_id,
        targets,
        unlocked_alts,
        available_supply,
        imports,
        recipe_overrides,
        export_capacity,
        options,
        game_data,
    ) {
        Ok(graph) => Ok(graph),
        Err(SolvedComputeError::Structural(e)) => Err(e),
        Err(SolvedComputeError::Solver(reason)) => {
            let mut graph = compute_plan_graph_greedy(
                factory_id,
                targets,
                unlocked_alts,
                available_supply,
                imports,
                recipe_overrides,
                export_capacity,
                game_data,
            )?;
            graph.warnings.push(PlanWarning::OptimizerFellBack { reason });
            Ok(graph)
        }
    }
}

enum SolvedComputeError {
    /// Unknown target / no recipe — same contract as the greedy path.
    Structural(PlannerError),
    /// The optimizer itself failed; fall back to greedy.
    Solver(String),
}

/// The optimizer path: shared validation, mixed-import share passes,
/// LP solve, then graph assembly from the chosen recipe mix.
#[allow(clippy::too_many_arguments)]
fn compute_plan_graph_solved(
    factory_id: &str,
    targets: &[PlanTargetSpec],
    unlocked_alts: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    imports: &[PlanImportSpec],
    recipe_overrides: &HashMap<String, String>,
    export_capacity: &HashMap<(String, String), f32>,
    options: &PlanComputeOptions,
    game_data: &GameData,
) -> Result<PlanGraph, SolvedComputeError> {
    if targets.is_empty() {
        return Ok(PlanGraph {
            nodes: vec![],
            edges: vec![],
            total_machines: 0,
            total_power_mw: 0.0,
            raw_demand: HashMap::new(),
            warnings: vec![],
            sam_forced: false,
        });
    }
    for t in targets {
        if game_data.item(&t.item_id).is_none() {
            return Err(SolvedComputeError::Structural(PlannerError::UnknownTarget {
                item_id: t.item_id.clone(),
            }));
        }
        if game_data.recipes_producing(&t.item_id).is_empty() {
            return Err(SolvedComputeError::Structural(PlannerError::NoRecipeForTarget {
                item_id: t.item_id.clone(),
            }));
        }
    }

    let target_ipms: HashMap<&str, f32> =
        targets.iter().map(|t| (t.item_id.as_str(), t.ipm)).collect();

    // Same import bookkeeping as the greedy path: target items are
    // never cut, self rows mark mixed items, the rest are full cuts.
    let cut_all: HashSet<String> = imports
        .iter()
        .filter(|s| !target_ipms.contains_key(s.item_id.as_str()))
        .map(|s| s.item_id.clone())
        .collect();
    let self_items: HashSet<String> = imports
        .iter()
        .filter(|sp| sp.source_factory_id.as_deref() == Some(factory_id))
        .map(|sp| sp.item_id.clone())
        .collect();
    let self_caps: HashMap<String, f32> = imports
        .iter()
        .filter(|sp| sp.source_factory_id.as_deref() == Some(factory_id))
        .filter_map(|sp| sp.ipm_cap.map(|cap| (sp.item_id.clone(), cap.max(0.0))))
        .collect();
    let external_specs: Vec<PlanImportSpec> = imports
        .iter()
        .filter(|sp| sp.source_factory_id.as_deref() != Some(factory_id))
        .cloned()
        .collect();
    let full_cuts: HashSet<String> =
        cut_all.iter().filter(|i| !self_items.contains(*i)).cloned().collect();
    let mixed: Vec<String> = {
        let mut v: Vec<String> =
            cut_all.iter().filter(|i| self_items.contains(*i)).cloned().collect();
        v.sort();
        v
    };

    // Honour valid recipe pins, drop stale ones (same rules as greedy).
    let mut overrides: HashMap<String, String> = HashMap::new();
    for (item_id, recipe_id) in recipe_overrides {
        let valid = game_data.recipe(recipe_id).is_some_and(|r| {
            !is_inverse_recipe(&r.id)
                && (!r.is_alt || unlocked_alts.contains(&r.id))
                && r.outputs.iter().any(|o| o.item_id == *item_id)
        });
        if valid {
            overrides.insert(item_id.clone(), recipe_id.clone());
        }
    }

    // A SAM-locked target forces the toggle on for this compute; the
    // UI renders the switch on + disabled. One fixpoint covers every
    // target.
    let producible_without_sam = solver::producible_items(game_data, unlocked_alts, false);
    let sam_forced = targets
        .iter()
        .any(|t| solver::requires_sam_with(&producible_without_sam, &t.item_id, game_data));
    let include_sam = options.include_sam || sam_forced;

    let weights = solver::rarity_weights(game_data);
    let demands: HashMap<String, f32> =
        targets.iter().map(|t| (t.item_id.clone(), t.ipm)).collect();

    // Mixed items need the chain's consumption before their external
    // share is known, and the share feeds back into the chain — a
    // couple of passes converge (recipe mixes are stable; only the
    // scale shifts).
    let mut ext_supply: HashMap<String, f32> = HashMap::new();
    let mut solution: Option<solver::PlanSolution> = None;
    for _pass in 0..4 {
        let input = solver::SolveInput {
            demands: &demands,
            external_supply: &ext_supply,
            cut_items: &full_cuts,
            recipe_overrides: &overrides,
            unlocked_alts,
            include_sam,
        };
        let sol = solver::solve(game_data, &input, &weights, options.solver_budget_ms)
            .map_err(|e| match e {
                solver::SolveError::Unreachable { item_id } => {
                    SolvedComputeError::Structural(PlannerError::NoRecipeForTarget { item_id })
                }
                solver::SolveError::Failed(reason) => SolvedComputeError::Solver(reason),
            })?;

        let mut next: HashMap<String, f32> = HashMap::new();
        for item in &mixed {
            let consumption: f32 = sol
                .recipes
                .iter()
                .filter_map(|(rid, runs)| {
                    game_data.recipe(rid).map(|r| {
                        r.inputs
                            .iter()
                            .filter(|io| io.item_id == *item)
                            .map(|io| io.per_minute as f64 * runs)
                            .sum::<f64>()
                    })
                })
                .sum::<f64>() as f32;
            let share = if let Some(cap) = self_caps.get(item) {
                // Pinned local line: external covers everything past it.
                (consumption - cap.min(consumption)).max(0.0)
            } else {
                // Elastic local line: externals reserve what they can
                // actually deliver, local builds the remainder.
                let mut remaining = consumption;
                let mut taken = 0.0;
                for spec in external_specs.iter().filter(|sp| sp.item_id == *item) {
                    let take = remaining.min(effective_external_cap(spec, export_capacity)).max(0.0);
                    taken += take;
                    remaining -= take;
                }
                taken
            };
            if share > 1e-3 {
                next.insert(item.clone(), share);
            }
        }
        let converged = mixed.iter().all(|m| {
            (next.get(m).copied().unwrap_or(0.0) - ext_supply.get(m).copied().unwrap_or(0.0))
                .abs()
                < 1e-2
        });
        solution = Some(sol);
        if converged {
            break;
        }
        ext_supply = next;
    }
    let sol = solution.expect("loop always sets a solution");

    Ok(assemble_solved_graph(
        &sol,
        &target_ipms,
        &ext_supply,
        &external_specs,
        available_supply,
        export_capacity,
        sam_forced,
        game_data,
    ))
}

/// Turn the optimizer's recipe mix into the renderable graph: stages,
/// per-item flow edges (proportional when an item has several
/// producers), raw/import leaves, byproduct sinks, warnings.
#[allow(clippy::too_many_arguments)]
fn assemble_solved_graph(
    sol: &solver::PlanSolution,
    target_ipms: &HashMap<&str, f32>,
    mixed_ext_supply: &HashMap<String, f32>,
    external_specs: &[PlanImportSpec],
    available_supply: &HashMap<String, f32>,
    export_capacity: &HashMap<(String, String), f32>,
    sam_forced: bool,
    game_data: &GameData,
) -> PlanGraph {
    let mut warnings: Vec<PlanWarning> = Vec::new();

    // Stages from the chosen mix. Node keys stay item-based (layouts
    // survive recipe swaps); a second primary producer of the same
    // item gets a recipe-suffixed key.
    struct SolvedStage {
        node_key: String,
        primary_item: String,
        stage: ChainStage,
    }
    let mut used_keys: HashSet<String> = HashSet::new();
    let mut stages: Vec<SolvedStage> = Vec::new();
    for (recipe_id, runs) in &sol.recipes {
        let Some(recipe) = game_data.recipe(recipe_id) else { continue };
        // The node's face is normally the recipe's first output, but a
        // demanded item keeps its identity even as a secondary output —
        // Polymer Resin made via the Fuel recipe is still the Resin
        // product, badge and all.
        let primary = recipe
            .outputs
            .iter()
            .find(|o| target_ipms.contains_key(o.item_id.as_str()))
            .or_else(|| recipe.outputs.first());
        let Some(primary) = primary else { continue };
        let demand_ipm = primary.per_minute as f64 * runs;
        let stage = build_stage(&primary.item_id, demand_ipm as f32, recipe, game_data);
        let base_key = recipe_node_key(&primary.item_id);
        let node_key = if used_keys.insert(base_key.clone()) {
            base_key
        } else {
            let k = format!("{base_key}:{recipe_id}");
            used_keys.insert(k.clone());
            k
        };
        stages.push(SolvedStage { node_key, primary_item: primary.item_id.clone(), stage });
    }

    // Net flow per (node, item): a recipe consuming its own byproduct
    // nets out inside the node instead of drawing a self-edge.
    let mut producers: HashMap<String, Vec<(String, f32)>> = HashMap::new();
    let mut consumers: HashMap<String, Vec<(String, f32)>> = HashMap::new();
    for s in &stages {
        let mut net: HashMap<&str, f32> = HashMap::new();
        for io in &s.stage.outputs {
            *net.entry(io.item_id.as_str()).or_insert(0.0) += io.per_minute;
        }
        for io in &s.stage.inputs {
            *net.entry(io.item_id.as_str()).or_insert(0.0) -= io.per_minute;
        }
        for (item, ipm) in net {
            if ipm > 1e-3 {
                producers.entry(item.to_string()).or_default().push((s.node_key.clone(), ipm));
            } else if ipm < -1e-3 {
                consumers.entry(item.to_string()).or_default().push((s.node_key.clone(), -ipm));
            }
        }
    }

    // Raw extraction + imports are producers too.
    let mut raw_items: Vec<(&String, &f64)> = sol.raw_extraction.iter().collect();
    raw_items.sort_by(|a, b| a.0.cmp(b.0));
    for (item, ipm) in &raw_items {
        producers
            .entry((*item).clone())
            .or_default()
            .push((raw_node_key(item), **ipm as f32));
    }
    // Full cuts (from the LP) and mixed external shares both surface
    // as import nodes.
    let mut import_ipm: HashMap<String, f32> = sol
        .imported
        .iter()
        .map(|(item, ipm)| (item.clone(), *ipm as f32))
        .collect();
    for (item, share) in mixed_ext_supply {
        *import_ipm.entry(item.clone()).or_insert(0.0) += *share;
    }
    for (item, ipm) in &import_ipm {
        if *ipm > 1e-3 {
            producers
                .entry(item.clone())
                .or_default()
                .push((import_node_key(item), *ipm));
        }
    }
    // Surplus sinks consume.
    let mut surplus_items: Vec<(&String, &f64)> = sol.surplus.iter().collect();
    surplus_items.sort_by(|a, b| a.0.cmp(b.0));
    for (item, ipm) in &surplus_items {
        consumers
            .entry((*item).clone())
            .or_default()
            .push((byproduct_node_key(item), **ipm as f32));
    }

    // Edges: each consumer draws from every producer proportionally to
    // that producer's share of the item — same convention the greedy
    // path used for its local/import splits.
    let primary_by_key: HashMap<&str, &str> = stages
        .iter()
        .map(|s| (s.node_key.as_str(), s.primary_item.as_str()))
        .collect();
    let mut edges: Vec<PlanEdge> = Vec::new();
    let mut item_ids: Vec<&String> = consumers.keys().collect();
    item_ids.sort();
    for item in item_ids {
        let needs = &consumers[item];
        let Some(prods) = producers.get(item) else { continue };
        let total: f32 = prods.iter().map(|(_, ipm)| ipm).sum();
        if total <= 1e-3 {
            continue;
        }
        for (to_node, need) in needs {
            for (from_node, prod) in prods {
                let ipm = need * (prod / total);
                if ipm <= 1e-3 || from_node == to_node {
                    continue;
                }
                // A byproduct flowing back into the chain is a reuse
                // line; surplus heading to the sink is just surplus.
                let is_reuse = primary_by_key
                    .get(from_node.as_str())
                    .map(|primary| *primary != item.as_str())
                    .unwrap_or(false)
                    && !to_node.starts_with("byproduct:");
                edges.push(PlanEdge {
                    id: format!("{from_node}->{to_node}:{item}"),
                    from_node: from_node.clone(),
                    to_node: to_node.clone(),
                    item_id: item.clone(),
                    item_name: item_name(item, game_data),
                    ipm,
                    is_reuse,
                });
            }
        }
    }

    // Emit recipe nodes leaves-first (Kahn over recipe→recipe edges,
    // recycling loops broken in key order), targets at the end — the
    // reading order the designer always had.
    let stage_order = {
        let keys: Vec<String> = stages.iter().map(|s| s.node_key.clone()).collect();
        let key_set: HashSet<&String> = keys.iter().collect();
        let mut deps: HashMap<&String, HashSet<&String>> = HashMap::new();
        for e in &edges {
            if key_set.contains(&e.from_node) && key_set.contains(&e.to_node) {
                deps.entry(&e.to_node).or_default().insert(&e.from_node);
            }
        }
        let mut remaining: Vec<&String> = keys.iter().collect();
        let mut done: HashSet<&String> = HashSet::new();
        let mut order: Vec<String> = Vec::new();
        while !remaining.is_empty() {
            let idx = remaining
                .iter()
                .position(|k| {
                    deps.get(*k).map(|d| d.iter().all(|f| done.contains(*f))).unwrap_or(true)
                })
                // Cycle (e.g. water recycling): take the first node and
                // let the rest unwind.
                .unwrap_or(0);
            let k = remaining.remove(idx);
            done.insert(k);
            order.push(k.clone());
        }
        order
    };
    let mut nodes: Vec<PlanNode> = Vec::new();
    let mut ordered: Vec<&SolvedStage> = Vec::new();
    for key in &stage_order {
        if let Some(s) = stages.iter().find(|s| &s.node_key == key) {
            ordered.push(s);
        }
    }
    ordered.sort_by_key(|s| target_ipms.contains_key(s.primary_item.as_str()));
    for s in ordered {
        let is_target = target_ipms.contains_key(s.primary_item.as_str());
        nodes.push(PlanNode::Recipe {
            node_key: s.node_key.clone(),
            item_id: s.primary_item.clone(),
            item_name: item_name(&s.primary_item, game_data),
            recipe_id: s.stage.recipe_id.clone(),
            recipe_name: s.stage.recipe_name.clone(),
            building_id: s.stage.building_id.clone(),
            building_name: s.stage.building_name.clone(),
            machine_count: s.stage.machine_count,
            clock_pct: s.stage.clock_pct,
            power_mw: s.stage.power_mw,
            output_ipm: s.stage.output_ipm,
            is_alt: s.stage.is_alt,
            is_target,
            target_ipm: target_ipms.get(s.primary_item.as_str()).copied(),
            inputs: s.stage.inputs.clone(),
            outputs: s.stage.outputs.clone(),
        });
    }

    let mut raw_demand: HashMap<String, f32> = HashMap::new();
    for (item, ipm) in &raw_items {
        let ipm = **ipm as f32;
        raw_demand.insert((*item).clone(), ipm);
        let claimed = *available_supply.get(*item).unwrap_or(&0.0);
        nodes.push(PlanNode::Raw {
            node_key: raw_node_key(item),
            item_id: (*item).clone(),
            item_name: item_name(item, game_data),
            ipm,
            claimed_supply_ipm: claimed,
        });
        if ipm > claimed + 1e-3 {
            warnings.push(PlanWarning::RawShort {
                item_id: (*item).clone(),
                item_name: item_name(item, game_data),
                demand_ipm: ipm,
                claimed_ipm: claimed,
            });
        }
    }

    let mut import_items: Vec<(&String, &f32)> = import_ipm.iter().collect();
    import_items.sort_by(|a, b| a.0.cmp(b.0));
    for (item, demand) in import_items {
        if *demand <= 1e-3 {
            continue;
        }
        let (allocations, unassigned, has_unsourced_spec) =
            allocate_import_specs(item, *demand, external_specs, export_capacity);
        if unassigned > 0.0 {
            if has_unsourced_spec || allocations.is_empty() {
                warnings.push(PlanWarning::ImportUnsourced {
                    item_id: item.clone(),
                    item_name: item_name(item, game_data),
                    ipm: unassigned,
                });
            } else {
                warnings.push(PlanWarning::ImportShort {
                    item_id: item.clone(),
                    item_name: item_name(item, game_data),
                    gap_ipm: unassigned,
                });
            }
        }
        nodes.push(PlanNode::Import {
            node_key: import_node_key(item),
            item_id: item.clone(),
            item_name: item_name(item, game_data),
            ipm: *demand,
            allocations,
            unassigned_ipm: unassigned,
        });
    }

    for (item, surplus) in &surplus_items {
        let ipm = **surplus as f32;
        let is_fluid = game_data.item(item).map(|i| i.is_fluid).unwrap_or(false);
        nodes.push(PlanNode::Byproduct {
            node_key: byproduct_node_key(item),
            item_id: (*item).clone(),
            item_name: item_name(item, game_data),
            surplus_ipm: ipm,
            is_fluid,
        });
        if is_fluid {
            warnings.push(PlanWarning::FluidSurplus {
                item_id: (*item).clone(),
                item_name: item_name(item, game_data),
                ipm,
            });
        }
    }

    let total_machines = nodes
        .iter()
        .map(|n| match n {
            PlanNode::Recipe { machine_count, .. } => *machine_count,
            _ => 0,
        })
        .sum();
    let total_power_mw = nodes
        .iter()
        .map(|n| match n {
            PlanNode::Recipe { power_mw, .. } => *power_mw,
            _ => 0.0,
        })
        .sum();

    PlanGraph {
        nodes,
        edges,
        total_machines,
        total_power_mw,
        raw_demand,
        warnings,
        sam_forced,
    }
}

/// Greedy single-recipe-per-item chain — the optimizer's fallback and
/// the legacy behaviour pinned by the older tests.
///
/// Unlike the legacy `derive_chain_with_options`, supply NEVER gates
/// the result — raw gaps, unsourced imports, and cap shortfalls come
/// back as `PlanGraph.warnings` (warn, don't block). Only structural
/// failures (unknown item, no recipe, dataset cycle) return `Err`.
#[allow(clippy::too_many_arguments)]
pub fn compute_plan_graph_greedy(
    factory_id: &str,
    targets: &[PlanTargetSpec],
    unlocked_alts: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    imports: &[PlanImportSpec],
    recipe_overrides: &HashMap<String, String>,
    // Remaining export capacity per (source factory, item), with this
    // factory's own existing draws excluded — caps uncapped sources at
    // what their plan actually offers.
    export_capacity: &HashMap<(String, String), f32>,
    game_data: &GameData,
) -> Result<PlanGraph, PlannerError> {
    if targets.is_empty() {
        return Ok(PlanGraph {
            nodes: vec![],
            edges: vec![],
            total_machines: 0,
            total_power_mw: 0.0,
            raw_demand: HashMap::new(),
            warnings: vec![],
            sam_forced: false,
        });
    }

    let target_ipms: HashMap<&str, f32> =
        targets.iter().map(|t| (t.item_id.as_str(), t.ipm)).collect();

    for t in targets {
        if game_data.item(&t.item_id).is_none() {
            return Err(PlannerError::UnknownTarget { item_id: t.item_id.clone() });
        }
        if game_data.recipes_producing(&t.item_id).is_empty() {
            return Err(PlannerError::NoRecipeForTarget { item_id: t.item_id.clone() });
        }
    }

    // A target is, by definition, built in this factory — an import
    // spec for the same item would cut the target itself out of the
    // graph, so target items never enter the cut set.
    let cut_items: HashSet<String> = imports
        .iter()
        .filter(|s| !target_ipms.contains_key(s.item_id.as_str()))
        .map(|s| s.item_id.clone())
        .collect();

    // A source row pointing at THIS factory means "also build it
    // here": external sources absorb up to their caps and the local
    // line elastically builds the remainder. Items with import rows
    // but no self row are fully imported (the original cut).
    let external_specs: Vec<PlanImportSpec> = imports
        .iter()
        .filter(|sp| sp.source_factory_id.as_deref() != Some(factory_id))
        .cloned()
        .collect();
    let self_items: HashSet<String> = imports
        .iter()
        .filter(|sp| sp.source_factory_id.as_deref() == Some(factory_id))
        .map(|sp| sp.item_id.clone())
        .collect();
    // A cap on the self row pins the local line ("build exactly N here");
    // without one the local line elastically covers whatever the
    // externals can't.
    let self_caps: HashMap<String, f32> = imports
        .iter()
        .filter(|sp| sp.source_factory_id.as_deref() == Some(factory_id))
        .filter_map(|sp| sp.ipm_cap.map(|cap| (sp.item_id.clone(), cap.max(0.0))))
        .collect();

    // Honour the user's recipe choices, dropping invalid ids the same
    // way the legacy path does (stale override must never wedge the
    // plan — the auto pick takes over).
    let mut item_recipes: HashMap<String, String> = HashMap::new();
    for (item_id, recipe_id) in recipe_overrides {
        let valid = game_data.recipe(recipe_id).is_some_and(|r| {
            !is_inverse_recipe(&r.id)
                && (!r.is_alt || unlocked_alts.contains(&r.id))
                && r.outputs.iter().any(|o| o.item_id == *item_id)
        });
        if valid {
            item_recipes.insert(item_id.clone(), recipe_id.clone());
        }
    }

    // Seed the recursion once per target, sharing every accumulator so
    // overlapping chains fold (Cable + Wire targets share the Wire
    // subtree and Wire lands on a single node sized for both).
    let mut raw_demand: HashMap<String, f32> = HashMap::new();
    let mut imported_demand: HashMap<String, f32> = HashMap::new();
    let mut item_demands: HashMap<String, f32> = HashMap::new();
    let mut visit_order: Vec<String> = Vec::new();
    let mut supply_cache: HashMap<String, bool> = HashMap::new();
    let mut struct_cache: HashMap<String, bool> = HashMap::new();
    let mut visiting: HashSet<String> = HashSet::new();
    for t in targets {
        collect_demands(
            &t.item_id,
            t.ipm,
            unlocked_alts,
            available_supply,
            &cut_items,
            game_data,
            &mut raw_demand,
            &mut imported_demand,
            &mut item_demands,
            &mut item_recipes,
            &mut visit_order,
            &mut supply_cache,
            &mut struct_cache,
            &mut visiting,
        )?;
    }

    // Mixed items expand in waves: every round computes each mixed
    // item's local remainder (demand − external caps) and seeds the
    // delta back through the normal recursion. A seed can add demand
    // to ANOTHER mixed item, so repeat until the deltas dry up —
    // demand only ever grows, so this converges (20 rounds is far
    // beyond any sane chain depth).
    let mixed_items: Vec<String> = {
        let mut v: Vec<String> = cut_items
            .iter()
            .filter(|i| self_items.contains(*i))
            .cloned()
            .collect();
        v.sort();
        v
    };
    let mut seeded_local: HashMap<String, f32> = HashMap::new();
    if !mixed_items.is_empty() {
        for _round in 0..20 {
            let mut any_delta = false;
            for item in &mixed_items {
                let demand = *imported_demand.get(item).unwrap_or(&0.0);
                let local_needed = if let Some(cap) = self_caps.get(item) {
                    // Pinned local line: build exactly the cap (or the
                    // whole demand if it's smaller); externals cover
                    // the rest and any gap surfaces as a warning.
                    cap.min(demand)
                } else {
                    // Elastic local line: externals reserve in
                    // declared order up to what they can actually
                    // deliver, the local line builds the remainder.
                    let mut remaining = demand;
                    for spec in external_specs.iter().filter(|sp| sp.item_id == *item) {
                        let take = remaining.min(effective_external_cap(spec, export_capacity));
                        remaining = (remaining - take.max(0.0)).max(0.0);
                    }
                    remaining
                };
                let already = *seeded_local.get(item).unwrap_or(&0.0);
                let delta = local_needed - already;
                if delta > 1e-3 {
                    any_delta = true;
                    seeded_local.insert(item.clone(), local_needed);
                    // Un-cut the item for this seed so its own recipe
                    // node grows by exactly `delta`.
                    let mut cut_without = cut_items.clone();
                    cut_without.remove(item);
                    collect_demands(
                        item,
                        delta,
                        unlocked_alts,
                        available_supply,
                        &cut_without,
                        game_data,
                        &mut raw_demand,
                        &mut imported_demand,
                        &mut item_demands,
                        &mut item_recipes,
                        &mut visit_order,
                        &mut supply_cache,
                        &mut struct_cache,
                        &mut visiting,
                    )?;
                }
            }
            if !any_delta {
                break;
            }
        }
    }

    let mut nodes: Vec<PlanNode> = Vec::new();
    let mut edges: Vec<PlanEdge> = Vec::new();
    let mut warnings: Vec<PlanWarning> = Vec::new();

    // Recipe nodes — one per visited item, leaves-first, sized via the
    // same bank math the legacy stage list used.
    let mut byproducts: Vec<(String, f32)> = Vec::new(); // (item_id, surplus ipm), insertion-ordered
    for item_id in &visit_order {
        let demand = *item_demands.get(item_id).unwrap_or(&0.0);
        let recipe_id = item_recipes
            .get(item_id)
            .expect("collect_demands records a recipe per visited item");
        let recipe = game_data
            .recipe(recipe_id)
            .expect("recipe id came from gamedata");
        let stage = build_stage(item_id, demand, recipe, game_data);
        let node_key = recipe_node_key(item_id);

        // Input edges. Mixed items have TWO producers — the local
        // line and the import — so consumers get a proportional edge
        // from each; everything else folds to a single producer.
        for io in &stage.inputs {
            let is_cut = cut_items.contains(&io.item_id);
            let local = *seeded_local.get(&io.item_id).unwrap_or(&0.0);
            let total = *imported_demand.get(&io.item_id).unwrap_or(&0.0);
            if is_cut && local > 1e-3 && total > 1e-3 {
                let local_frac = (local / total).min(1.0);
                let local_ipm = io.per_minute * local_frac;
                let import_ipm = io.per_minute - local_ipm;
                if local_ipm > 1e-3 {
                    let from = recipe_node_key(&io.item_id);
                    edges.push(PlanEdge {
                        id: format!("{from}->{node_key}:local"),
                        from_node: from,
                        to_node: node_key.clone(),
                        item_id: io.item_id.clone(),
                        item_name: io.item_name.clone(),
                        ipm: local_ipm,
                        is_reuse: false,
                    });
                }
                if import_ipm > 1e-3 {
                    let from = import_node_key(&io.item_id);
                    edges.push(PlanEdge {
                        id: format!("{from}->{node_key}:import"),
                        from_node: from,
                        to_node: node_key.clone(),
                        item_id: io.item_id.clone(),
                        item_name: io.item_name.clone(),
                        ipm: import_ipm,
                        is_reuse: false,
                    });
                }
                continue;
            }
            let from = if is_cut {
                import_node_key(&io.item_id)
            } else if game_data.is_extracted_resource(&io.item_id) {
                raw_node_key(&io.item_id)
            } else {
                recipe_node_key(&io.item_id)
            };
            edges.push(PlanEdge {
                id: format!("{from}->{node_key}"),
                from_node: from,
                to_node: node_key.clone(),
                item_id: io.item_id.clone(),
                item_name: io.item_name.clone(),
                ipm: io.per_minute,
                is_reuse: false,
            });
        }

        // Secondary outputs are surplus — no netting against demand in
        // v1, but they're shown honestly as byproduct sink nodes.
        for io in &stage.outputs {
            if io.item_id == *item_id || io.per_minute <= 1e-3 {
                continue;
            }
            let bp_key = byproduct_node_key(&io.item_id);
            edges.push(PlanEdge {
                id: format!("{node_key}->{bp_key}"),
                from_node: node_key.clone(),
                to_node: bp_key,
                item_id: io.item_id.clone(),
                item_name: io.item_name.clone(),
                ipm: io.per_minute,
                is_reuse: false,
            });
            if let Some(entry) = byproducts.iter_mut().find(|(id, _)| id == &io.item_id) {
                entry.1 += io.per_minute;
            } else {
                byproducts.push((io.item_id.clone(), io.per_minute));
            }
        }

        let is_target = target_ipms.contains_key(item_id.as_str());
        nodes.push(PlanNode::Recipe {
            node_key,
            item_id: item_id.clone(),
            item_name: item_name(item_id, game_data),
            recipe_id: stage.recipe_id,
            recipe_name: stage.recipe_name,
            building_id: stage.building_id,
            building_name: stage.building_name,
            machine_count: stage.machine_count,
            clock_pct: stage.clock_pct,
            power_mw: stage.power_mw,
            output_ipm: stage.output_ipm,
            is_alt: stage.is_alt,
            is_target,
            target_ipm: target_ipms.get(item_id.as_str()).copied(),
            inputs: stage.inputs,
            outputs: stage.outputs,
        });
    }

    // Raw nodes, sorted for a deterministic graph (HashMap order isn't).
    let mut raw_items: Vec<(&String, &f32)> = raw_demand.iter().collect();
    raw_items.sort_by(|a, b| a.0.cmp(b.0));
    for (item_id, demand) in raw_items {
        let claimed = *available_supply.get(item_id).unwrap_or(&0.0);
        nodes.push(PlanNode::Raw {
            node_key: raw_node_key(item_id),
            item_id: item_id.clone(),
            item_name: item_name(item_id, game_data),
            ipm: *demand,
            claimed_supply_ipm: claimed,
        });
        if *demand > claimed + 1e-3 {
            warnings.push(PlanWarning::RawShort {
                item_id: item_id.clone(),
                item_name: item_name(item_id, game_data),
                demand_ipm: *demand,
                claimed_ipm: claimed,
            });
        }
    }

    // Import nodes — one per cut item with EXTERNAL demand (a mixed
    // item whose local line covers everything has no import node).
    let mut import_items: Vec<(&String, &f32)> = imported_demand.iter().collect();
    import_items.sort_by(|a, b| a.0.cmp(b.0));
    for (item_id, total_demand) in import_items {
        let local = *seeded_local.get(item_id.as_str()).unwrap_or(&0.0);
        let external = (*total_demand - local).max(0.0);
        if external <= 1e-3 {
            continue;
        }
        let demand = &external;
        let (allocations, unassigned, has_unsourced_spec) =
            allocate_import_specs(item_id, *demand, &external_specs, export_capacity);
        if unassigned > 0.0 {
            if has_unsourced_spec || allocations.is_empty() {
                warnings.push(PlanWarning::ImportUnsourced {
                    item_id: item_id.clone(),
                    item_name: item_name(item_id, game_data),
                    ipm: unassigned,
                });
            } else {
                warnings.push(PlanWarning::ImportShort {
                    item_id: item_id.clone(),
                    item_name: item_name(item_id, game_data),
                    gap_ipm: unassigned,
                });
            }
        }
        nodes.push(PlanNode::Import {
            node_key: import_node_key(item_id),
            item_id: item_id.clone(),
            item_name: item_name(item_id, game_data),
            ipm: *demand,
            allocations,
            unassigned_ipm: unassigned,
        });
    }

    for (item_id, surplus) in byproducts {
        nodes.push(PlanNode::Byproduct {
            node_key: byproduct_node_key(&item_id),
            item_name: item_name(&item_id, game_data),
            is_fluid: game_data.item(&item_id).map(|i| i.is_fluid).unwrap_or(false),
            item_id,
            surplus_ipm: surplus,
        });
    }

    let total_machines = nodes
        .iter()
        .map(|n| match n {
            PlanNode::Recipe { machine_count, .. } => *machine_count,
            _ => 0,
        })
        .sum();
    let total_power_mw = nodes
        .iter()
        .map(|n| match n {
            PlanNode::Recipe { power_mw, .. } => *power_mw,
            _ => 0.0,
        })
        .sum();

    Ok(PlanGraph {
        nodes,
        edges,
        total_machines,
        total_power_mw,
        raw_demand,
        warnings,
        sam_forced: {
            let producible_without_sam =
                solver::producible_items(game_data, unlocked_alts, false);
            targets.iter().any(|t| {
                solver::requires_sam_with(&producible_without_sam, &t.item_id, game_data)
            })
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unlocked() -> HashSet<String> {
        HashSet::new()
    }

    #[test]
    fn cycle_detected_error_serialises_with_camelcase_item_id() {
        // Defence-in-depth: a cycleDetected error rendered in the UI
        // was showing "involving — please report." with the item id
        // missing. The Rust value has the id, so the regression here
        // is on the JSON shape — the UI binds `itemId`, and serde's
        // `rename_all = "camelCase"` must rename `item_id` to match.
        let err = PlannerError::CycleDetected {
            item_id: "Desc_AluminaSolution_C".into(),
        };
        let json = serde_json::to_string(&err).expect("serialise");
        assert!(json.contains("\"itemId\":\"Desc_AluminaSolution_C\""), "got {json}");
        assert!(json.contains("\"kind\":\"cycleDetected\""), "got {json}");
    }

    // ---------- compute_plan_graph tests ----------

    fn target(item: &str, ipm: f32) -> PlanTargetSpec {
        PlanTargetSpec { item_id: item.to_string(), ipm, export_ipm: None }
    }

    fn import_spec(item: &str, source: Option<&str>, cap: Option<f32>) -> PlanImportSpec {
        PlanImportSpec {
            item_id: item.to_string(),
            source_factory_id: source.map(str::to_string),
            ipm_cap: cap,
        }
    }

    fn recipe_keys(graph: &PlanGraph) -> Vec<&str> {
        graph
            .nodes
            .iter()
            .filter_map(|n| match n {
                PlanNode::Recipe { node_key, .. } => Some(node_key.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn raw_and_unknown_targets_are_structural_errors() {
        let gd = GameData::from_bundled().unwrap();
        let raw = compute_plan_graph(
            "fac-self",
            &[target("Desc_OreIron_C", 30.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap_err();
        assert!(matches!(raw, PlannerError::NoRecipeForTarget { .. }));

        let unknown = compute_plan_graph(
            "fac-self",
            &[target("Desc_DefinitelyNotAThing_C", 30.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap_err();
        assert!(matches!(unknown, PlannerError::UnknownTarget { .. }));
    }

    #[test]
    fn supply_viability_still_steers_the_recipe_pick() {
        // Ported from the legacy derive tests: the water-using Pure
        // Iron Ingot alt only wins the pick when water is actually
        // claimable; without it the planner falls back to standard.
        let gd = GameData::from_bundled().unwrap();
        let pure_iron = gd
            .recipes()
            .iter()
            .find(|r| {
                r.is_alt
                    && r.outputs.iter().any(|o| o.item_id == "Desc_IronIngot_C")
                    && r.inputs.iter().any(|i| i.item_id == "Desc_Water_C")
            })
            .expect("dataset ships a water-using iron-ingot alt");
        let mut alts = HashSet::new();
        alts.insert(pure_iron.id.clone());

        let recipe_for_ingot = |supply: &HashMap<String, f32>| {
            // Supply-viability steering is a property of the greedy
            // fallback — the optimizer ranks by map rarity instead.
            let graph = compute_plan_graph_greedy(
                "fac-self",
                &[target("Desc_IronIngot_C", 60.0)],
                &alts,
                supply,
                &[],
                &HashMap::new(),
                &HashMap::new(),
                &gd,
            )
            .unwrap();
            graph
                .nodes
                .iter()
                .find_map(|n| match n {
                    PlanNode::Recipe { item_id, recipe_id, .. }
                        if item_id == "Desc_IronIngot_C" =>
                        Some(recipe_id.clone()),
                    _ => None,
                })
                .expect("ingot node")
        };

        let mut iron_only = HashMap::new();
        iron_only.insert("Desc_OreIron_C".to_string(), 10000.0);
        assert_ne!(recipe_for_ingot(&iron_only), pure_iron.id);

        let mut with_water = iron_only.clone();
        with_water.insert("Desc_Water_C".to_string(), 1000.0);
        assert_eq!(recipe_for_ingot(&with_water), pure_iron.id);
    }

    #[test]
    fn invalid_recipe_override_falls_back_to_auto_pick() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 10000.0);
        let mut overrides = HashMap::new();
        overrides.insert(
            "Desc_IronIngot_C".to_string(),
            "Recipe_DefinitelyNotARecipe_C".to_string(),
        );
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_IronIngot_C", 60.0)],
            &unlocked(),
            &supply,
            &[],
            &overrides,
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .expect("stale override must never wedge the plan");
        let recipe = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Recipe { recipe_id, .. } => Some(recipe_id.clone()),
                _ => None,
            })
            .unwrap();
        assert_eq!(recipe, "Recipe_IngotIron_C");
    }

    #[test]
    fn unpackage_recipes_never_enter_the_graph() {
        // Regression port: Unpackage_* candidates once cycled alumina
        // chains. Empty supply forces the structural-fallback path
        // where the bug originally lived.
        let gd = GameData::from_bundled().unwrap();
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_AluminumPlate_C", 60.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .expect("aluminum chain must compute without cycles");
        for n in &graph.nodes {
            if let PlanNode::Recipe { recipe_id, .. } = n {
                assert!(!is_inverse_recipe(recipe_id), "{recipe_id} is an Unpackage recipe");
            }
        }
        assert!(recipe_keys(&graph).len() >= 4, "expected a multi-step chain");
    }

    #[test]
    fn multiple_sources_for_one_item_allocate_in_declared_order() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 100000.0);
        // Cable @60 needs ~120 Wire: first source saturates its 50
        // cap, the second (uncapped) absorbs the rest because its
        // plan actually offers enough.
        let mut capacity = HashMap::new();
        capacity.insert(("fac-B".to_string(), "Desc_Wire_C".to_string()), 100.0);
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[
                import_spec("Desc_Wire_C", Some("fac-A"), Some(50.0)),
                import_spec("Desc_Wire_C", Some("fac-B"), None),
            ],
            &HashMap::new(),
            &capacity,
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let allocations = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Import { item_id, allocations, unassigned_ipm, .. }
                    if item_id == "Desc_Wire_C" =>
                    Some((allocations.clone(), *unassigned_ipm)),
                _ => None,
            })
            .expect("wire import node");
        assert_eq!(allocations.0.len(), 2);
        assert_eq!(allocations.0[0].source_factory_id, "fac-A");
        assert!((allocations.0[0].resolved_ipm - 50.0).abs() < 1e-3);
        assert_eq!(allocations.0[1].source_factory_id, "fac-B");
        assert!((allocations.0[1].resolved_ipm - 70.0).abs() < 0.5);
        assert_eq!(allocations.1, 0.0, "everything covered → nothing unassigned");
        assert!(graph.warnings.is_empty(), "{:?}", graph.warnings);
    }

    #[test]
    fn recipe_nodes_arrive_leaves_first_with_no_duplicates() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 100000.0);
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_IronPlateReinforced_C", 10.0)],
            &unlocked(),
            &supply,
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let keys = recipe_keys(&graph);
        let mut seen = HashSet::new();
        for k in &keys {
            assert!(seen.insert(*k), "duplicate node {k}");
        }
        assert_eq!(
            keys.last().copied(),
            Some("recipe:Desc_IronPlateReinforced_C"),
            "the target sits at the end of the leaves-first order"
        );
    }

    #[test]
    fn mixed_source_splits_local_and_external_production() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 100000.0);
        // Cable @60 needs 120 Wire. External factory caps at 50; a
        // self row keeps the local line, which builds the other 70.
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[
                import_spec("Desc_Wire_C", Some("fac-wire"), Some(50.0)),
                import_spec("Desc_Wire_C", Some("fac-self"), None),
            ],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();

        let wire_recipe = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Recipe { item_id, output_ipm, .. } if item_id == "Desc_Wire_C" =>
                    Some(*output_ipm),
                _ => None,
            })
            .expect("local wire line exists");
        assert!((wire_recipe - 70.0).abs() < 0.5, "local builds the remainder, got {wire_recipe}");

        let import = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Import { item_id, ipm, allocations, unassigned_ipm, .. }
                    if item_id == "Desc_Wire_C" =>
                    Some((*ipm, allocations.clone(), *unassigned_ipm)),
                _ => None,
            })
            .expect("import node carries the external share");
        assert!((import.0 - 50.0).abs() < 0.5);
        assert_eq!(import.1.len(), 1);
        assert!((import.1[0].resolved_ipm - 50.0).abs() < 0.5);
        assert_eq!(import.2, 0.0, "local elasticity leaves nothing unassigned");
        assert!(graph.warnings.iter().all(|w| !matches!(w, PlanWarning::ImportShort { .. })));

        // The local line pulls copper upstream — ore demand reflects
        // only the 70/min remainder (70 wire → 35 ingot → 35 ore).
        let ore = graph.raw_demand.get("Desc_OreCopper_C").copied().unwrap_or(0.0);
        assert!((ore - 35.0).abs() < 1.0, "got {ore}");

        // Consumers get a split edge from each producer.
        let to_cable: Vec<&PlanEdge> = graph
            .edges
            .iter()
            .filter(|e| e.to_node == "recipe:Desc_Cable_C" && e.item_id == "Desc_Wire_C")
            .collect();
        assert_eq!(to_cable.len(), 2, "one edge from the local line, one from the import");
    }

    #[test]
    fn uncapped_source_with_no_real_exports_leaves_production_local() {
        // The bug Gordon hit live: picking "iron smelter" as a Wire
        // source before that factory exports anything tore the local
        // line down to 0/min. An uncapped source only reserves what
        // its plan actually offers — nothing on offer, nothing taken.
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 100000.0);
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[
                import_spec("Desc_Wire_C", Some("fac-smelter"), None),
                import_spec("Desc_Wire_C", Some("fac-self"), None),
            ],
            &HashMap::new(),
            &HashMap::new(), // fac-smelter exports nothing
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let wire_local = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Recipe { item_id, output_ipm, .. } if item_id == "Desc_Wire_C" =>
                    Some(*output_ipm),
                _ => None,
            })
            .expect("local wire line must survive");
        assert!((wire_local - 120.0).abs() < 0.5, "local builds everything, got {wire_local}");
        assert!(
            !graph.nodes.iter().any(|n| matches!(
                n,
                PlanNode::Import { item_id, .. } if item_id == "Desc_Wire_C"
            )),
            "nothing actually imported → no import node"
        );
    }

    #[test]
    fn self_row_cap_pins_the_local_share() {
        // "Build it here" with an explicit amount: local builds the
        // cap, externals cover the rest up to what they offer, and any
        // gap warns instead of blocking.
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 100000.0);
        let mut capacity = HashMap::new();
        capacity.insert(("fac-wire".to_string(), "Desc_Wire_C".to_string()), 30.0);
        // Cable @60 needs 120 Wire. Local pinned at 80; fac-wire only
        // offers 30 → 10 short.
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[
                import_spec("Desc_Wire_C", Some("fac-wire"), None),
                import_spec("Desc_Wire_C", Some("fac-self"), Some(80.0)),
            ],
            &HashMap::new(),
            &capacity,
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let wire_local = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Recipe { item_id, output_ipm, .. } if item_id == "Desc_Wire_C" =>
                    Some(*output_ipm),
                _ => None,
            })
            .expect("pinned local wire line");
        assert!((wire_local - 80.0).abs() < 0.5, "local pinned at 80, got {wire_local}");
        let import = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Import { item_id, ipm, allocations, unassigned_ipm, .. }
                    if item_id == "Desc_Wire_C" =>
                    Some((*ipm, allocations.clone(), *unassigned_ipm)),
                _ => None,
            })
            .expect("import node carries the external share");
        assert!((import.0 - 40.0).abs() < 0.5, "external share = 120 - 80, got {}", import.0);
        assert!((import.1[0].resolved_ipm - 30.0).abs() < 0.5, "capacity-limited allocation");
        assert!((import.2 - 10.0).abs() < 0.5, "gap surfaces as unassigned");
        assert!(graph.warnings.iter().any(|w| matches!(w, PlanWarning::ImportShort { .. })));
    }

    #[test]
    fn secondary_output_target_keeps_its_identity() {
        // Polymer Resin (no alts) only comes out of refineries as a
        // secondary output — the node must still present as the Resin
        // product, not as "Fuel".
        let gd = GameData::from_bundled().unwrap();
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_PolymerResin_C", 60.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let resin = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Recipe { item_id, is_target, target_ipm, .. }
                    if item_id == "Desc_PolymerResin_C" =>
                    Some((*is_target, *target_ipm)),
                _ => None,
            })
            .expect("resin keeps its identity as a node");
        assert!(resin.0, "resin node carries the Product badge");
        assert_eq!(resin.1, Some(60.0));
    }

    #[test]
    fn byproduct_feeds_are_flagged_as_reuse_edges() {
        // Aluminum Ingot consumes the alumina refinery's silica
        // byproduct — that edge is a reuse line; the primary flows
        // (alumina → scrap, scrap → ingot) are not.
        let gd = GameData::from_bundled().unwrap();
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_AluminumIngot_C", 60.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let reuse: Vec<&PlanEdge> = graph.edges.iter().filter(|e| e.is_reuse).collect();
        assert!(
            reuse.iter().any(|e| e.item_id == "Desc_Silica_C"),
            "silica byproduct feed must be a reuse edge: {:?}",
            reuse.iter().map(|e| &e.id).collect::<Vec<_>>()
        );
        assert!(
            graph
                .edges
                .iter()
                .filter(|e| e.item_id == "Desc_AluminumScrap_C")
                .all(|e| !e.is_reuse),
            "primary scrap flow must not be flagged"
        );
    }

    #[test]
    fn removing_the_self_row_is_a_full_cut() {
        let gd = GameData::from_bundled().unwrap();
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &HashMap::new(),
            &[import_spec("Desc_Wire_C", Some("fac-wire"), None)],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        assert!(
            !recipe_keys(&graph).contains(&"recipe:Desc_Wire_C"),
            "no self row → no local line"
        );
    }

    #[test]
    fn empty_targets_compute_an_empty_graph() {
        let gd = GameData::from_bundled().unwrap();
        let graph = compute_plan_graph(
            "fac-self",
            &[],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        assert!(graph.nodes.is_empty() && graph.edges.is_empty() && graph.warnings.is_empty());
    }

    #[test]
    fn cable_graph_has_recipe_raw_nodes_and_connected_edges() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 1000.0);
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();

        // Copper Ore → Copper Ingot → Wire → Cable.
        let keys = recipe_keys(&graph);
        assert!(keys.contains(&"recipe:Desc_Cable_C"));
        assert!(keys.contains(&"recipe:Desc_Wire_C"));
        assert!(
            graph.nodes.iter().any(|n| matches!(
                n,
                PlanNode::Raw { item_id, .. } if item_id == "Desc_OreCopper_C"
            )),
            "copper ore raw node expected"
        );
        // Every edge endpoint resolves to a real node.
        let node_keys: HashSet<&str> = graph.nodes.iter().map(|n| n.node_key()).collect();
        for e in &graph.edges {
            assert!(node_keys.contains(e.from_node.as_str()), "dangling from {}", e.from_node);
            assert!(node_keys.contains(e.to_node.as_str()), "dangling to {}", e.to_node);
        }
        // Cable node is flagged as the target at 60/min.
        let cable = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Recipe { item_id, is_target, target_ipm, output_ipm, .. }
                    if item_id == "Desc_Cable_C" =>
                    Some((*is_target, *target_ipm, *output_ipm)),
                _ => None,
            })
            .expect("cable recipe node");
        assert_eq!(cable.0, true);
        assert_eq!(cable.1, Some(60.0));
        assert!((cable.2 - 60.0).abs() < 0.05);
        assert!(graph.warnings.is_empty(), "supply covers demand: {:?}", graph.warnings);
    }

    #[test]
    fn multi_target_chains_fold_shared_subtrees() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 100000.0);
        // Cable consumes Wire; Wire is also its own target. One Wire
        // node sized for both demands.
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0), target("Desc_Wire_C", 30.0)],
            &unlocked(),
            &supply,
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let wire_nodes: Vec<_> = graph
            .nodes
            .iter()
            .filter_map(|n| match n {
                PlanNode::Recipe { item_id, output_ipm, is_target, target_ipm, .. }
                    if item_id == "Desc_Wire_C" =>
                    Some((*output_ipm, *is_target, *target_ipm)),
                _ => None,
            })
            .collect();
        assert_eq!(wire_nodes.len(), 1, "wire must fold onto one node");
        let (output_ipm, is_target, target_ipm) = wire_nodes[0];
        // Standard Cable needs 120 Wire for 60 Cable + 30 target Wire.
        assert!(output_ipm > 120.0, "wire output must cover cable demand plus its own target, got {output_ipm}");
        assert!(is_target);
        assert_eq!(target_ipm, Some(30.0));
    }

    #[test]
    fn unsourced_cut_removes_subtree_and_warns_import_unsourced() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 100000.0);
        // Cut Copper Ingot with NO source factory — the whole smelting
        // subtree (and its ore demand) must vanish, replaced by an
        // import node carrying the unassigned demand.
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[import_spec("Desc_CopperIngot_C", None, None)],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        assert!(
            !recipe_keys(&graph).contains(&"recipe:Desc_CopperIngot_C"),
            "cut item must not have a recipe node"
        );
        assert!(
            graph.raw_demand.is_empty(),
            "ore demand belongs to the supplying factory now: {:?}",
            graph.raw_demand
        );
        let import = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Import { item_id, ipm, allocations, unassigned_ipm, .. }
                    if item_id == "Desc_CopperIngot_C" =>
                    Some((*ipm, allocations.len(), *unassigned_ipm)),
                _ => None,
            })
            .expect("import node for the cut item");
        assert!(import.0 > 0.0);
        assert_eq!(import.1, 0, "no sources → no allocations");
        assert!((import.2 - import.0).abs() < 1e-3, "all demand unassigned");
        assert!(
            graph.warnings.iter().any(|w| matches!(
                w,
                PlanWarning::ImportUnsourced { item_id, .. } if item_id == "Desc_CopperIngot_C"
            )),
            "unsourced import must warn (not error): {:?}",
            graph.warnings
        );
    }

    #[test]
    fn sourced_cut_allocates_and_caps_warn_import_short() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 100000.0);
        // Cable @60 needs 120 Wire/min on the standard chain. Source A
        // caps at 50 → 70 short, sourced-only → ImportShort.
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[import_spec("Desc_Wire_C", Some("fac-wire"), Some(50.0))],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let import = graph
            .nodes
            .iter()
            .find_map(|n| match n {
                PlanNode::Import { item_id, allocations, unassigned_ipm, .. }
                    if item_id == "Desc_Wire_C" =>
                    Some((allocations.clone(), *unassigned_ipm)),
                _ => None,
            })
            .expect("wire import node");
        assert_eq!(import.0.len(), 1);
        assert_eq!(import.0[0].source_factory_id, "fac-wire");
        assert!((import.0[0].resolved_ipm - 50.0).abs() < 1e-3);
        assert!((import.1 - 70.0).abs() < 0.1, "gap should be ~70, got {}", import.1);
        assert!(graph.warnings.iter().any(|w| matches!(w, PlanWarning::ImportShort { .. })));
    }

    #[test]
    fn raw_gap_warns_but_still_computes() {
        let gd = GameData::from_bundled().unwrap();
        // Zero supply — legacy path would error Insufficient; the plan
        // graph computes anyway and warns (warn, don't block).
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_IronIngot_C", 60.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        assert!(!graph.nodes.is_empty());
        assert!(graph.warnings.iter().any(|w| matches!(
            w,
            PlanWarning::RawShort { item_id, claimed_ipm, .. }
                if item_id == "Desc_OreIron_C" && *claimed_ipm == 0.0
        )));
    }

    #[test]
    fn recipe_override_changes_node_and_keeps_item_based_key() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 100000.0);

        let auto = compute_plan_graph(
            "fac-self",
            &[target("Desc_IronIngot_C", 60.0)],
            &unlocked(),
            &supply,
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();

        let pure_iron = gd
            .recipes()
            .iter()
            .find(|r| {
                r.is_alt
                    && r.outputs.iter().any(|o| o.item_id == "Desc_IronIngot_C")
                    && r.inputs.iter().any(|i| i.item_id == "Desc_Water_C")
            })
            .expect("water-using iron ingot alt");
        let mut alts = HashSet::new();
        alts.insert(pure_iron.id.clone());
        let mut overrides = HashMap::new();
        overrides.insert("Desc_IronIngot_C".to_string(), pure_iron.id.clone());
        let swapped = compute_plan_graph(
            "fac-self",
            &[target("Desc_IronIngot_C", 60.0)],
            &alts,
            &supply,
            &[],
            &overrides,
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();

        let recipe_of = |g: &PlanGraph| {
            g.nodes
                .iter()
                .find_map(|n| match n {
                    PlanNode::Recipe { node_key, item_id, recipe_id, .. }
                        if item_id == "Desc_IronIngot_C" =>
                        Some((node_key.clone(), recipe_id.clone())),
                    _ => None,
                })
                .expect("iron ingot node")
        };
        let (auto_key, auto_recipe) = recipe_of(&auto);
        let (swapped_key, swapped_recipe) = recipe_of(&swapped);
        assert_ne!(auto_recipe, swapped_recipe, "override must change the recipe");
        assert_eq!(swapped_recipe, pure_iron.id);
        assert_eq!(
            auto_key, swapped_key,
            "node key is item-based — a recipe swap keeps the layout position"
        );
        // Knock-on: the alt pulls water into the raw demand.
        assert!(swapped.raw_demand.contains_key("Desc_Water_C"));
    }

    #[test]
    fn import_on_a_target_item_is_ignored() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreCopper_C".into(), 100000.0);
        // Cutting the target itself would delete the whole plan; the
        // spec is ignored and the target still builds here.
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[import_spec("Desc_Cable_C", Some("fac-other"), None)],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        assert!(recipe_keys(&graph).contains(&"recipe:Desc_Cable_C"));
        assert!(
            !graph.nodes.iter().any(|n| matches!(n, PlanNode::Import { .. })),
            "no import node for the target"
        );
    }

    #[test]
    fn byproduct_outputs_get_sink_nodes_and_edges() {
        let gd = GameData::from_bundled().unwrap();
        // Plastic via the standard recipe emits Heavy Oil Residue as a
        // byproduct — the graph shows it as an explicit sink node.
        let graph = compute_plan_graph(
            "fac-self",
            &[target("Desc_Plastic_C", 60.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
            &HashMap::new(),
            &PlanComputeOptions::default(),
            &gd,
        )
        .unwrap();
        let byproducts: Vec<_> = graph
            .nodes
            .iter()
            .filter(|n| matches!(n, PlanNode::Byproduct { .. }))
            .collect();
        assert!(
            !byproducts.is_empty(),
            "plastic chain should surface at least one byproduct sink"
        );
        // Each byproduct node has at least one incoming edge from a recipe.
        for bp in byproducts {
            let key = bp.node_key();
            assert!(
                graph.edges.iter().any(|e| e.to_node == key),
                "byproduct {key} must be wired from its producer"
            );
        }
    }

}
