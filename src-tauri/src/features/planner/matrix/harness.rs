//! The matrix enumeration engine.
//!
//! `first_producible_tier` is the piece that would have caught the
//! original bug: it computes the earliest tier an item's chain fully
//! grounds out, from `Recipe.unlock_tier` and `Building.unlock_tier`
//! directly, independent of `compute_plan_graph`. That's deliberate —
//! `compute_plan_graph` itself never gates a standard recipe by tier
//! (only `unlocked_alts` narrows candidates), so asking the planner
//! whether an item is "producible at tier N" would always answer yes
//! for any tier once a single non-alt chain exists. This module is the
//! independent tier model the invariant suite checks the planner's
//! actual output against.
//!
//! A recipe's own ground tier is `max(recipe.unlock_tier,
//! building.unlock_tier)` — the exact pairing whose mismatch (an alt
//! shipped with a lower unlock tier than the building it runs in) is
//! the bug this matrix exists to catch. An item's tier is the cheapest
//! viable recipe once every input is itself available by that tier;
//! extracted resources ground out at tier 0 unconditionally, mirroring
//! how `compute_plan_graph` treats claimed raw supply.
//!
//! The tier for every item is solved together by relaxing to a fixed
//! point (Bellman-Ford style) rather than by memoized per-item DFS. A
//! DFS with a `visiting` cycle guard is order-dependent: item X's
//! answer, cached while some unrelated ancestor Y happens to be mid-
//! cycle, can come out too pessimistic (a candidate recipe of X that
//! routes through Y gets excluded from X's `min` for that evaluation,
//! even though X reached independently would have found it fine) — and
//! that pessimistic value then poisons every other item that reuses
//! X's cache entry. In this dataset the recipe graph is interconnected
//! enough (roughly 40% of producible items sit adjacent to some cycle)
//! that this isn't a corner case: it under-reported several items'
//! tiers, including one item four tiers too high and several reported
//! as never producible at all when they are. Relaxation has no
//! evaluation order to be sensitive to — every item starts unknown
//! (extracted resources start at tier 0), each pass tries to improve
//! every item from whatever its inputs currently know, and it repeats
//! until a full pass changes nothing.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::features::planner::commands::tier_reachable_alts;
use crate::features::planner::domain::compute_plan_graph;
use crate::features::planner::dto::{PlanComputeOptions, PlanGraph, PlanTargetSpec, PlannerError};
use crate::shared::gamedata::GameData;

/// Every case is solved under this synthetic factory id — the matrix
/// never touches a real playthrough, so the id just needs to be stable
/// for `compute_plan_graph`'s self-supply bookkeeping.
const MATRIX_FACTORY_ID: &str = "matrix-harness";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum AltMode {
    Off,
    On,
}

#[derive(Debug, Clone)]
pub(crate) struct MatrixCase {
    pub item_id: String,
    pub tier: u8,
    pub alts: AltMode,
    /// One belt's worth for this tier — every case plans a rate that's
    /// actually movable, not an arbitrary round number.
    pub target_ipm: f32,
}

pub(crate) struct CaseResult {
    pub case: MatrixCase,
    /// A handful of Tier 9, alts-on targets downstream of the
    /// Rubber/Plastic recycling alts (`Desc_SpaceElevatorPart_10_C`,
    /// `_12_C`, `Desc_CrystalShard_C`, and siblings) are seen to flip
    /// between `Ok` and `Err(CycleDetected)` across separate runs, even
    /// with a generous `solver_budget_ms` — the LP optimizer resolves
    /// the recycling loop, but the greedy fallback's recursion cannot,
    /// and which path wins races real solver timing. An `Err` on one of
    /// those items is not necessarily a stable fact of the dataset;
    /// a consumer that hard-asserts a specific outcome for one of them
    /// should expect it to be flaky.
    pub outcome: Result<PlanGraph, PlannerError>,
    pub belt_cap_ipm: f32,
    /// `None` below Tier 3 — there is no pipe yet, so any plan moving a
    /// fluid down there is unbuildable by definition. Load-bearing for
    /// a negative test; never collapse this to `0.0`.
    pub pipe_cap_ipm: Option<f32>,
}

/// `Recipe_Unpackage*` recipes are inverse-utility (they only exist to
/// recover a liquid/gas from its packaged form) and are excluded from
/// chain candidates everywhere else in the planner
/// (`domain::is_inverse_recipe`); that helper is private to `domain.rs`
/// so the tier model duplicates the same one-line rule rather than
/// widen that module's visibility for a test harness.
fn is_inverse_recipe(recipe_id: &str) -> bool {
    recipe_id.starts_with("Recipe_Unpackage")
}

/// Best belt throughput unlocked by `tier`, derived from
/// `belt_tiers` — Mk1 is unlocked at Tier 0, so this is always defined
/// for any `u8` tier.
pub(crate) fn belt_cap(gd: &GameData, tier: u8) -> f32 {
    gd.belt_tiers()
        .iter()
        .filter(|b| b.unlock_tier <= tier)
        .map(|b| b.items_per_minute as f32)
        .fold(0.0_f32, f32::max)
}

/// Best pipe throughput unlocked by `tier`, or `None` when no pipe
/// tier is unlocked yet (there is no pipe below Tier 3).
pub(crate) fn pipe_cap(gd: &GameData, tier: u8) -> Option<f32> {
    gd.pipe_tiers()
        .iter()
        .filter(|p| p.unlock_tier <= tier)
        .map(|p| p.cubic_meters_per_minute as f32)
        .fold(None, |best, v| Some(best.map_or(v, |b: f32| b.max(v))))
}

/// Earliest tier `item_id`'s chain fully grounds out under `alts`, or
/// `None` if no chain ever grounds out (e.g. an alt-only item under
/// `AltMode::Off`). See the module doc for why this is computed from
/// the dataset's tier fields instead of by probing `compute_plan_graph`,
/// and why it's a whole-graph relaxation rather than a per-item walk.
pub(crate) fn first_producible_tier(gd: &GameData, item_id: &str, alts: AltMode) -> Option<u8> {
    tier_table(gd, alts).get(item_id).copied().flatten()
}

/// The relaxed tier table for one alt mode, solved once and cached —
/// every producible item's tier depends on every other's, so there's
/// no cheaper unit of work than "the whole graph," and every caller
/// wants the same table for a given `alts`.
fn tier_table(gd: &GameData, alts: AltMode) -> &'static HashMap<String, Option<u8>> {
    static OFF: OnceLock<HashMap<String, Option<u8>>> = OnceLock::new();
    static ON: OnceLock<HashMap<String, Option<u8>>> = OnceLock::new();
    match alts {
        AltMode::Off => OFF.get_or_init(|| compute_tier_table(gd, AltMode::Off)),
        AltMode::On => ON.get_or_init(|| compute_tier_table(gd, AltMode::On)),
    }
}

fn compute_tier_table(gd: &GameData, alts: AltMode) -> HashMap<String, Option<u8>> {
    let mut tier: HashMap<String, Option<u8>> = gd
        .items()
        .iter()
        .map(|item| {
            // Extracted resources ground out at tier 0 regardless of
            // any recipe that happens to also emit them (e.g. Water as
            // a byproduct) — matches how `compute_plan_graph` treats
            // claimed raw supply as unconditionally viable.
            let seed = if gd.is_extracted_resource(&item.id) { Some(0) } else { None };
            (item.id.clone(), seed)
        })
        .collect();

    loop {
        let mut changed = false;
        for item in gd.items() {
            if gd.is_extracted_resource(&item.id) {
                continue;
            }
            let mut best = tier[&item.id];
            for recipe in gd.recipes_producing(&item.id) {
                if is_inverse_recipe(&recipe.id) {
                    continue;
                }
                if recipe.is_alt && alts == AltMode::Off {
                    continue;
                }
                let building_tier = gd.building(&recipe.building_id).map(|b| b.unlock_tier).unwrap_or(0);
                let mut recipe_tier = recipe.unlock_tier.max(building_tier);
                let mut viable = true;
                for input in &recipe.inputs {
                    match tier.get(&input.item_id).copied().flatten() {
                        Some(t) => recipe_tier = recipe_tier.max(t),
                        None => {
                            viable = false;
                            break;
                        }
                    }
                }
                if viable {
                    best = Some(best.map_or(recipe_tier, |b: u8| b.min(recipe_tier)));
                }
            }
            if best != tier[&item.id] {
                tier.insert(item.id.clone(), best);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    tier
}

/// True for items a plan can target at all — mirrors the guard
/// `compute_plan_graph` itself applies to every target (extracted
/// resources and items with no producing recipe are structural
/// errors, not planning states).
fn is_producible(gd: &GameData, item_id: &str) -> bool {
    !gd.is_extracted_resource(item_id) && !gd.recipes_producing(item_id).is_empty()
}

/// Every producible item, from the tier it first becomes producible
/// through T9, both alt modes.
pub(crate) fn all_cases(gd: &GameData) -> Vec<MatrixCase> {
    let mut cases = Vec::new();
    for item in gd.items() {
        if !is_producible(gd, &item.id) {
            continue;
        }
        for alts in [AltMode::Off, AltMode::On] {
            let Some(first_tier) = first_producible_tier(gd, &item.id, alts) else {
                continue;
            };
            for tier in first_tier..=9 {
                cases.push(MatrixCase {
                    item_id: item.id.clone(),
                    tier,
                    alts,
                    target_ipm: belt_cap(gd, tier),
                });
            }
        }
    }
    cases
}

/// The negative set: each producible item at tiers *below* its first
/// producible tier — the shape the original bug (a Tier 5 alt claiming
/// Tier 0) would have landed in.
pub(crate) fn below_tier_cases(gd: &GameData) -> Vec<MatrixCase> {
    let mut cases = Vec::new();
    for item in gd.items() {
        if !is_producible(gd, &item.id) {
            continue;
        }
        for alts in [AltMode::Off, AltMode::On] {
            let Some(first_tier) = first_producible_tier(gd, &item.id, alts) else {
                continue;
            };
            for tier in 0..first_tier {
                cases.push(MatrixCase {
                    item_id: item.id.clone(),
                    tier,
                    alts,
                    target_ipm: belt_cap(gd, tier),
                });
            }
        }
    }
    cases
}

fn solve_case(gd: &GameData, case: MatrixCase) -> CaseResult {
    let unlocked = match case.alts {
        AltMode::On => tier_reachable_alts(case.tier, gd),
        AltMode::Off => HashSet::new(),
    };
    let target = PlanTargetSpec { item_id: case.item_id.clone(), ipm: case.target_ipm, export_ipm: None };
    let outcome = compute_plan_graph(
        MATRIX_FACTORY_ID,
        &[target],
        &unlocked,
        &HashMap::new(),
        &[],
        &HashMap::new(),
        &HashMap::new(),
        &PlanComputeOptions::default(),
        gd,
    );
    let belt_cap_ipm = belt_cap(gd, case.tier);
    let pipe_cap_ipm = pipe_cap(gd, case.tier);
    CaseResult { case, outcome, belt_cap_ipm, pipe_cap_ipm }
}

/// Solves every `all_cases` entry once and caches the result — three
/// sibling suites ask for this, and re-solving ~900 cases per test file
/// is the difference between a suite people run and one they start
/// skipping.
pub(crate) fn run_all(gd: &GameData) -> &'static [CaseResult] {
    static CACHE: OnceLock<Vec<CaseResult>> = OnceLock::new();
    CACHE.get_or_init(|| all_cases(gd).into_iter().map(|case| solve_case(gd, case)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn belt_cap_matches_dataset_at_boundary_tiers() {
        let gd = GameData::from_bundled().unwrap();
        // Mirrors the belt table in the shared context — derived from
        // the dataset, so this test would fail if the dataset's tiers
        // ever shifted out from under that table.
        assert_eq!(belt_cap(&gd, 0), 60.0);
        assert_eq!(belt_cap(&gd, 1), 60.0);
        assert_eq!(belt_cap(&gd, 2), 120.0);
        assert_eq!(belt_cap(&gd, 3), 120.0);
        assert_eq!(belt_cap(&gd, 4), 270.0);
        assert_eq!(belt_cap(&gd, 5), 480.0);
        assert_eq!(belt_cap(&gd, 6), 480.0);
        assert_eq!(belt_cap(&gd, 7), 780.0);
        assert_eq!(belt_cap(&gd, 9), 1200.0);
    }

    #[test]
    fn pipe_cap_is_none_below_tier_3_and_defined_from_there() {
        let gd = GameData::from_bundled().unwrap();
        assert_eq!(pipe_cap(&gd, 0), None, "no pipe unlocked yet");
        assert_eq!(pipe_cap(&gd, 2), None, "still below the first pipe's unlock tier");
        assert_eq!(pipe_cap(&gd, 3), Some(300.0));
        assert_eq!(pipe_cap(&gd, 6), Some(600.0));
        assert_eq!(pipe_cap(&gd, 9), Some(600.0), "no pipe past Mk2 in this dataset");
    }

    #[test]
    fn first_producible_tier_agrees_with_hand_checked_items() {
        let gd = GameData::from_bundled().unwrap();
        // Iron Plate: Smelter + Constructor, both Tier 0 buildings, no
        // alt required — producible from the very first tier.
        assert_eq!(
            first_producible_tier(&gd, "Desc_IronPlate_C", AltMode::Off),
            Some(0)
        );
        assert_eq!(
            first_producible_tier(&gd, "Desc_IronPlate_C", AltMode::On),
            Some(0)
        );

        // An extracted resource is never a valid plan target, so it
        // must never surface as "producible" — it's excluded from the
        // matrix entirely, not merely tier-gated.
        assert!(!is_producible(&gd, "Desc_OreIron_C"));
    }

    #[test]
    fn all_cases_and_below_tier_cases_are_sane() {
        let gd = GameData::from_bundled().unwrap();
        let cases = all_cases(&gd);
        // The dataset carries a real chunk of items that never ground
        // out at all — FICSMAS/event cosmetics, hunted Alien organs,
        // and the whole nuclear-waste-gated fuel tech tree, none of
        // which have any recipe (or extractor) producing their raw
        // inputs in this dataset. Real count lands well under the
        // ~1,484 planning-estimate; assert a band so a legitimate
        // dataset addition doesn't need this test hand-edited.
        assert!(
            cases.len() > 700 && cases.len() < 1_100,
            "case count out of the expected band: {}",
            cases.len()
        );
        assert!(cases.iter().all(|c| c.tier <= 9));

        let below = below_tier_cases(&gd);
        assert!(!below.is_empty(), "some item must be gated above tier 0 or the negative set is empty");
        assert!(
            below.iter().all(|c| {
                let first = first_producible_tier(&gd, &c.item_id, c.alts).unwrap();
                c.tier < first
            }),
            "every below-tier case must sit strictly below its item's first producible tier"
        );

        // The two sets never overlap for the same (item, tier, alts).
        for b in &below {
            assert!(
                !cases.iter().any(|c| c.item_id == b.item_id && c.tier == b.tier && c.alts == b.alts),
                "below-tier case leaked into the positive set: {} @T{}",
                b.item_id,
                b.tier
            );
        }
    }

    #[test]
    fn run_all_solves_once_and_caches() {
        let gd = GameData::from_bundled().unwrap();
        let start = Instant::now();
        let first = run_all(&gd);
        let first_elapsed = start.elapsed();
        let solved = first.len();
        assert!(solved > 700, "expected the full matrix, got {solved} cases");

        // The second call must hit the cache — same backing allocation,
        // not a re-solve. `Instant` isn't asserted against directly
        // (too flaky under CI load); the pointer identity is the real
        // proof the cache fired.
        let second = run_all(&gd);
        assert!(
            std::ptr::eq(first.as_ptr(), second.as_ptr()),
            "run_all must return the cached allocation on repeat calls"
        );

        let errs = first.iter().filter(|r| r.outcome.is_err()).count();
        eprintln!(
            "matrix harness: {solved} cases solved in {first_elapsed:?} ({errs} returned Err)"
        );
    }

    #[test]
    fn case_result_caps_are_consistent_with_the_case_they_were_solved_for() {
        // The whole point of carrying the caps on `CaseResult` (rather
        // than making every sibling suite call `belt_cap`/`pipe_cap`
        // itself) is that they're already pinned to that case's tier —
        // assert that pinning actually holds.
        let gd = GameData::from_bundled().unwrap();
        for result in run_all(&gd) {
            assert_eq!(result.belt_cap_ipm, belt_cap(&gd, result.case.tier));
            assert_eq!(result.pipe_cap_ipm, pipe_cap(&gd, result.case.tier));
            assert_eq!(result.case.target_ipm, result.belt_cap_ipm, "each case targets exactly one belt's worth");
        }
    }

    #[test]
    fn tier_table_relaxation_does_not_under_report_cycle_adjacent_items() {
        // Regression coverage for the exact bug a memoized-DFS version
        // of this table had: items whose recipe sits near a recycling
        // loop (Rubber/Plastic, here) got a too-pessimistic — or
        // entirely missing — tier because the DFS cached a result
        // computed while an unrelated ancestor was mid-cycle. These
        // three were confirmed wrong under that approach and are
        // hand-verified correct here.
        let gd = GameData::from_bundled().unwrap();
        assert_eq!(
            first_producible_tier(&gd, "Desc_SpaceElevatorPart_2_C", AltMode::On),
            Some(3),
            "Smart Plating's standard recipe only needs Modular Frame (T2) + Steel Plate (T3), \
             both grounded well before its own T7 alt"
        );
        assert_eq!(
            first_producible_tier(&gd, "Desc_AlienPowerFuel_C", AltMode::Off),
            Some(9),
            "producible via its standard T9 recipe even with alts off"
        );
        assert_eq!(
            first_producible_tier(&gd, "Desc_SpaceElevatorPart_9_C", AltMode::On),
            Some(8),
            "Nuclear Pasta's standard recipe needs Copper Dust + Pressure Conversion Cube, both T8"
        );
    }
}
