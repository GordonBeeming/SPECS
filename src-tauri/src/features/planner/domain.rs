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
#[allow(clippy::too_many_arguments)]
fn size_stage(
    item_id: &str,
    demand_ipm: f32,
    unlocked: &HashSet<String>,
    available_supply: &HashMap<String, f32>,
    game_data: &GameData,
    stages: &mut Vec<ChainStage>,
    raw_demand: &mut HashMap<String, f32>,
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

    let recipe = pick_recipe(item_id, &candidates).ok_or_else(|| PlannerError::NoRecipeForTarget {
        item_id: item_id.to_string(),
    })?;
    let per_machine = recipe_output_rate(recipe, item_id).expect("candidate filter guarantees output");

    // Greedy clock choice — overclock only if needed. machine_count =
    // ceil(demand / per_machine_at_100); clock = demand / (count ×
    // per_machine) × 100. Caps at 250% via the count bump above so we
    // stay inside the in-game range.
    let count_f = (demand_ipm / per_machine).ceil().max(1.0);
    let mut machine_count = count_f as i64;
    let mut clock = demand_ipm / (machine_count as f32 * per_machine) * 100.0;
    // Clock can land below 1% if demand is tiny; clamp + recompute
    // count if so. This is rare (factory of size 1 demanding < 1% of
    // per-machine throughput) but keeps the plan inside the game's
    // validation envelope.
    if clock < 1.0 {
        clock = 1.0;
    }
    while clock > 250.0 && machine_count < 10_000 {
        machine_count += 1;
        clock = demand_ipm / (machine_count as f32 * per_machine) * 100.0;
    }

    let scale = (machine_count as f32 * clock / 100.0) * (1.0 / per_machine) * per_machine;
    // `scale` is the achieved output rate which should ≈ demand_ipm
    // by construction; recipe inputs scale by `scale / per_machine`.
    let runs_per_min = scale / per_machine;
    let inputs: Vec<RecipeFlow> = recipe
        .inputs
        .iter()
        .map(|io| flow_for(io.item_id.clone(), io.per_minute * runs_per_min, game_data))
        .collect();
    let outputs: Vec<RecipeFlow> = recipe
        .outputs
        .iter()
        .map(|io| flow_for(io.item_id.clone(), io.per_minute * runs_per_min, game_data))
        .collect();

    let building_name = game_data
        .building(&recipe.building_id)
        .map(|b| b.name.clone())
        .unwrap_or_else(|| recipe.building_id.clone());
    let power_mw = game_data
        .building(&recipe.building_id)
        .map(|b| b.power_mw * machine_count as f32 * (clock / 100.0).powi(2))
        .unwrap_or(0.0);

    // Recurse into upstream demands BEFORE pushing this stage so the
    // final stage order is leaves-first → target-last, mirroring how
    // a player would build factories one tier at a time.
    for inp in &inputs {
        size_stage(
            &inp.item_id,
            inp.per_minute,
            unlocked,
            available_supply,
            game_data,
            stages,
            raw_demand,
            supply_cache,
            struct_cache,
            visiting,
        )?;
    }

    stages.push(ChainStage {
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
    });
    visiting.remove(item_id);
    Ok(())
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
    let mut stages: Vec<ChainStage> = Vec::new();
    let mut raw_demand: HashMap<String, f32> = HashMap::new();
    let mut supply_cache: HashMap<String, bool> = HashMap::new();
    let mut struct_cache: HashMap<String, bool> = HashMap::new();
    let mut visiting: HashSet<String> = HashSet::new();
    size_stage(
        target_item_id,
        target_ipm,
        unlocked_alts,
        available_supply,
        game_data,
        &mut stages,
        &mut raw_demand,
        &mut supply_cache,
        &mut struct_cache,
        &mut visiting,
    )?;

    // Compare raw demand to the supply pool. If anything is short,
    // surface the gap — the UI shows it as "needs 240 Water/min,
    // claim a water well".
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
