//! The matrix enumeration engine.
//!
//! Every case is one (item, tier, alt mode) triple solved through the
//! real `compute_plan_graph`, so the sibling suites can assert what the
//! planner actually produces against an independent model of what the
//! tier allows. That model is `planner::tier` — the same whole-chain
//! table the planner itself gates on — reached here through
//! `first_producible_tier`.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::features::planner::commands::tier_reachable_alts;
use crate::features::planner::domain::compute_plan_graph;
use crate::features::planner::dto::{PlanComputeOptions, PlanGraph, PlanTargetSpec, PlannerError};
use crate::features::planner::tier::{self, Sourcing, TierTable};
use crate::features::resource_nodes::domain::{best_belt_tier, best_pipe_tier};
use crate::shared::gamedata::GameData;

pub(crate) use crate::features::planner::tier::AltMode;

/// Every case is solved under this synthetic factory id — the matrix
/// never touches a real playthrough, so the id just needs to be stable
/// for `compute_plan_graph`'s self-supply bookkeeping.
const MATRIX_FACTORY_ID: &str = "matrix-harness";

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

/// Best belt throughput unlocked by `tier` — Mk1 is unlocked at Tier 0,
/// so this is always defined for any `u8` tier.
///
/// Resolved through `best_belt_tier` rather than folded here on
/// purpose: this harness is the test oracle for the whole planner
/// matrix and every case's `target_ipm` comes from it, so a private
/// copy that drifted from the lookup Validate uses would certify plans
/// sized against a capacity the app then flags.
pub(crate) fn belt_cap(gd: &GameData, tier: u8) -> f32 {
    best_belt_tier(tier, gd).map(|b| b.items_per_minute as f32).unwrap_or(0.0)
}

/// Best pipe throughput unlocked by `tier`, or `None` when no pipe
/// tier is unlocked yet (there is no pipe below Tier 3). Same lookup as
/// `belt_cap`, and `None` here is the same "no carrier exists yet" that
/// `best_pipe_tier` means by it — never a capacity of zero.
pub(crate) fn pipe_cap(gd: &GameData, tier: u8) -> Option<f32> {
    best_pipe_tier(tier, gd).map(|p| p.cubic_meters_per_minute as f32)
}

/// Earliest tier `item_id`'s chain fully grounds out under `alts`, or
/// `None` if no chain ever grounds out (e.g. an alt-only item under
/// `AltMode::Off`).
pub(crate) fn first_producible_tier(gd: &GameData, item_id: &str, alts: AltMode) -> Option<u8> {
    tier_table(gd, alts).get(item_id).copied().flatten()
}

/// The relaxed tier table for one alt mode, solved once and cached —
/// every producible item's tier depends on every other's, so there's
/// no cheaper unit of work than "the whole graph," and every case in
/// the matrix wants the same table for a given `alts`.
fn tier_table(gd: &GameData, alts: AltMode) -> &'static TierTable {
    static OFF: OnceLock<TierTable> = OnceLock::new();
    static ON: OnceLock<TierTable> = OnceLock::new();
    match alts {
        AltMode::Off => OFF.get_or_init(|| tier::item_tier_table(gd, AltMode::Off, Sourcing::Automated)),
        AltMode::On => ON.get_or_init(|| tier::item_tier_table(gd, AltMode::On, Sourcing::Automated)),
    }
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
        // The case's tier is the whole point — solving it ungated
        // would let a Tier 3 case plan a Tier 8 chain and every
        // invariant built on this matrix would pass on a lie.
        Some(case.tier),
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

    /// The matrix sizes every case at `belt_cap(gd, tier)` and Validate
    /// flags a claim at `port_capacity`. If the two ever answered
    /// differently the suite would certify plans built against a
    /// capacity the app then warns about — green tests, wrong app.
    #[test]
    fn caps_agree_with_the_lookup_validate_uses_at_every_tier() {
        let gd = GameData::from_bundled().unwrap();
        for tier in 0..=10u8 {
            assert_eq!(
                belt_cap(&gd, tier),
                best_belt_tier(tier, &gd).map(|b| b.items_per_minute as f32).unwrap_or(0.0),
                "belt cap disagrees at tier {tier}"
            );
            assert_eq!(
                pipe_cap(&gd, tier),
                best_pipe_tier(tier, &gd).map(|p| p.cubic_meters_per_minute as f32),
                "pipe cap disagrees at tier {tier}"
            );
        }
    }

    #[test]
    fn first_producible_tier_reads_through_to_the_shared_tier_table() {
        let gd = GameData::from_bundled().unwrap();
        // Iron Plate: Smelter + Constructor, both Tier 0 buildings, no
        // alt required — producible from the very first tier. The
        // table's own coverage lives in `planner::tier`; this pins the
        // read-through and the caching wrapper around it.
        assert_eq!(first_producible_tier(&gd, "Desc_IronPlate_C", AltMode::Off), Some(0));
        assert_eq!(first_producible_tier(&gd, "Desc_IronPlate_C", AltMode::On), Some(0));
        assert!(std::ptr::eq(tier_table(&gd, AltMode::On), tier_table(&gd, AltMode::On)));

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

}
