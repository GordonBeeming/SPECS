//! Pure planner logic. The Tauri command layer (in `commands.rs`) does
//! nothing more than gather the inputs (claims, alts, target spec) and
//! call `derive_chain`; everything that matters is here so the unit
//! tests can pin behaviour against the bundled dataset without going
//! through IPC.

use std::collections::{HashMap, HashSet};

use crate::shared::gamedata::GameData;
use crate::shared::gamedata::types::Recipe;

use super::dto::{
    ChainPlan, ChainStage, ImportAllocation, InputSource, InputSourceKind, PlanEdge,
    PlanGraph, PlanImportSpec, PlanNode, PlanTargetSpec, PlanWarning, PlannerError,
    RecipeFlow, ResolvedImport,
};

/// Per-machine ipm of `item_id` for this recipe at 100% clock with no
/// amplification.
fn recipe_output_rate(recipe: &Recipe, item_id: &str) -> Option<f32> {
    recipe
        .outputs
        .iter()
        .find(|o| o.item_id == item_id)
        .map(|o| o.per_minute)
}

/// Items the user cut out of the build — "this arrives from elsewhere".
/// The recursion stops at a cut item whether or not a source factory is
/// assigned yet; an unsourced cut is a fully valid planning state.
///
/// For the legacy derive path this set comes from `Factory`-kind
/// `InputSource`s; `Node` sources are intentionally ignored — they only
/// make sense for raw items where the chain already terminates.
fn cut_items_from_sources(sources: &[InputSource]) -> HashSet<String> {
    sources
        .iter()
        .filter(|s| matches!(s.source, InputSourceKind::Factory { .. }))
        .map(|s| s.item_id.clone())
        .collect()
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

/// Distribute the demand for one pinned item across its matching
/// `Factory` sources in declared order. Returns the resolved imports
/// (one per source that contributed) plus any unmet gap.
fn allocate_imports(
    item_id: &str,
    total_demand: f32,
    sources: &[InputSource],
    game_data: &GameData,
) -> (Vec<ResolvedImport>, f32) {
    let item_name = game_data
        .item(item_id)
        .map(|i| i.name.clone())
        .unwrap_or_else(|| item_id.to_string());
    let mut remaining = total_demand;
    let mut resolved: Vec<ResolvedImport> = Vec::new();
    for src in sources.iter().filter(|s| s.item_id == item_id) {
        if remaining <= 1e-3 {
            break;
        }
        let InputSourceKind::Factory { id } = &src.source else {
            continue;
        };
        let cap = src.ipm_cap.unwrap_or(f32::INFINITY);
        let take = remaining.min(cap);
        if take <= 0.0 {
            continue;
        }
        resolved.push(ResolvedImport {
            item_id: item_id.to_string(),
            item_name: item_name.clone(),
            source_factory_id: id.clone(),
            resolved_ipm: take,
        });
        remaining -= take;
    }
    let gap = if remaining > 1e-3 { remaining } else { 0.0 };
    (resolved, gap)
}

/// Convenience wrapper around `derive_chain_with_options` for the
/// no-sources / no-bypass case. Test-only: command-layer callers go
/// through `derive_chain_with_options` directly so they can pass
/// pinned sources + bypass flags without juggling defaults.
#[cfg(test)]
fn derive_chain(
    target_item_id: &str,
    target_ipm: f32,
    unlocked_alts: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    game_data: &GameData,
) -> Result<ChainPlan, PlannerError> {
    derive_chain_with_options(
        target_item_id,
        target_ipm,
        unlocked_alts,
        available_supply,
        &[],
        &HashMap::new(),
        game_data,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn derive_chain_with_options(
    target_item_id: &str,
    target_ipm: f32,
    unlocked_alts: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    sources: &[InputSource],
    recipes: &HashMap<String, String>,
    game_data: &GameData,
    bypass_supply: bool,
) -> Result<ChainPlan, PlannerError> {
    if game_data.item(target_item_id).is_none() {
        return Err(PlannerError::UnknownTarget {
            item_id: target_item_id.to_string(),
        });
    }
    // Reject only items that have zero recipes producing them — items
    // that are extracted but *also* appear as recipe byproducts can
    // still be planned for via that route if the player prefers.
    if game_data.recipes_producing(target_item_id).is_empty() {
        return Err(PlannerError::NoRecipeForTarget {
            item_id: target_item_id.to_string(),
        });
    }
    let mut raw_demand: HashMap<String, f32> = HashMap::new();
    let mut imported_demand: HashMap<String, f32> = HashMap::new();
    let mut item_demands: HashMap<String, f32> = HashMap::new();
    // Seed item_recipes with the user's chosen recipes up-front. The
    // memoised recipe-pick in `collect_demands` reads from this map
    // before calling `pick_recipe`, so a valid choice is honoured
    // throughout the recursion. Invalid ids (recipe not in dataset,
    // doesn't produce the item, or filtered as alt-locked/inverse)
    // are dropped here — collect_demands' own pick falls back to the
    // auto choice, no error to the user.
    let mut item_recipes: HashMap<String, String> = HashMap::new();
    for (item_id, recipe_id) in recipes {
        let valid = game_data.recipe(recipe_id).is_some_and(|r| {
            !is_inverse_recipe(&r.id)
                && (!r.is_alt || unlocked_alts.contains(&r.id))
                && r.outputs.iter().any(|o| o.item_id == *item_id)
        });
        if valid {
            item_recipes.insert(item_id.clone(), recipe_id.clone());
        }
    }
    let mut visit_order: Vec<String> = Vec::new();
    let mut supply_cache: HashMap<String, bool> = HashMap::new();
    let mut struct_cache: HashMap<String, bool> = HashMap::new();
    let mut visiting: HashSet<String> = HashSet::new();
    let cut_items = cut_items_from_sources(sources);
    collect_demands(
        target_item_id,
        target_ipm,
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

    // Resolve every pinned-import item's accumulated demand against
    // its declared sources. Any gap (demand > sum of caps) bubbles up
    // as `Insufficient::imports`.
    let mut resolved_imports: Vec<ResolvedImport> = Vec::new();
    let mut import_gap: HashMap<String, f32> = HashMap::new();
    for (item_id, demand) in &imported_demand {
        let (resolved, gap) = allocate_imports(item_id, *demand, sources, game_data);
        resolved_imports.extend(resolved);
        if gap > 0.0 {
            import_gap.insert(item_id.clone(), gap);
        }
    }

    // Compare raw demand to the supply pool. If anything is short,
    // surface the gap — the UI shows it as "needs 240 Water/min,
    // claim a water well". When `bypass_supply` is set, skip the
    // gate (both raw + import gaps) so the chain materialises anyway.
    if !bypass_supply {
        let mut missing: HashMap<String, f32> = HashMap::new();
        for (item, demand) in &raw_demand {
            let supply = *available_supply.get(item).unwrap_or(&0.0);
            if *demand > supply + 1e-3 {
                missing.insert(item.clone(), demand - supply);
            }
        }
        if !missing.is_empty() || !import_gap.is_empty() {
            return Err(PlannerError::Insufficient {
                missing,
                imports: import_gap,
            });
        }
    }

    // Sort imports deterministically so test pins (and the React
    // render order) don't drift with HashMap iteration.
    resolved_imports.sort_by(|a, b| {
        a.item_id
            .cmp(&b.item_id)
            .then_with(|| a.source_factory_id.cmp(&b.source_factory_id))
    });

    // Phase 2: build one ChainStage per visited item in leaves-first
    // order, sizing each on its accumulated demand. The dedup in
    // phase 1 means Iron Rod shows up exactly once even when both
    // Rotor and Screw need it.
    let stages: Vec<ChainStage> = visit_order
        .iter()
        .map(|item_id| {
            let demand = *item_demands.get(item_id).unwrap_or(&0.0);
            let recipe_id = item_recipes
                .get(item_id)
                .expect("collect_demands records a recipe per visited item");
            let recipe = game_data
                .recipe(recipe_id)
                .expect("recipe id came from gamedata");
            build_stage(item_id, demand, recipe, game_data)
        })
        .collect();

    let total_machines = stages.iter().map(|s| s.machine_count).sum();
    let total_power_mw = stages.iter().map(|s| s.power_mw).sum();
    let target_item_name = game_data
        .item(target_item_id)
        .map(|i| i.name.clone())
        .unwrap_or_else(|| target_item_id.to_string());

    Ok(ChainPlan {
        target_item_id: target_item_id.to_string(),
        target_item_name,
        target_ipm,
        stages,
        total_machines,
        total_power_mw,
        raw_demand,
        imports: resolved_imports,
        pinned_demand: imported_demand,
    })
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

/// Distribute one cut item's accumulated demand across its import
/// specs in declared order. Sourced specs take up to their cap;
/// whatever is left is `unassigned` (covered by an unsourced spec —
/// "a future factory" — or by nothing at all if every spec is sourced
/// and capped short).
fn allocate_import_specs(
    item_id: &str,
    total_demand: f32,
    specs: &[PlanImportSpec],
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
        let cap = spec.ipm_cap.unwrap_or(f32::INFINITY);
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

/// Compute the full production graph for a factory's plan inputs.
///
/// Unlike the legacy `derive_chain_with_options`, supply NEVER gates
/// the result — raw gaps, unsourced imports, and cap shortfalls come
/// back as `PlanGraph.warnings` (warn, don't block). Only structural
/// failures (unknown item, no recipe, dataset cycle) return `Err`.
pub fn compute_plan_graph(
    targets: &[PlanTargetSpec],
    unlocked_alts: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    imports: &[PlanImportSpec],
    recipe_overrides: &HashMap<String, String>,
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

        // Input edges: every item folds to exactly one producer node
        // (the fold in collect_demands guarantees it), so the producer
        // kind is unambiguous.
        for io in &stage.inputs {
            let from = if cut_items.contains(&io.item_id) {
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

    // Import nodes — one per cut item with demand, sorted likewise.
    let mut import_items: Vec<(&String, &f32)> = imported_demand.iter().collect();
    import_items.sort_by(|a, b| a.0.cmp(b.0));
    for (item_id, demand) in import_items {
        let (allocations, unassigned, has_unsourced_spec) =
            allocate_import_specs(item_id, *demand, imports);
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::planner::dto::InputSourceKind;

    fn unlocked() -> HashSet<String> {
        HashSet::new()
    }

    #[test]
    fn iron_ingot_at_60_ipm_with_iron_ore_supply_uses_standard_recipe() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 1000.0);
        let plan =
            derive_chain("Desc_IronIngot_C", 60.0, &unlocked(), &supply, &gd).unwrap();
        assert_eq!(plan.target_ipm, 60.0);
        // Standard 1:1 Iron Ingot → 1 stage, no water dependency.
        assert_eq!(plan.stages.len(), 1);
        assert_eq!(plan.stages[0].output_item_id, "Desc_IronIngot_C");
        assert!(plan.raw_demand.contains_key("Desc_OreIron_C"));
        assert!(!plan.raw_demand.contains_key("Desc_Water_C"));
        assert!(plan.imports.is_empty());
    }

    #[test]
    fn pure_iron_ingot_alt_only_chosen_when_water_supplied() {
        let gd = GameData::from_bundled().unwrap();
        let pure_iron = gd
            .recipes()
            .iter()
            .find(|r| r.is_alt && r.outputs.iter().any(|o| o.item_id == "Desc_IronIngot_C") && r.inputs.iter().any(|i| i.item_id == "Desc_Water_C"))
            .expect("dataset should ship a water-using iron-ingot alt");
        let mut unlocked = HashSet::new();
        unlocked.insert(pure_iron.id.clone());

        let mut supply_no_water = HashMap::new();
        supply_no_water.insert("Desc_OreIron_C".into(), 10000.0);
        let plan_no_water =
            derive_chain("Desc_IronIngot_C", 60.0, &unlocked, &supply_no_water, &gd).unwrap();
        assert!(
            plan_no_water.stages[0].recipe_id != pure_iron.id,
            "without water supply the planner must fall back to the standard recipe — got {}",
            plan_no_water.stages[0].recipe_id
        );

        let mut supply_with_water = supply_no_water.clone();
        supply_with_water.insert("Desc_Water_C".into(), 1000.0);
        let plan_with_water =
            derive_chain("Desc_IronIngot_C", 60.0, &unlocked, &supply_with_water, &gd).unwrap();
        // Pure Iron Ingot has a higher per-machine rate than the
        // standard recipe; the picker should choose it when its inputs
        // are viable.
        assert_eq!(plan_with_water.stages.last().unwrap().recipe_id, pure_iron.id);
        assert!(plan_with_water.raw_demand.contains_key("Desc_Water_C"));
    }

    #[test]
    fn missing_raw_supply_returns_insufficient_with_the_gap() {
        let gd = GameData::from_bundled().unwrap();
        // No supply at all.
        let supply = HashMap::new();
        let err =
            derive_chain("Desc_IronIngot_C", 30.0, &unlocked(), &supply, &gd).unwrap_err();
        match err {
            PlannerError::Insufficient { missing, imports } => {
                assert!(missing.contains_key("Desc_OreIron_C"));
                assert!(imports.is_empty(), "no pinned sources → imports empty");
            }
            other => panic!("expected Insufficient, got {other:?}"),
        }
    }

    #[test]
    fn raw_target_is_rejected_with_no_recipe_error() {
        let gd = GameData::from_bundled().unwrap();
        let supply = HashMap::new();
        let err = derive_chain("Desc_OreIron_C", 30.0, &unlocked(), &supply, &gd).unwrap_err();
        assert!(matches!(err, PlannerError::NoRecipeForTarget { .. }));
    }

    #[test]
    fn unknown_target_surfaces_dataset_error() {
        let gd = GameData::from_bundled().unwrap();
        let err =
            derive_chain("Desc_DefinitelyNotAThing_C", 30.0, &unlocked(), &HashMap::new(), &gd)
                .unwrap_err();
        assert!(matches!(err, PlannerError::UnknownTarget { .. }));
    }

    #[test]
    fn rotor_at_60_per_min_produces_correct_rates_with_no_duplicates() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 100000.0);
        let plan = derive_chain("Desc_Rotor_C", 60.0, &unlocked(), &supply, &gd).unwrap();

        let mut seen: HashSet<&str> = HashSet::new();
        for s in &plan.stages {
            assert!(
                seen.insert(s.output_item_id.as_str()),
                "duplicate stage for {}",
                s.output_item_id,
            );
        }

        let target = plan
            .stages
            .iter()
            .find(|s| s.output_item_id == "Desc_Rotor_C")
            .expect("rotor stage present");
        let rotor_out = target
            .outputs
            .iter()
            .find(|o| o.item_id == "Desc_Rotor_C")
            .unwrap();
        assert!(
            (rotor_out.per_minute - 60.0).abs() < 0.05,
            "expected rotor output ≈ 60/min, got {}",
            rotor_out.per_minute,
        );
    }

    #[test]
    fn chain_stages_arrive_in_dependency_order_leaves_first() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 10000.0);
        let plan = derive_chain("Desc_IronPlateReinforced_C", 10.0, &unlocked(), &supply, &gd)
            .unwrap();
        let target_idx = plan.stages.iter().position(|s| s.output_item_id == "Desc_IronPlateReinforced_C");
        assert_eq!(target_idx, Some(plan.stages.len() - 1));
    }

    // ---------- Input-source override tests ----------

    /// Helper — make a Factory-kind InputSource.
    fn fac(item: &str, factory_id: &str, cap: Option<f32>) -> InputSource {
        InputSource {
            item_id: item.to_string(),
            source: InputSourceKind::Factory {
                id: factory_id.to_string(),
            },
            ipm_cap: cap,
        }
    }

    #[test]
    fn pinning_an_intermediate_cuts_upstream_stages_and_emits_resolved_import() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        // Iron Ore supply is provided so the non-imported branch
        // (Screw demand → Iron Rod → Iron Ingot → Iron Ore) still
        // resolves. The pinned item is Iron Plate.
        supply.insert("Desc_OreIron_C".into(), 100000.0);
        let sources = vec![fac("Desc_IronPlate_C", "fac-plates-v1", Some(60.0))];

        let plan = derive_chain_with_options(
            "Desc_IronPlateReinforced_C",
            10.0,
            &unlocked(),
            &supply,
            &sources,
            &HashMap::new(),
            &gd,
            false,
        )
        .unwrap();

        // No Iron Plate stage should appear — its production is imported.
        assert!(
            plan.stages.iter().all(|s| s.output_item_id != "Desc_IronPlate_C"),
            "Iron Plate stage should be cut when pinned: {:?}",
            plan.stages.iter().map(|s| s.output_item_id.as_str()).collect::<Vec<_>>()
        );
        // ResolvedImport row exists for Iron Plate from the pinned factory.
        let imp = plan
            .imports
            .iter()
            .find(|i| i.item_id == "Desc_IronPlate_C")
            .expect("ResolvedImport for Iron Plate");
        assert_eq!(imp.source_factory_id, "fac-plates-v1");
        assert!(imp.resolved_ipm > 0.0);
        // Reinforced Iron Plate is the final stage.
        assert_eq!(plan.stages.last().unwrap().output_item_id, "Desc_IronPlateReinforced_C");
    }

    #[test]
    fn pinned_source_cap_below_demand_returns_insufficient_imports_gap() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 100000.0);
        // 10 Reinforced Iron Plates/min requires ~30 Iron Plate/min
        // (standard recipe is 6 Plate → 5 Reinforced). Cap at 5 → gap.
        let sources = vec![fac("Desc_IronPlate_C", "fac-plates-v1", Some(5.0))];
        let err = derive_chain_with_options(
            "Desc_IronPlateReinforced_C",
            10.0,
            &unlocked(),
            &supply,
            &sources,
            &HashMap::new(),
            &gd,
            false,
        )
        .unwrap_err();
        match err {
            PlannerError::Insufficient { missing, imports } => {
                assert!(missing.is_empty(), "raw supply was sufficient");
                let gap = imports
                    .get("Desc_IronPlate_C")
                    .copied()
                    .expect("Iron Plate import gap reported");
                assert!(gap > 0.0, "expected positive gap, got {gap}");
            }
            other => panic!("expected Insufficient::imports, got {other:?}"),
        }
    }

    #[test]
    fn multiple_factory_sources_for_same_item_distribute_by_declared_order() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 100000.0);
        // Reinforced Iron Plate @ 10/min needs ~30 Iron Plate/min.
        // First source cap 12 → it fills 12; second cap 100 → fills the rest.
        let sources = vec![
            fac("Desc_IronPlate_C", "fac-A", Some(12.0)),
            fac("Desc_IronPlate_C", "fac-B", Some(100.0)),
        ];
        let plan = derive_chain_with_options(
            "Desc_IronPlateReinforced_C",
            10.0,
            &unlocked(),
            &supply,
            &sources,
            &HashMap::new(),
            &gd,
            false,
        )
        .unwrap();
        let a = plan
            .imports
            .iter()
            .find(|i| i.source_factory_id == "fac-A")
            .expect("fac-A entry");
        let b = plan
            .imports
            .iter()
            .find(|i| i.source_factory_id == "fac-B")
            .expect("fac-B entry");
        assert!(
            (a.resolved_ipm - 12.0).abs() < 1e-3,
            "fac-A should saturate at cap 12, got {}",
            a.resolved_ipm
        );
        assert!(b.resolved_ipm > 0.0, "fac-B should pick up the remainder");
    }

    #[test]
    fn bypass_supply_ignores_import_cap_gap() {
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 100000.0);
        let sources = vec![fac("Desc_IronPlate_C", "fac-A", Some(1.0))];
        // bypass_supply = true → returns a plan even though the cap is short.
        let plan = derive_chain_with_options(
            "Desc_IronPlateReinforced_C",
            10.0,
            &unlocked(),
            &supply,
            &sources,
            &HashMap::new(),
            &gd,
            true,
        )
        .unwrap();
        assert!(!plan.imports.is_empty());
    }

    #[test]
    fn user_chosen_recipe_replaces_the_greedy_pick() {
        // The greedy pick prefers Recipe_AluminaSolution_C for Silica
        // (50/min > Recipe_Silica_C's 37.5/min, both non-alt). If the
        // user explicitly picks Recipe_Silica_C for Silica, the planner
        // honours that and uses Raw Quartz instead.
        let gd = GameData::from_bundled().unwrap();
        let supply = HashMap::new();
        let mut recipes = HashMap::new();
        recipes.insert("Desc_Silica_C".to_string(), "Recipe_Silica_C".to_string());
        let plan = derive_chain_with_options(
            "Desc_AluminumPlate_C",
            60.0,
            &unlocked(),
            &supply,
            &[],
            &recipes,
            &gd,
            true, // bypass_supply
        )
        .expect("must derive without cycles");
        let silica_stage = plan
            .stages
            .iter()
            .find(|s| s.output_item_id == "Desc_Silica_C")
            .expect("silica stage present");
        assert_eq!(silica_stage.recipe_id, "Recipe_Silica_C");
        // Knock-on: Raw Quartz must appear in raw_demand now that the
        // Silica stage uses the Quartz recipe instead of the byproduct
        // path through Alumina Solution.
        assert!(plan.raw_demand.contains_key("Desc_RawQuartz_C"));
    }

    #[test]
    fn invalid_recipe_choice_falls_back_to_auto_pick() {
        // If the user hands in a recipe that doesn't produce the item
        // (or doesn't exist), the planner ignores it and uses the
        // greedy pick — no error, no wedge.
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 10000.0);
        let mut recipes = HashMap::new();
        recipes.insert(
            "Desc_IronIngot_C".to_string(),
            "Recipe_DefinitelyNotARecipe_C".to_string(),
        );
        let plan = derive_chain_with_options(
            "Desc_IronIngot_C",
            60.0,
            &unlocked(),
            &supply,
            &[],
            &recipes,
            &gd,
            false,
        )
        .expect("must derive even with invalid recipe choice");
        assert_eq!(plan.stages[0].recipe_id, "Recipe_IngotIron_C");
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

    #[test]
    fn unpackage_recipes_are_skipped_so_alumina_chains_dont_cycle() {
        // Regression for the cycle bug: without filtering Unpackage_*
        // recipes the planner picked `Recipe_UnpackageAlumina_C` to
        // produce Alumina Solution (high per-machine output rate),
        // which needs Packaged Alumina, whose only producer needs
        // Alumina Solution back. Now the planner falls back to the
        // direct Bauxite+Water recipe and the chain resolves.
        //
        // Empty supply forces the structural-viable path — that's
        // where the cycle originally surfaced (no `available_supply`
        // means no recipe is supply-viable, so all picks happen via
        // the structural fallback).
        let gd = GameData::from_bundled().unwrap();
        let supply = HashMap::new();
        let plan = derive_chain_with_options(
            "Desc_AluminumPlate_C",
            60.0,
            &unlocked(),
            &supply,
            &[],
            &HashMap::new(),
            &gd,
            true, // bypass_supply — we just want the chain to build
        )
        .expect("Alclad Aluminum Sheet must derive without cycles");
        assert!(
            plan.stages.iter().all(|s| !is_inverse_recipe(&s.recipe_id)),
            "no stage should use an Unpackage_* recipe"
        );
        assert!(plan.stages.len() >= 4, "expected a multi-stage chain");
    }

    // ---------- compute_plan_graph tests ----------

    fn target(item: &str, ipm: f32) -> PlanTargetSpec {
        PlanTargetSpec { item_id: item.to_string(), ipm }
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
    fn empty_targets_compute_an_empty_graph() {
        let gd = GameData::from_bundled().unwrap();
        let graph = compute_plan_graph(
            &[],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
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
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[],
            &HashMap::new(),
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
            &[target("Desc_Cable_C", 60.0), target("Desc_Wire_C", 30.0)],
            &unlocked(),
            &supply,
            &[],
            &HashMap::new(),
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
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[import_spec("Desc_CopperIngot_C", None, None)],
            &HashMap::new(),
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
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[import_spec("Desc_Wire_C", Some("fac-wire"), Some(50.0))],
            &HashMap::new(),
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
            &[target("Desc_IronIngot_C", 60.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
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
            &[target("Desc_IronIngot_C", 60.0)],
            &unlocked(),
            &supply,
            &[],
            &HashMap::new(),
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
            &[target("Desc_IronIngot_C", 60.0)],
            &alts,
            &supply,
            &[],
            &overrides,
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
            &[target("Desc_Cable_C", 60.0)],
            &unlocked(),
            &supply,
            &[import_spec("Desc_Cable_C", Some("fac-other"), None)],
            &HashMap::new(),
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
            &[target("Desc_Plastic_C", 60.0)],
            &unlocked(),
            &HashMap::new(),
            &[],
            &HashMap::new(),
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

    #[test]
    fn node_kind_sources_do_not_alter_planning() {
        // Node kind is parsed but not yet consumed by the planner —
        // declaring one for a raw item should leave the plan identical
        // to the no-sources case.
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 1000.0);
        let sources = vec![InputSource {
            item_id: "Desc_OreIron_C".into(),
            source: InputSourceKind::Node {
                id: "node-iron-5".into(),
            },
            ipm_cap: Some(60.0),
        }];
        let baseline = derive_chain("Desc_IronIngot_C", 60.0, &unlocked(), &supply, &gd).unwrap();
        let with_node = derive_chain_with_options(
            "Desc_IronIngot_C",
            60.0,
            &unlocked(),
            &supply,
            &sources,
            &HashMap::new(),
            &gd,
            false,
        )
        .unwrap();
        assert_eq!(baseline.stages.len(), with_node.stages.len());
        assert!(with_node.imports.is_empty(), "Node sources don't emit imports yet");
    }
}
