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

use microlp::{ComparisonOp, OptimizationDirection, Problem, Variable};

use crate::features::resource_nodes::domain::{node_max_ipm, BudgetAssumption};
use crate::shared::gamedata::types::Recipe;
use crate::shared::gamedata::GameData;

use super::domain::{is_inverse_recipe, REPORTABLE_IPM};

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
/// Drawing more of an item than its declared source cap allows stays
/// possible — the plan must still render, and the caller turns the gap
/// into an `ImportShort` warning rather than an error — but it has to be
/// the last thing the optimizer reaches for. Sits above every raw weight
/// the dataset produces and far below `FLUID_SURPLUS_COST`, so an
/// over-cap draw loses to any local chain that exists and still wins
/// against stranding a fluid.
const OVER_CAP_IMPORT_COST: f64 = 1_000.0;
/// What a raw costs when this factory has no claimed node feeding it.
/// Rarity says how much of a resource the whole map holds; it says
/// nothing about whether *this* factory can reach any of it, which is
/// how a chain needing 2.6/min of quartz from 800 m away beat a slightly
/// less limestone-efficient route grounded in ore already claimed on
/// site. Applied uniformly when a factory has claimed nothing, so an
/// unclaimed factory's relative costs — and therefore its solve — are
/// exactly what they were before locality existed.
const UNCLAIMED_RAW_MULTIPLIER: f64 = 8.0;

pub const SAM_ITEM_ID: &str = "Desc_SAM_C";
pub const WATER_ITEM_ID: &str = "Desc_Water_C";

#[derive(Debug, Clone, Copy)]
pub struct SolveInput<'a> {
    /// item → ipm the plan must produce (targets, full rate incl. exports).
    pub demands: &'a HashMap<String, f32>,
    /// item → ipm arriving from other factories (mixed-item external
    /// share). The LP treats it as free supply in the balance.
    pub external_supply: &'a HashMap<String, f32>,
    /// Items fully cut from this factory (imports with no self row).
    /// Their consumption is recorded, never produced locally.
    pub cut_items: &'a HashSet<String>,
    /// cut item → the ceiling the user declared across its sources. A
    /// real LP bound, not a label: without it the optimizer treats every
    /// import as free and unbounded and reshapes the whole plan around
    /// the cheapest way to consume more of it, which is how a 20/min
    /// concrete import turned into a 137/min demand. An item with any
    /// uncapped source is absent here — "however much it takes" is a
    /// legitimate thing to mean, and planning the endgame backwards
    /// against a source factory that doesn't exist yet depends on it.
    pub import_caps: &'a HashMap<String, f32>,
    /// raw item → ipm this factory's own claimed nodes deliver. A price
    /// signal, never a bound: outgrowing your claims is normal and comes
    /// back as `RawShort`, not as an infeasible LP.
    pub claimed_supply: &'a HashMap<String, f32>,
    /// item → forced recipe id (user pin). Other recipes whose PRIMARY
    /// output is that item are excluded; byproduct contributions stay.
    pub recipe_overrides: &'a HashMap<String, String>,
    pub unlocked_alts: &'a HashSet<String>,
    pub include_sam: bool,
    /// Recipe ids whose whole input chain the playthrough can build at
    /// its current tier (`planner::tier::recipes_reachable_at`). `None`
    /// lifts the gate — which is what planning ahead for a product that
    /// is itself above tier needs, and what a caller with no tier to
    /// gate on passes.
    pub tier_allowed: Option<&'a HashSet<String>>,
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

/// Rarity weight per raw resource: how much the whole map can yield at
/// a fixed Mk3 @ 100% basis, normalised so iron ≈ 1.0. Computed once
/// per process — the map never changes mid-session.
pub fn rarity_weights(game_data: &GameData) -> HashMap<String, f64> {
    let mut world: HashMap<String, f64> = HashMap::new();
    for node in game_data.nodes() {
        // `Mk3At100` fixes the miner mark, so `node_max_ipm` never reads
        // the tier on this branch — the map's total yield is a property
        // of the map, and a weight that moved with the playthrough's
        // tier would reprice every existing plan on a milestone.
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
/// raws (optionally without SAM, optionally limited to the recipes the
/// current tier allows). Drives both the SAM candidate filter and the
/// "this target NEEDS SAM" auto-force.
pub(crate) fn producible_items(
    game_data: &GameData,
    unlocked_alts: &HashSet<String>,
    include_sam: bool,
    tier_allowed: Option<&HashSet<String>>,
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
            if tier_allowed.is_some_and(|allowed| !allowed.contains(&r.id)) {
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
/// `producible_without_sam` comes from one `producible_items(.., false)`
/// call so checking many targets doesn't repeat the fixpoint.
pub(crate) fn requires_sam_with(
    producible_without_sam: &HashSet<String>,
    item_id: &str,
    game_data: &GameData,
) -> bool {
    if game_data.is_extracted_resource(item_id) {
        return item_id == SAM_ITEM_ID;
    }
    !producible_without_sam.contains(item_id)
}


/// `reachable` is the producible fixpoint for the CURRENT SAM setting,
/// computed once by `solve` — with SAM off it doubles as the candidate
/// filter, so the fixpoint never runs twice per solve.
fn candidates<'a>(
    game_data: &'a GameData,
    input: &SolveInput,
    reachable: &HashSet<String>,
) -> Vec<&'a Recipe> {
    let producible = if input.include_sam { None } else { Some(reachable) };
    game_data
        .recipes()
        .iter()
        .filter(|r| !is_inverse_recipe(&r.id))
        .filter(|r| !r.is_alt || input.unlocked_alts.contains(&r.id))
        // Tier gate: a recipe whose chain needs a later tier is not a
        // candidate, however early its own `unlock_tier` is stamped.
        .filter(|r| input.tier_allowed.map_or(true, |allowed| allowed.contains(&r.id)))
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

/// Every item that appears anywhere in the problem, in the order its
/// balance constraint (and its raw / surplus / import variables) will be
/// handed to microlp.
///
/// **Sorted, and that is the fix, not a tidy-up.** It was a `HashSet`
/// walk, and Rust seeds its hasher per process, so every run gave
/// microlp a different variable and constraint ordering for the same
/// plan. On a recycling loop — a degenerate LP with many equal-cost
/// optima — that moved the pivot path, the solve time and which optimum
/// came back, which is the larger half of the planner's
/// non-determinism. Anything added to the problem later has to be
/// ordered before it reaches `add_var` or `add_constraint`.
fn problem_items(recipes: &[&Recipe], input: &SolveInput) -> Vec<String> {
    let mut set: HashSet<String> = HashSet::new();
    for r in recipes {
        for io in r.inputs.iter().chain(r.outputs.iter()) {
            set.insert(io.item_id.clone());
        }
    }
    set.extend(input.demands.keys().cloned());
    set.extend(input.external_supply.keys().cloned());
    let mut items: Vec<String> = set.into_iter().collect();
    items.sort();
    items
}

/// Build and solve the LP. Everything the problem is built from is
/// walked in a stable order — see `problem_items` for why that's
/// load-bearing rather than tidy.
pub fn solve(
    game_data: &GameData,
    input: &SolveInput,
    weights: &HashMap<String, f64>,
) -> Result<PlanSolution, SolveError> {
    // Sanity: every demanded item must be reachable at all, otherwise
    // report which one (the UI shows "needs SAM" / "no recipe"). Sorted
    // so two unreachable targets always name the same one.
    let reachable =
        producible_items(game_data, input.unlocked_alts, input.include_sam, input.tier_allowed);
    let recipes = candidates(game_data, input, &reachable);
    let mut demanded: Vec<&String> = input.demands.keys().collect();
    demanded.sort();
    for item in demanded {
        let exogenous = input.cut_items.contains(item)
            || input.external_supply.contains_key(item);
        if !exogenous && !reachable.contains(item) && !game_data.is_extracted_resource(item) {
            return Err(SolveError::Unreachable { item_id: item.clone() });
        }
    }

    let items = problem_items(&recipes, input);

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

    // Both raws and imports are split into a cheap bounded segment and
    // an expensive unbounded one, so a limit steers the optimizer without
    // ever making the problem infeasible. Warn, don't block: the plan
    // still renders past its claims and past its caps, and the caller
    // raises `RawShort` / `ImportShort` against what came back.
    let mut raw_vars: HashMap<String, Vec<Variable>> = HashMap::new();
    let mut surplus_vars: HashMap<String, Variable> = HashMap::new();
    let mut import_vars: HashMap<String, Vec<Variable>> = HashMap::new();

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
            let claimed =
                input.claimed_supply.get(item).copied().unwrap_or(0.0).max(0.0) as f64;
            let segments = raw_vars.entry(item.clone()).or_default();
            if claimed > 0.0 {
                let local = problem.add_var(weight, (0.0, claimed));
                segments.push(local);
                row.push((local, 1.0));
            }
            let remote =
                problem.add_var(weight * UNCLAIMED_RAW_MULTIPLIER, (0.0, f64::INFINITY));
            segments.push(remote);
            row.push((remote, 1.0));
        }
        if is_cut {
            // The import absorbs whatever the chain draws; the caller
            // turns the flow into the import node and its
            // allocation/unsourced warnings.
            let cap = input.import_caps.get(item).copied().unwrap_or(f32::INFINITY) as f64;
            let segments = import_vars.entry(item.clone()).or_default();
            if cap.is_finite() && cap > 0.0 {
                let within = problem.add_var(0.0, (0.0, cap));
                segments.push(within);
                row.push((within, 1.0));
            }
            // Uncapped items keep the old free-and-infinite variable, so
            // an import nobody has bounded behaves exactly as it did.
            let over_cost = if cap.is_finite() { OVER_CAP_IMPORT_COST } else { 0.0 };
            let over = problem.add_var(over_cost, (0.0, f64::INFINITY));
            segments.push(over);
            row.push((over, 1.0));
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

    // A completed solve is always used. There is no wall-clock check
    // here on purpose: the simplex has no cancellation point, so a check
    // after `solve()` can only ever discard an answer already in hand,
    // and the greedy chain it fell back to cannot break a recycling loop
    // at all — a slow success became a hard `CycleDetected`. What budget
    // there is belongs to the caller's refinement loop, which can stop
    // before doing more work rather than after.
    let solution = problem
        .solve()
        .map_err(|e| SolveError::Failed(format!("{e:?}")))?;

    // A bank whose entire output renders as "0.0/min" is a phantom: it
    // costs machines, draws ore and occupies the graph while producing
    // nothing. They appear when an item's external share covers
    // essentially all of its consumption and a hair of local production
    // is left behind, and one such row dragged eight machines into a
    // plan's headline count. A step feeding a plan target is kept
    // whatever its size — a deliberately tiny target is still the thing
    // the user asked for.
    let mut chosen: Vec<(String, f64)> = Vec::new();
    for (idx, var) in &recipe_vars {
        let runs = solution[*var];
        if runs <= 1e-6 {
            continue;
        }
        let recipe = recipes[*idx];
        let largest_output = recipe
            .outputs
            .iter()
            .map(|o| o.per_minute as f64 * runs)
            .fold(0.0_f64, f64::max);
        let feeds_a_target =
            recipe.outputs.iter().any(|o| input.demands.contains_key(&o.item_id));
        if largest_output < REPORTABLE_IPM as f64 && !feeds_a_target {
            continue;
        }
        chosen.push((recipe.id.clone(), runs));
    }
    chosen.sort_by(|a, b| a.0.cmp(&b.0));

    // Same threshold on the leaves, so a dropped phantom chain doesn't
    // leave a raw node behind still asking for ore it no longer needs.
    let collect = |vars: &HashMap<String, Vec<Variable>>| -> HashMap<String, f64> {
        vars.iter()
            .filter_map(|(item, segments)| {
                let val: f64 = segments.iter().map(|v| solution[*v]).sum();
                (val >= REPORTABLE_IPM as f64).then(|| (item.clone(), val))
            })
            .collect()
    };

    Ok(PlanSolution {
        recipes: chosen,
        raw_extraction: collect(&raw_vars),
        surplus: surplus_vars
            .iter()
            .filter_map(|(item, v)| {
                let val = solution[*v];
                (val >= REPORTABLE_IPM as f64).then(|| (item.clone(), val))
            })
            .collect(),
        imported: collect(&import_vars),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gd() -> GameData {
        GameData::from_bundled().unwrap()
    }

    /// Nothing capped and nothing claimed — the shape every pre-locality
    /// case had, and the one a brand-new factory still has.
    fn no_limits() -> (HashMap<String, f32>, HashMap<String, f32>) {
        (HashMap::new(), HashMap::new())
    }

    fn base_input<'a>(
        demands: &'a HashMap<String, f32>,
        external: &'a HashMap<String, f32>,
        cuts: &'a HashSet<String>,
        overrides: &'a HashMap<String, String>,
        alts: &'a HashSet<String>,
        limits: &'a (HashMap<String, f32>, HashMap<String, f32>),
    ) -> SolveInput<'a> {
        SolveInput {
            demands,
            external_supply: external,
            cut_items: cuts,
            import_caps: &limits.0,
            claimed_supply: &limits.1,
            recipe_overrides: overrides,
            unlocked_alts: alts,
            include_sam: false,
            tier_allowed: None,
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
        let limits = no_limits();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();

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
        let limits = no_limits();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        assert!(!sol.recipes.is_empty());
        for (item, ipm) in &sol.surplus {
            assert!(*ipm > 0.0, "{item} surplus must be positive when reported");
        }
    }

    #[test]
    fn sam_recipes_are_excluded_until_toggled_on() {
        // The 1.2 dataset carries the full SAM/converter chain, so the
        // gate is live: Ficsite is SAM-locked, ordinary items aren't,
        // and flipping the toggle actually plans down to SAM ore.
        let gd = gd();
        let alts = HashSet::new();
        let producible = producible_items(&gd, &alts, false, None);
        assert!(!requires_sam_with(&producible, "Desc_IronPlate_C", &gd));
        assert!(requires_sam_with(&producible, "Desc_FicsiteIngot_C", &gd));

        let mut demands = HashMap::new();
        demands.insert("Desc_FicsiteIngot_C".to_string(), 10.0);
        let external = HashMap::new();
        let cuts = HashSet::new();
        let overrides = HashMap::new();
        let limits = no_limits();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let err = solve(&gd, &input, &rarity_weights(&gd)).unwrap_err();
        assert!(matches!(err, SolveError::Unreachable { .. }));

        let mut with_sam = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        with_sam.include_sam = true;
        let sol = solve(&gd, &with_sam, &rarity_weights(&gd)).unwrap();
        assert!(
            sol.raw_extraction.contains_key(SAM_ITEM_ID),
            "Ficsite must chain down to SAM ore: {:?}",
            sol.raw_extraction
        );
        assert!(
            sol.recipes.iter().any(|(id, _)| id == "Recipe_IngotSAM_C"),
            "Reanimated SAM step expected: {:?}",
            sol.recipes
        );
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
        let limits = no_limits();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        assert!(
            sol.recipes.iter().any(|(id, _)| id == &pure_iron.id),
            "pinned recipe must be chosen: {:?}",
            sol.recipes
        );
        assert_eq!(sol.recipes.len(), 1);
    }

    #[test]
    fn the_tier_gate_keeps_above_tier_recipes_out_of_the_mix() {
        // Computer at Tier 6, alts reachable at that tier. Ungated, the
        // optimizer reaches for `Alternate: Crystal Computer` (stamped
        // Tier 5, but its Crystal Oscillator input needs Tier 6 and its
        // standard route Tier 7) — fine here, since the whole chain
        // does ground out at Tier 6. Gated at Tier 5, that route has to
        // disappear rather than plan a chain the player can't build.
        use crate::features::planner::tier::{item_tier_table, recipes_reachable_at, AltMode};

        let gd = gd();
        let table = item_tier_table(&gd, AltMode::On);
        let mut demands = HashMap::new();
        demands.insert("Desc_Computer_C".to_string(), 10.0);
        let external = HashMap::new();
        let cuts = HashSet::new();
        let overrides = HashMap::new();
        let alts: HashSet<String> = gd
            .recipes()
            .iter()
            .filter(|r| r.is_alt && r.unlock_tier <= 6)
            .map(|r| r.id.clone())
            .collect();

        let t6 = recipes_reachable_at(&gd, &table, 6);
        let limits = no_limits();
        let mut gated = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        gated.tier_allowed = Some(&t6);
        let sol = solve(&gd, &gated, &rarity_weights(&gd)).unwrap();
        assert!(
            sol.recipes.iter().all(|(id, _)| t6.contains(id)),
            "every chosen recipe must be buildable at Tier 6: {:?}",
            sol.recipes
        );

        // Supercomputer is Tier 7 top to bottom: at Tier 6 the gate has
        // to report it unreachable rather than quietly plan it.
        let mut super_demands = HashMap::new();
        super_demands.insert("Desc_ComputerSuper_C".to_string(), 5.0);
        let mut above = base_input(&super_demands, &external, &cuts, &overrides, &alts, &limits);
        above.tier_allowed = Some(&t6);
        assert!(matches!(
            solve(&gd, &above, &rarity_weights(&gd)),
            Err(SolveError::Unreachable { .. })
        ));
        let ungated = base_input(&super_demands, &external, &cuts, &overrides, &alts, &limits);
        assert!(solve(&gd, &ungated, &rarity_weights(&gd)).is_ok());
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
        let limits = no_limits();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
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

    #[test]
    fn every_balance_constraint_is_built_in_sorted_order() {
        // The guard for the dominant half of the planner's
        // non-determinism. A `HashSet` walk here reads differently on
        // every process, and the ordering it produces is what microlp
        // pivots against — so "is it sorted" is the only thing a
        // same-process test can usefully pin, and it's exactly the
        // property that was missing.
        let gd = gd();
        let mut demands = HashMap::new();
        demands.insert("Desc_Cable_C".to_string(), 60.0);
        let external = HashMap::new();
        let cuts = HashSet::new();
        let overrides = HashMap::new();
        let alts = HashSet::new();
        let limits = no_limits();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let reachable = producible_items(&gd, &alts, false, None);
        let recipes = candidates(&gd, &input, &reachable);
        let items = problem_items(&recipes, &input);
        assert!(items.len() > 20, "the real dataset should fill this: {}", items.len());
        let mut sorted = items.clone();
        sorted.sort();
        assert_eq!(items, sorted, "constraint order must not depend on the hasher seed");
        let mut deduped = sorted.clone();
        deduped.dedup();
        assert_eq!(items.len(), deduped.len(), "one constraint per item");
    }

    #[test]
    fn a_declared_source_cap_steers_the_solve_instead_of_only_labelling_it() {
        // Cable's standard recipe eats 2 wire each; `Alternate:
        // Quickwire Cable` uses none. With wire imported and no cap the
        // optimizer takes the free, unbounded wire every time, which is
        // how a 20/min concrete import turned into a 137/min demand and
        // why capping the source only ever changed the warning text.
        let gd = gd();
        let mut demands = HashMap::new();
        demands.insert("Desc_Cable_C".to_string(), 60.0);
        let external = HashMap::new();
        let mut cuts = HashSet::new();
        cuts.insert("Desc_Wire_C".to_string());
        let overrides = HashMap::new();
        let mut alts = HashSet::new();
        alts.insert("Recipe_Alternate_Cable_2_C".to_string());

        let uncapped = no_limits();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &uncapped);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        let wire = sol.imported.get("Desc_Wire_C").copied().unwrap_or(0.0);
        assert!(wire > 100.0, "free wire is taken in bulk when nothing bounds it: {wire}");

        let mut caps = HashMap::new();
        caps.insert("Desc_Wire_C".to_string(), 10.0_f32);
        let capped = (caps, HashMap::new());
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &capped);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        let wire = sol.imported.get("Desc_Wire_C").copied().unwrap_or(0.0);
        assert!(wire <= 10.0 + 1e-3, "the cap is a bound, not a label: drew {wire}");
        assert!(
            sol.recipes.iter().any(|(id, _)| id == "Recipe_Alternate_Cable_2_C"),
            "the route that doesn't need wire has to win: {:?}",
            sol.recipes
        );
    }

    #[test]
    fn an_over_cap_draw_is_still_possible_when_nothing_else_can_cover_it() {
        // Warn, don't block: a cap the chain can't respect must still
        // produce a plan (the caller raises `ImportShort` against it),
        // never an infeasible LP that dumps the user on the greedy path.
        let gd = gd();
        let mut demands = HashMap::new();
        demands.insert("Desc_Cable_C".to_string(), 60.0);
        let external = HashMap::new();
        let mut cuts = HashSet::new();
        cuts.insert("Desc_Wire_C".to_string());
        let overrides = HashMap::new();
        let alts = HashSet::new();
        let mut caps = HashMap::new();
        caps.insert("Desc_Wire_C".to_string(), 5.0_f32);
        let limits = (caps, HashMap::new());
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        let wire = sol.imported.get("Desc_Wire_C").copied().unwrap_or(0.0);
        assert!((wire - 120.0).abs() < 0.5, "the plan still renders past its cap: {wire}");
    }

    #[test]
    fn a_claimed_raw_is_preferred_over_one_the_factory_has_no_node_for() {
        // The playthrough's own case. `Fine Concrete` via `Cheap Silica`
        // is genuinely more limestone-efficient, so on rarity alone the
        // optimizer took it — and the nearest raw quartz was 810 m away
        // on the far side of another factory, for 2.6 quartz/min, next
        // door to limestone already claimed on site.
        let gd = gd();
        let mut alts = HashSet::new();
        alts.insert("Recipe_Alternate_Concrete_C".to_string());
        alts.insert("Recipe_Alternate_Silica_C".to_string());
        let mut demands = HashMap::new();
        demands.insert("Desc_Cement_C".to_string(), 60.0);
        let external = HashMap::new();
        let cuts = HashSet::new();
        let overrides = HashMap::new();
        let quartz = |sol: &PlanSolution| sol.raw_extraction.contains_key("Desc_RawQuartz_C");

        // Nothing claimed: every raw is priced the same multiple, so the
        // relative ordering — and the plan — is what it always was.
        let nothing = no_limits();
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &nothing);
        let unclaimed = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        assert!(
            quartz(&unclaimed),
            "with nothing claimed the limestone-efficient route still wins: {:?}",
            unclaimed.recipes
        );

        let mut claimed = HashMap::new();
        claimed.insert("Desc_Stone_C".to_string(), 300.0_f32);
        let limits = (HashMap::new(), claimed);
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let local = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        assert!(
            !quartz(&local),
            "limestone this factory has claimed beats quartz it has to go and find: {:?}",
            local.recipes
        );
    }

    #[test]
    fn a_bank_producing_a_hundredth_of_an_item_a_minute_is_not_built() {
        // The phantom: an external share that covers all but a hair of
        // an item's consumption leaves a local line at 1% clock making
        // 0.0/min, and it still counts machines and still draws ore. One
        // such row carried eight machines into a plan's headline count.
        let gd = gd();
        let mut demands = HashMap::new();
        demands.insert("Desc_Cable_C".to_string(), 60.0);
        let cuts = HashSet::new();
        let overrides = HashMap::new();
        let alts = HashSet::new();
        let limits = no_limits();
        let wire_line = |sol: &PlanSolution| {
            sol.recipes.iter().any(|(id, _)| {
                gd.recipe(id)
                    .and_then(|r| r.outputs.first())
                    .map(|o| o.item_id == "Desc_Wire_C")
                    .unwrap_or(false)
            })
        };

        let mut external = HashMap::new();
        external.insert("Desc_Wire_C".to_string(), 119.99_f32);
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        assert!(!wire_line(&sol), "phantom wire line: {:?}", sol.recipes);
        assert!(
            !sol.raw_extraction.contains_key("Desc_OreIron_C"),
            "and no ore behind it: {:?}",
            sol.raw_extraction
        );

        // The threshold must not eat production somebody can see.
        let mut external = HashMap::new();
        external.insert("Desc_Wire_C".to_string(), 110.0_f32);
        let input = base_input(&demands, &external, &cuts, &overrides, &alts, &limits);
        let sol = solve(&gd, &input, &rarity_weights(&gd)).unwrap();
        assert!(wire_line(&sol), "10/min of real wire must be built: {:?}", sol.recipes);
    }
}
