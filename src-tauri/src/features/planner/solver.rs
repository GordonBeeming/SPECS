//! LP-based plan optimizer.
//!
//! The greedy chain (still alive in `domain.rs` as the fallback) picks
//! one recipe per item walking top-down, which can't net byproducts and
//! happily chooses the "Alumina Solution" recipe as a *silica* producer
//! because it has the best silica-per-machine. Solving the whole chain
//! as a linear program fixes both at once: variables are machine-runs
//! per candidate recipe, every item gets a balance constraint (so
//! byproducts offset demand and recycling loops like water → alumina →
//! water just work), and the objective minimises rarity-weighted raw
//! extraction — iron is nearly free, oil costs more, SAM is precious.
//!
//! Fluids vs solids: a solid surplus can go to the AWESOME sink, so it
//! costs ε. A fluid surplus stalls a real production line, so it gets a
//! penalty large enough that the solver only leaves one when there is
//! genuinely no consumer — and the caller turns it into a warning
//! (warn, don't block).

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use microlp::{ComparisonOp, OptimizationDirection, Problem, Variable};

use crate::features::resource_nodes::domain::{node_max_ipm, BudgetAssumption};
use crate::shared::gamedata::types::Recipe;
use crate::shared::gamedata::GameData;

/// Sinkable surplus is almost-free; never-free stops zero-cost cycles.
const SOLID_SURPLUS_COST: f64 = 1e-4;
/// A stranded fluid must beat every realistic raw cost before the
/// solver tolerates it.
const FLUID_SURPLUS_COST: f64 = 1e6;
/// Water comes from extractors anywhere on the map, not from a finite
/// node budget — close to free, but not free enough to dump.
const WATER_WEIGHT: f64 = 1e-3;
/// A raw that somehow has no map capacity (dataset drift) is treated
/// as extremely scarce instead of dividing by zero.
const UNKNOWN_RAW_WEIGHT: f64 = 1000.0;

pub const SAM_ITEM_ID: &str = "Desc_SAM_C";
pub const WATER_ITEM_ID: &str = "Desc_Water_C";

#[derive(Debug)]
pub struct SolveInput<'a> {
    /// item → ipm the plan must produce (targets, full rate incl. exports).
    pub demands: &'a HashMap<String, f32>,
    /// item → ipm arriving from other factories (mixed-item external
    /// share). The LP treats it as free supply in the balance.
    pub external_supply: &'a HashMap<String, f32>,
    /// Items fully cut from this factory (imports with no self row).
    /// Their consumption is recorded, never produced locally.
    pub cut_items: &'a HashSet<String>,
    /// item → forced recipe id (user pin). Other recipes whose PRIMARY
    /// output is that item are excluded; byproduct contributions stay.
    pub recipe_overrides: &'a HashMap<String, String>,
    pub unlocked_alts: &'a HashSet<String>,
    pub include_sam: bool,
}

#[derive(Debug, Clone)]
pub struct PlanSolution {
    /// recipe id → machine-runs/min (1.0 = one machine at 100% clock).
    pub recipes: Vec<(String, f64)>,
    /// raw item → extraction ipm the chain needs.
    pub raw_extraction: HashMap<String, f64>,
    /// item → surplus ipm nobody consumes (solid: sinkable; fluid: warning).
    pub surplus: HashMap<String, f64>,
    /// cut item → ipm consumed by the chain (becomes the import node).
    pub imported: HashMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SolveError {
    /// No candidate recipe set can reach the targets (e.g. SAM-locked
    /// item with the toggle off and no alternates).
    Unreachable { item_id: String },
    /// The simplex failed or exceeded the time budget — the caller
    /// falls back to the greedy chain.
    Failed(String),
}

fn is_inverse_recipe(recipe_id: &str) -> bool {
    recipe_id.starts_with("Recipe_Unpackage")
}

/// Rarity weight per raw resource: how much the whole map can yield at
/// a fixed Mk3 @ 100% basis, normalised so iron ≈ 1.0. Computed once
/// per process — the map never changes mid-session.
pub fn rarity_weights(game_data: &GameData) -> HashMap<String, f64> {
    let mut world: HashMap<String, f64> = HashMap::new();
    for node in game_data.nodes() {
        let max = node_max_ipm(node, BudgetAssumption::Mk3At100, 0, game_data);
        if max > 0.0 {
            *world.entry(node.resource_item_id.clone()).or_insert(0.0) += max as f64;
        }
    }
    let iron = world.get("Desc_OreIron_C").copied().unwrap_or(1.0).max(1.0);
    let mut weights: HashMap<String, f64> = world
        .into_iter()
        .map(|(item, total)| (item, iron / total.max(1.0)))
        .collect();
    weights.insert(WATER_ITEM_ID.to_string(), WATER_WEIGHT);
    weights
}

/// Fixpoint of "what can this playthrough craft" from the extracted
/// raws (optionally without SAM). Drives both the SAM candidate filter
/// and the "this target NEEDS SAM" auto-force.
fn producible_items(
    game_data: &GameData,
    unlocked_alts: &HashSet<String>,
    include_sam: bool,
) -> HashSet<String> {
    let mut producible: HashSet<String> = game_data
        .items()
        .iter()
        .filter(|i| game_data.is_extracted_resource(&i.id))
        .filter(|i| include_sam || i.id != SAM_ITEM_ID)
        .map(|i| i.id.clone())
        .collect();
    loop {
        let mut grew = false;
        for r in game_data.recipes() {
            if is_inverse_recipe(&r.id) || (r.is_alt && !unlocked_alts.contains(&r.id)) {
                continue;
            }
            if r.inputs.iter().all(|io| producible.contains(&io.item_id)) {
                for o in &r.outputs {
                    if producible.insert(o.item_id.clone()) {
                        grew = true;
                    }
                }
            }
        }
        if !grew {
            return producible;
        }
    }
}

/// True when the item cannot be made at all without SAM — the UI then
/// forces the per-plan toggle on (and disables it) for that plan.
pub fn requires_sam(
    item_id: &str,
    game_data: &GameData,
    unlocked_alts: &HashSet<String>,
) -> bool {
    if game_data.is_extracted_resource(item_id) {
        return item_id == SAM_ITEM_ID;
    }
    !producible_items(game_data, unlocked_alts, false).contains(item_id)
}

fn candidates<'a>(game_data: &'a GameData, input: &SolveInput) -> Vec<&'a Recipe> {
    let producible = if input.include_sam {
        None
    } else {
        Some(producible_items(game_data, input.unlocked_alts, false))
    };
    game_data
        .recipes()
        .iter()
        .filter(|r| !is_inverse_recipe(&r.id))
        .filter(|r| !r.is_alt || input.unlocked_alts.contains(&r.id))
        // SAM off: a recipe is only usable when every input is
        // reachable without SAM.
        .filter(|r| match &producible {
            Some(p) => r.inputs.iter().all(|io| p.contains(&io.item_id)),
            None => true,
        })
        // Cut items are never produced locally as a primary output —
        // the user removed the local line. Byproducts still count.
        .filter(|r| {
            r.outputs
                .first()
                .map(|o| !input.cut_items.contains(&o.item_id))
                .unwrap_or(true)
        })
        // A pinned item excludes other primary producers of it.
        .filter(|r| match r.outputs.first() {
            Some(o) => match input.recipe_overrides.get(&o.item_id) {
                Some(pinned) => *pinned == r.id,
                None => true,
            },
            None => true,
        })
        .collect()
}

/// Build and solve the LP. `budget_ms` is a guard, not a scheduler —
/// the problem is a few hundred variables and solves in milliseconds;
/// blowing the budget reports `Failed` so the caller can fall back.
pub fn solve(
    game_data: &GameData,
    input: &SolveInput,
    weights: &HashMap<String, f64>,
    budget_ms: u64,
) -> Result<PlanSolution, SolveError> {
    let started = Instant::now();
    let recipes = candidates(game_data, input);

    // Sanity: every demanded item must be reachable at all, otherwise
    // report which one (the UI shows "needs SAM" / "no recipe").
    let reachable = producible_items(game_data, input.unlocked_alts, input.include_sam);
    for item in input.demands.keys() {
        let exogenous = input.cut_items.contains(item)
            || input.external_supply.contains_key(item);
        if !exogenous && !reachable.contains(item) && !game_data.is_extracted_resource(item) {
            return Err(SolveError::Unreachable { item_id: item.clone() });
        }
    }

    // Universe of items that appear anywhere in the problem.
    let mut items: HashSet<String> = HashSet::new();
    for r in &recipes {
        for io in r.inputs.iter().chain(r.outputs.iter()) {
            items.insert(io.item_id.clone());
        }
    }
    items.extend(input.demands.keys().cloned());
    items.extend(input.external_supply.keys().cloned());

    let mut problem = Problem::new(OptimizationDirection::Minimize);

    let recipe_vars: Vec<(usize, Variable)> = recipes
        .iter()
        .enumerate()
        .map(|(idx, _)| (idx, problem.add_var(0.0, (0.0, f64::INFINITY))))
        .collect();

    // Per-item bookkeeping: (var, coefficient) terms of the balance.
    let mut terms: HashMap<&str, Vec<(Variable, f64)>> = HashMap::new();
    for (idx, var) in &recipe_vars {
        let r = recipes[*idx];
        for io in &r.inputs {
            terms.entry(io.item_id.as_str()).or_default().push((*var, -(io.per_minute as f64)));
        }
        for io in &r.outputs {
            terms.entry(io.item_id.as_str()).or_default().push((*var, io.per_minute as f64));
        }
    }

    let mut raw_vars: HashMap<String, Variable> = HashMap::new();
    let mut surplus_vars: HashMap<String, Variable> = HashMap::new();
    let mut import_vars: HashMap<String, Variable> = HashMap::new();

    for item in &items {
        let is_raw = game_data.is_extracted_resource(item);
        let is_cut = input.cut_items.contains(item);
        let demand = input.demands.get(item).copied().unwrap_or(0.0) as f64;
        let supply = input.external_supply.get(item).copied().unwrap_or(0.0) as f64;

        let mut row = terms.remove(item.as_str()).unwrap_or_default();

        if is_raw && !is_cut {
            let weight = weights
                .get(item)
                .copied()
                .unwrap_or(UNKNOWN_RAW_WEIGHT)
                .max(WATER_WEIGHT);
            let e = problem.add_var(weight, (0.0, f64::INFINITY));
            raw_vars.insert(item.clone(), e);
            row.push((e, 1.0));
        }
        if is_cut {
            // The import absorbs whatever the chain draws — free in the
            // LP; the caller turns the flow into the import node and
            // its allocation/unsourced warnings.
            let m = problem.add_var(0.0, (0.0, f64::INFINITY));
            import_vars.insert(item.clone(), m);
            row.push((m, 1.0));
        }

        let is_fluid = game_data.item(item).map(|i| i.is_fluid).unwrap_or(false);
        let s_cost = if is_fluid { FLUID_SURPLUS_COST } else { SOLID_SURPLUS_COST };
        let s = problem.add_var(s_cost, (0.0, f64::INFINITY));
        surplus_vars.insert(item.clone(), s);
        row.push((s, -1.0));

        // microlp rejects a row that names the same variable twice, and
        // recipes CAN touch one item on both sides (water in, water
        // out) — coalesce per variable before handing the row over.
        let mut coalesced: Vec<(Variable, f64)> = Vec::with_capacity(row.len());
        for (v, c) in row {
            if let Some(entry) = coalesced.iter_mut().find(|(ev, _)| *ev == v) {
                entry.1 += c;
            } else {
                coalesced.push((v, c));
            }
        }
        coalesced.retain(|(_, c)| c.abs() > 1e-12);

        // production − consumption + extraction + imports − surplus
        //   = demand − external supply
        problem.add_constraint(coalesced, ComparisonOp::Eq, demand - supply);
    }

    let solution = problem
        .solve()
        .map_err(|e| SolveError::Failed(format!("{e:?}")))?;
    if started.elapsed().as_millis() as u64 > budget_ms {
        return Err(SolveError::Failed(format!(
            "solver exceeded its {budget_ms}ms budget"
        )));
    }

    let mut chosen: Vec<(String, f64)> = Vec::new();
    for (idx, var) in &recipe_vars {
        let runs = solution[*var];
        if runs > 1e-6 {
            chosen.push((recipes[*idx].id.clone(), runs));
        }
    }
    chosen.sort_by(|a, b| a.0.cmp(&b.0));

    let collect = |vars: &HashMap<String, Variable>| -> HashMap<String, f64> {
        vars.iter()
            .filter_map(|(item, v)| {
                let val = solution[*v];
                (val > 1e-6).then(|| (item.clone(), val))
            })
            .collect()
    };

    Ok(PlanSolution {
        recipes: chosen,
        raw_extraction: collect(&raw_vars),
        surplus: collect(&surplus_vars),
        imported: collect(&import_vars),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gd() -> GameData {
        GameData::from_bundled().unwrap()
    }

    fn base_input<'a>(
        demands: &'a HashMap<String, f32>,
        external: &'a HashMap<String, f32>,
        cuts: &'a HashSet<String>,
        overrides: &'a HashMap<String, String>,
        alts: &'a HashSet<String>,
    ) -> SolveInput<'a> {
        SolveInput {
            demands,
            external_supply: external,
            cut_items: cuts,
            recipe_overrides: overrides,
            unlocked_alts: alts,
            include_sam: false,
        }
    }

    #[test]
    fn rarity_makes_iron_cheap_and_sam_precious() {
        let gd = gd();
        let w = rarity_weights(&gd);
        let iron = w["Desc_OreIron_C"];
        let sam = w.get("Desc_SAM_C").copied().unwrap_or(UNKNOWN_RAW_WEIGHT);
        assert!((iron - 1.0).abs() < 1e-6, "iron is the baseline, got {iron}");
        assert!(sam > iron * 5.0, "SAM must rank far rarer than iron, got {sam}");
        assert!(w[WATER_ITEM_ID] < 0.01, "water is effectively free");
    }

    #[test]
    fn aluminum_chain_nets_byproducts_like_satisfactorytools() {
        // The screenshot case: 60/min Aluminum Ingot, standard recipes.
        // The known-good solution (satisfactorytools) uses ONE alumina
        // refinery, feeds its silica byproduct into the ingot foundry,
        // tops silica up from raw quartz, and recycles the scrap
        // refinery's water — raws: 60 bauxite, ~30 quartz, 30 coal.
        let gd = gd();
        let mut demands = HashMap::new();
        demands.insert("Desc_AluminumIngot_C".to_string(), 60.0);
        let external = HashMap::new();
        let cuts = HashSet::new();
        let overrides = HashMap::new();
        let alts = HashSet::new();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts);
        let sol = solve(&gd, &input, &rarity_weights(&gd), 2000).unwrap();

        let raw = |id: &str| sol.raw_extraction.get(id).copied().unwrap_or(0.0);
        assert!((raw("Desc_OreBauxite_C") - 60.0).abs() < 0.5, "bauxite {:?}", sol.raw_extraction);
        assert!((raw("Desc_RawQuartz_C") - 30.0).abs() < 1.0, "quartz {:?}", sol.raw_extraction);
        assert!((raw("Desc_Coal_C") - 30.0).abs() < 0.5, "coal {:?}", sol.raw_extraction);

        // Exactly one alumina producer — the greedy double-node bug is
        // the thing this module exists to kill.
        let alumina_producers = sol
            .recipes
            .iter()
            .filter(|(id, _)| {
                gd.recipe(id)
                    .map(|r| r.outputs.iter().any(|o| o.item_id == "Desc_AluminaSolution_C"))
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(alumina_producers, 1, "recipes: {:?}", sol.recipes);

        // No fluid surplus — water recycles, alumina is consumed.
        for (item, ipm) in &sol.surplus {
            let fluid = gd.item(item).map(|i| i.is_fluid).unwrap_or(false);
            assert!(!fluid || *ipm < 1e-3, "stranded fluid {item}: {ipm}");
        }
    }

    #[test]
    fn fluid_byproduct_with_no_consumer_surfaces_as_surplus() {
        // Plastic via the standard recipe emits Heavy Oil Residue; with
        // nothing else in the plan to drink it, the solver picks the
        // recycled/other route if cheaper or leaves a surplus we warn
        // about. Either way: no panic, and any surplus is reported.
        let gd = gd();
        let mut demands = HashMap::new();
        demands.insert("Desc_Plastic_C".to_string(), 60.0);
        let external = HashMap::new();
        let cuts = HashSet::new();
        let overrides = HashMap::new();
        let alts = HashSet::new();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts);
        let sol = solve(&gd, &input, &rarity_weights(&gd), 2000).unwrap();
        assert!(!sol.recipes.is_empty());
        for (item, ipm) in &sol.surplus {
            assert!(*ipm > 0.0, "{item} surplus must be positive when reported");
        }
    }

    #[test]
    fn sam_reachability_gates_targets() {
        // The bundled v1.1 dump ships the SAM item but no converter
        // recipes yet, so nothing reachable actually consumes SAM —
        // the toggle is wired for the dataset update that brings the
        // Ficsite chain. What we CAN pin today: ordinary items never
        // read as SAM-locked, and a SAM-locked (here: nonexistent)
        // product is Unreachable rather than silently mis-planned.
        let gd = gd();
        let alts = HashSet::new();
        assert!(!requires_sam("Desc_IronPlate_C", &gd, &alts));
        assert!(requires_sam("Desc_FicsiteIngot_C", &gd, &alts));

        let mut demands = HashMap::new();
        demands.insert("Desc_FicsiteIngot_C".to_string(), 10.0);
        let external = HashMap::new();
        let cuts = HashSet::new();
        let overrides = HashMap::new();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts);
        let err = solve(&gd, &input, &rarity_weights(&gd), 2000).unwrap_err();
        assert!(matches!(err, SolveError::Unreachable { .. }));
    }

    #[test]
    fn overrides_pin_the_primary_producer() {
        let gd = gd();
        let pure_iron = gd
            .recipes()
            .iter()
            .find(|r| {
                r.is_alt
                    && r.outputs.first().map(|o| o.item_id == "Desc_IronIngot_C").unwrap_or(false)
                    && r.inputs.iter().any(|i| i.item_id == "Desc_Water_C")
            })
            .expect("water-using iron ingot alt");
        let mut alts = HashSet::new();
        alts.insert(pure_iron.id.clone());
        let mut overrides = HashMap::new();
        overrides.insert("Desc_IronIngot_C".to_string(), pure_iron.id.clone());

        let mut demands = HashMap::new();
        demands.insert("Desc_IronIngot_C".to_string(), 60.0);
        let external = HashMap::new();
        let cuts = HashSet::new();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts);
        let sol = solve(&gd, &input, &rarity_weights(&gd), 2000).unwrap();
        assert!(
            sol.recipes.iter().any(|(id, _)| id == &pure_iron.id),
            "pinned recipe must be chosen: {:?}",
            sol.recipes
        );
        assert_eq!(sol.recipes.len(), 1);
    }

    #[test]
    fn cut_items_come_from_the_import_not_local_production() {
        let gd = gd();
        let mut demands = HashMap::new();
        demands.insert("Desc_Cable_C".to_string(), 60.0);
        let external = HashMap::new();
        let mut cuts = HashSet::new();
        cuts.insert("Desc_Wire_C".to_string());
        let overrides = HashMap::new();
        let alts = HashSet::new();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts);
        let sol = solve(&gd, &input, &rarity_weights(&gd), 2000).unwrap();
        let wire_in = sol.imported.get("Desc_Wire_C").copied().unwrap_or(0.0);
        assert!((wire_in - 120.0).abs() < 0.5, "imported {wire_in}");
        assert!(
            !sol.recipes.iter().any(|(id, _)| {
                gd.recipe(id)
                    .and_then(|r| r.outputs.first())
                    .map(|o| o.item_id == "Desc_Wire_C")
                    .unwrap_or(false)
            }),
            "no local wire line: {:?}",
            sol.recipes
        );
    }
}
