//! Pure planner logic. The Tauri command layer (in `commands.rs`) does
//! nothing more than gather the inputs (claims, alts, target spec) and
//! call `derive_chain`; everything that matters is here so the unit
//! tests can pin behaviour against the bundled dataset without going
//! through IPC.

use std::collections::{HashMap, HashSet};

use crate::shared::gamedata::GameData;
use crate::shared::gamedata::types::Recipe;

use super::dto::{ChainPlan, ChainStage, PlannerError, RecipeFlow};

/// Per-machine ipm of `item_id` for this recipe at 100% clock with no
/// amplification.
fn recipe_output_rate(recipe: &Recipe, item_id: &str) -> Option<f32> {
    recipe
        .outputs
        .iter()
        .find(|o| o.item_id == item_id)
        .map(|o| o.per_minute)
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
/// inputs the player can actually source.
fn supply_viable_for_item(
    item_id: &str,
    unlocked: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    game_data: &GameData,
    cache: &mut HashMap<String, bool>,
    visiting: &mut HashSet<String>,
) -> bool {
    if let Some(v) = cache.get(item_id) {
        return *v;
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

    let candidates: Vec<&Recipe> = game_data
        .recipes_producing(item_id)
        .into_iter()
        .filter(|r| !r.is_alt || unlocked.contains(&r.id))
        .collect();
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
/// error instead of a vague "no recipe" one.
fn structurally_viable_for_item(
    item_id: &str,
    unlocked: &HashSet<String>,
    game_data: &GameData,
    cache: &mut HashMap<String, bool>,
    visiting: &mut HashSet<String>,
) -> bool {
    if let Some(v) = cache.get(item_id) {
        return *v;
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

    let candidates: Vec<&Recipe> = game_data
        .recipes_producing(item_id)
        .into_iter()
        .filter(|r| !r.is_alt || unlocked.contains(&r.id))
        .collect();
    if candidates.is_empty() {
        visiting.remove(item_id);
        cache.insert(item_id.to_string(), false);
        return false;
    }

    let any = candidates.into_iter().any(|r| {
        r.inputs.iter().all(|inp| {
            structurally_viable_for_item(&inp.item_id, unlocked, game_data, cache, visiting)
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
    game_data: &GameData,
    raw_demand: &mut HashMap<String, f32>,
    item_demands: &mut HashMap<String, f32>,
    item_recipes: &mut HashMap<String, String>,
    visit_order: &mut Vec<String>,
    supply_cache: &mut HashMap<String, bool>,
    struct_cache: &mut HashMap<String, bool>,
    visiting: &mut HashSet<String>,
) -> Result<(), PlannerError> {
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

    let all_unlocked: Vec<&Recipe> = game_data
        .recipes_producing(item_id)
        .into_iter()
        .filter(|r| !r.is_alt || unlocked.contains(&r.id))
        .collect();

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
            game_data,
            raw_demand,
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

/// Entry point — derive a full upstream chain for `target_item_id` at
/// `target_ipm`. The chain is supply-aware: it only picks recipes
/// whose inputs trace back to either claimed raw supply or other
/// viable recipes. If anything is missing, returns
/// `PlannerError::Insufficient { missing }`.
pub fn derive_chain(
    target_item_id: &str,
    target_ipm: f32,
    unlocked_alts: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    game_data: &GameData,
) -> Result<ChainPlan, PlannerError> {
    derive_chain_with_options(target_item_id, target_ipm, unlocked_alts, available_supply, game_data, false)
}

pub fn derive_chain_with_options(
    target_item_id: &str,
    target_ipm: f32,
    unlocked_alts: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
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
    let mut item_demands: HashMap<String, f32> = HashMap::new();
    let mut item_recipes: HashMap<String, String> = HashMap::new();
    let mut visit_order: Vec<String> = Vec::new();
    let mut supply_cache: HashMap<String, bool> = HashMap::new();
    let mut struct_cache: HashMap<String, bool> = HashMap::new();
    let mut visiting: HashSet<String> = HashSet::new();
    collect_demands(
        target_item_id,
        target_ipm,
        unlocked_alts,
        available_supply,
        game_data,
        &mut raw_demand,
        &mut item_demands,
        &mut item_recipes,
        &mut visit_order,
        &mut supply_cache,
        &mut struct_cache,
        &mut visiting,
    )?;

    // Compare raw demand to the supply pool. If anything is short,
    // surface the gap — the UI shows it as "needs 240 Water/min,
    // claim a water well". When `bypass_supply` is set, skip the
    // gate so the chain materialises anyway (the player can wire
    // nodes in afterwards).
    if !bypass_supply {
        let mut missing: HashMap<String, f32> = HashMap::new();
        for (item, demand) in &raw_demand {
            let supply = *available_supply.get(item).unwrap_or(&0.0);
            if *demand > supply + 1e-3 {
                missing.insert(item.clone(), demand - supply);
            }
        }
        if !missing.is_empty() {
            return Err(PlannerError::Insufficient { missing });
        }
    }

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
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
            PlannerError::Insufficient { missing } => {
                assert!(missing.contains_key("Desc_OreIron_C"));
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
        // Regression for the planner-output bug: previously the chain
        // contained Iron Ingot + Iron Rod twice (Rotor needs Rod
        // directly AND through Screw), and the rate math collapsed
        // every output to a fraction of demand (e.g. Rotor showed
        // 15/min when 60/min was requested).
        let gd = GameData::from_bundled().unwrap();
        let mut supply = HashMap::new();
        supply.insert("Desc_OreIron_C".into(), 100000.0);
        let plan = derive_chain("Desc_Rotor_C", 60.0, &unlocked(), &supply, &gd).unwrap();

        // No duplicate items in the stage list — the demand for each
        // intermediate gets summed onto a single stage.
        let mut seen: HashSet<&str> = HashSet::new();
        for s in &plan.stages {
            assert!(
                seen.insert(s.output_item_id.as_str()),
                "duplicate stage for {}",
                s.output_item_id,
            );
        }

        // Target stage hits the requested rate exactly.
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
        // Reinforced Iron Plate needs Iron Plate + Screw → Iron Plate
        // needs Iron Ingot → Iron Ingot needs Iron Ore (raw). The
        // ingot stage must land before the plate stage which must
        // land before the reinforced-plate stage.
        let plan = derive_chain("Desc_IronPlateReinforced_C", 10.0, &unlocked(), &supply, &gd)
            .unwrap();
        let target_idx = plan.stages.iter().position(|s| s.output_item_id == "Desc_IronPlateReinforced_C");
        assert_eq!(target_idx, Some(plan.stages.len() - 1));
    }
}
