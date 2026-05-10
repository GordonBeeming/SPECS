//! Pure transport-plan math.
//!
//! The planner takes (item, ipm, distance, unlocked tier) and produces a
//! ranked `Vec<TransportPlan>` covering the unlocked transport options. The
//! caller picks one to persist on the link row. Phase 5a covers belts and
//! pipes — both depend only on the bundled `BeltTier` / `PipeTier` rows the
//! dataset already encodes. Vehicles, trains, and drones land in Phase 5b
//! once those tables exist in the dataset.
//!
//! Functions here take values, return values — no `tauri::State`, no DB.
//! Tests sit alongside and pin against the wiki-verified capacity table.

use crate::shared::gamedata::types::{BeltTier, PipeTier};

use super::dto::{TransportKind, TransportPlan, TransportSegment};

/// Hard ceiling on belt count per single-tier plan. Past this point the
/// recommendation stops being useful (no player wires up 30 belts of the
/// same item) — better to upgrade the tier or split the factory. The cap
/// also keeps the planner output bounded when someone asks for an absurd
/// ipm at low tier.
const MAX_BELTS_PER_PLAN: u32 = 12;
const MAX_PIPES_PER_PLAN: u32 = 12;
const MAX_PLANS_RETURNED: usize = 8;

/// Build the ranked list of belt plans for the requested ipm.
///
/// Generates two families:
/// 1. **Single-tier plans** — `count = ceil(ipm / capacity)` for each belt
///    tier, capped at `MAX_BELTS_PER_PLAN`. One per tier.
/// 2. **Mixed two-tier plans** — for each ordered pair `(primary, topup)`
///    where `primary > topup`, take as many primaries as fit underneath the
///    requested ipm, then top up with the smallest count of `topup` belts
///    that closes the gap. Skips combinations the single-tier plan already
///    covers.
///
/// Plans are ranked by total segment count ASC, then by utilisation
/// (closest to 100%) DESC. Locked plans (any segment above `unlocked_tier`)
/// stay in the list with `locked = true` so the UI can show them greyed.
pub fn plan_belts(
    items_per_minute: f32,
    belts: &[BeltTier],
    unlocked_tier: u8,
) -> Vec<TransportPlan> {
    if items_per_minute <= 0.0 || belts.is_empty() {
        return Vec::new();
    }

    let mut tiers: Vec<&BeltTier> = belts.iter().collect();
    // Highest capacity first — gives single-tier plans a natural ordering
    // and makes the "primary is always the bigger one" invariant trivial.
    tiers.sort_by(|a, b| b.items_per_minute.cmp(&a.items_per_minute));

    let mut plans = Vec::new();

    // Single-tier plans.
    for t in &tiers {
        if let Some(plan) = single_segment_plan(
            TransportKind::Belt,
            items_per_minute,
            t.mark,
            t.items_per_minute as f32,
            t.unlock_tier,
            unlocked_tier,
            MAX_BELTS_PER_PLAN,
        ) {
            plans.push(plan);
        }
    }

    // Mixed two-tier plans.
    for (i, primary) in tiers.iter().enumerate() {
        for topup in tiers.iter().skip(i + 1) {
            if let Some(plan) = mixed_two_segment_plan(
                TransportKind::Belt,
                items_per_minute,
                (primary.mark, primary.items_per_minute as f32, primary.unlock_tier),
                (topup.mark, topup.items_per_minute as f32, topup.unlock_tier),
                unlocked_tier,
                MAX_BELTS_PER_PLAN,
            ) {
                plans.push(plan);
            }
        }
    }

    finalise_plans(plans)
}

/// Build the ranked list of pipe plans for the requested m³/min.
///
/// Same shape as `plan_belts` — single-tier and mixed two-tier plans, ranked
/// by segment count then utilisation.
pub fn plan_pipes(
    cubic_metres_per_minute: f32,
    pipes: &[PipeTier],
    unlocked_tier: u8,
) -> Vec<TransportPlan> {
    if cubic_metres_per_minute <= 0.0 || pipes.is_empty() {
        return Vec::new();
    }

    let mut tiers: Vec<&PipeTier> = pipes.iter().collect();
    tiers.sort_by(|a, b| b.cubic_meters_per_minute.cmp(&a.cubic_meters_per_minute));

    let mut plans = Vec::new();

    for t in &tiers {
        if let Some(plan) = single_segment_plan(
            TransportKind::Pipe,
            cubic_metres_per_minute,
            t.mark,
            t.cubic_meters_per_minute as f32,
            t.unlock_tier,
            unlocked_tier,
            MAX_PIPES_PER_PLAN,
        ) {
            plans.push(plan);
        }
    }

    for (i, primary) in tiers.iter().enumerate() {
        for topup in tiers.iter().skip(i + 1) {
            if let Some(plan) = mixed_two_segment_plan(
                TransportKind::Pipe,
                cubic_metres_per_minute,
                (primary.mark, primary.cubic_meters_per_minute as f32, primary.unlock_tier),
                (topup.mark, topup.cubic_meters_per_minute as f32, topup.unlock_tier),
                unlocked_tier,
                MAX_PIPES_PER_PLAN,
            ) {
                plans.push(plan);
            }
        }
    }

    finalise_plans(plans)
}

fn single_segment_plan(
    kind: TransportKind,
    requested: f32,
    mark: u8,
    per_unit: f32,
    unlock_tier: u8,
    unlocked_tier: u8,
    max_count: u32,
) -> Option<TransportPlan> {
    if per_unit <= 0.0 {
        return None;
    }
    let count = (requested / per_unit).ceil() as u32;
    if count == 0 || count > max_count {
        return None;
    }
    Some(build_plan(
        kind,
        vec![TransportSegment {
            mark,
            count,
            per_unit_capacity: per_unit,
            unlock_tier,
        }],
        requested,
        unlocked_tier,
    ))
}

fn mixed_two_segment_plan(
    kind: TransportKind,
    requested: f32,
    primary: (u8, f32, u8),
    topup: (u8, f32, u8),
    unlocked_tier: u8,
    max_total: u32,
) -> Option<TransportPlan> {
    let (p_mark, p_cap, p_tier) = primary;
    let (t_mark, t_cap, t_tier) = topup;
    if p_cap <= 0.0 || t_cap <= 0.0 || p_cap <= t_cap {
        return None;
    }

    // Fit as many primaries as land *underneath* the requested ipm — leave
    // at least one slot for the top-up so the result is genuinely mixed.
    // `floor` of `requested / p_cap` gives that count; if it lands at zero
    // there's no point recommending zero of the primary, skip the combo.
    let primary_count = (requested / p_cap).floor() as u32;
    if primary_count == 0 {
        return None;
    }
    let primary_throughput = primary_count as f32 * p_cap;
    let remaining = requested - primary_throughput;
    if remaining <= 0.0 {
        // Primary alone covers it — that's the single-tier plan, not a mixed one.
        return None;
    }
    let topup_count = (remaining / t_cap).ceil() as u32;
    if topup_count == 0 {
        return None;
    }
    let total = primary_count + topup_count;
    if total > max_total {
        return None;
    }

    Some(build_plan(
        kind,
        vec![
            TransportSegment {
                mark: p_mark,
                count: primary_count,
                per_unit_capacity: p_cap,
                unlock_tier: p_tier,
            },
            TransportSegment {
                mark: t_mark,
                count: topup_count,
                per_unit_capacity: t_cap,
                unlock_tier: t_tier,
            },
        ],
        requested,
        unlocked_tier,
    ))
}

fn build_plan(
    kind: TransportKind,
    segments: Vec<TransportSegment>,
    requested: f32,
    unlocked_tier: u8,
) -> TransportPlan {
    let total = segments
        .iter()
        .map(|s| s.count as f32 * s.per_unit_capacity)
        .sum::<f32>();
    let utilisation = if total > 0.0 {
        ((requested / total) * 100.0).min(100.0)
    } else {
        0.0
    };
    let min_unlock_tier = segments.iter().map(|s| s.unlock_tier).max().unwrap_or(0);
    let locked = min_unlock_tier > unlocked_tier;

    TransportPlan {
        kind,
        segments,
        total_capacity_per_minute: total,
        utilisation_pct: utilisation,
        min_unlock_tier,
        locked,
    }
}

/// Sort + deduplicate + cap. Plans are ranked by:
/// 1. Lower total *unit* count first (sum of `segment.count` across all
///    segments — fewer belts/pipes = less infrastructure to build).
///    A 1×Mk6 plan (1 unit) ranks above a 1×Mk5 + 1×Mk1 plan (2 units).
/// 2. Higher utilisation second (closer to 100% = less wasted infra)
/// 3. Lower min_unlock_tier third (cheaper to unlock if otherwise tied)
fn finalise_plans(mut plans: Vec<TransportPlan>) -> Vec<TransportPlan> {
    plans.sort_by(|a, b| {
        let total_a: u32 = a.segments.iter().map(|s| s.count).sum();
        let total_b: u32 = b.segments.iter().map(|s| s.count).sum();
        total_a
            .cmp(&total_b)
            .then_with(|| {
                b.utilisation_pct
                    .partial_cmp(&a.utilisation_pct)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.min_unlock_tier.cmp(&b.min_unlock_tier))
    });

    // Deduplicate plans with identical segment shape — single-tier and
    // mixed-tier paths can occasionally produce equivalent recommendations
    // (e.g. when the top-up count happens to match the primary jump).
    plans.dedup_by(|a, b| a.segments == b.segments && a.kind == b.kind);
    plans.truncate(MAX_PLANS_RETURNED);
    plans
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::gamedata::types::{BeltTier, PipeTier};

    /// Wiki-pinned belt capacities — Mk1 = 60 ipm, doubling-ish through Mk6 = 1200.
    /// Unlock tiers from the milestone unlock table.
    fn all_belts() -> Vec<BeltTier> {
        vec![
            BeltTier { mark: 1, items_per_minute: 60, unlock_tier: 0 },
            BeltTier { mark: 2, items_per_minute: 120, unlock_tier: 2 },
            BeltTier { mark: 3, items_per_minute: 270, unlock_tier: 4 },
            BeltTier { mark: 4, items_per_minute: 480, unlock_tier: 5 },
            BeltTier { mark: 5, items_per_minute: 780, unlock_tier: 7 },
            BeltTier { mark: 6, items_per_minute: 1200, unlock_tier: 9 },
        ]
    }

    fn all_pipes() -> Vec<PipeTier> {
        vec![
            PipeTier { mark: 1, cubic_meters_per_minute: 300, unlock_tier: 3 },
            PipeTier { mark: 2, cubic_meters_per_minute: 600, unlock_tier: 6 },
        ]
    }

    #[test]
    fn empty_inputs_return_empty_plan_list() {
        assert!(plan_belts(0.0, &all_belts(), 9).is_empty());
        assert!(plan_belts(60.0, &[], 9).is_empty());
        assert!(plan_belts(-1.0, &all_belts(), 9).is_empty());
    }

    #[test]
    fn sixty_ipm_at_tier_9_top_plan_is_single_mk1() {
        // 60 ipm fits on a single Mk1 belt at 100% — that's the optimal plan.
        // Lower-tier alternatives at higher counts come below it.
        let plans = plan_belts(60.0, &all_belts(), 9);
        let first = &plans[0];
        assert_eq!(first.segments.len(), 1);
        assert_eq!(first.segments[0].mark, 1);
        assert_eq!(first.segments[0].count, 1);
        assert!((first.utilisation_pct - 100.0).abs() < 0.01);
        assert!(!first.locked);
    }

    #[test]
    fn mk6_belt_handles_1200_ipm_at_100pct() {
        // Wiki: Mk6 = 1200 ipm. So 1200 ipm should be exactly 1× Mk6 at 100%.
        let plans = plan_belts(1200.0, &all_belts(), 9);
        let first = &plans[0];
        assert_eq!(first.segments[0].mark, 6);
        assert_eq!(first.segments[0].count, 1);
        assert!((first.utilisation_pct - 100.0).abs() < 0.01);
    }

    #[test]
    fn four_fifty_ipm_at_tier_9_offers_tightest_single_belt_plan() {
        // 450 ipm at T9: Mk4 (480, 93.75%), Mk5 (780, 57.7%), Mk6 (1200, 37.5%)
        // are all single-belt plans. Tied on segment count, the planner picks
        // by utilisation DESC, so Mk4 wins — the leftover headroom is much
        // smaller than going straight to Mk6.
        let plans = plan_belts(450.0, &all_belts(), 9);
        let first = &plans[0];
        assert_eq!(first.segments.len(), 1);
        assert_eq!(first.segments[0].count, 1);
        assert_eq!(first.segments[0].mark, 4);
        assert!((first.utilisation_pct - 93.75).abs() < 0.05);
        // Mk6 is still in the list (just not on top); verify it survived.
        assert!(plans.iter().any(|p| p.segments[0].mark == 6 && p.segments[0].count == 1));
    }

    #[test]
    fn over_capacity_request_picks_lowest_belt_count_plan() {
        // 2200 ipm at Tier 9: 2× Mk6 (2400, 91.67%) is the obvious answer
        // and should be top-ranked (2 segments, very high util).
        let plans = plan_belts(2200.0, &all_belts(), 9);
        let first = &plans[0];
        let count: u32 = first.segments.iter().map(|s| s.count).sum();
        assert_eq!(count, 2);
        assert_eq!(first.segments[0].mark, 6);
    }

    #[test]
    fn locked_belts_appear_with_locked_flag_set() {
        // At Tier 4, Mk5 (780, unlock 7) and Mk6 (1200, unlock 9) are locked.
        // Any plan whose primary is Mk5/Mk6 must come back as `locked = true`
        // — the UI greys these out.
        let plans = plan_belts(780.0, &all_belts(), 4);
        let mk5_plan = plans.iter().find(|p| p.segments[0].mark == 5);
        let mk6_plan = plans.iter().find(|p| p.segments[0].mark == 6);
        assert!(mk5_plan.is_some_and(|p| p.locked && p.min_unlock_tier == 7));
        assert!(mk6_plan.is_some_and(|p| p.locked && p.min_unlock_tier == 9));
    }

    #[test]
    fn unlocked_plans_at_lower_tier_keep_locked_false() {
        // At Tier 4 with 60 ipm, Mk1 (unlock 0) and Mk2 (unlock 2) are
        // unlocked; the top plan must NOT be locked.
        let plans = plan_belts(60.0, &all_belts(), 4);
        assert!(!plans[0].locked, "top plan at 60 ipm/T4 should be unlocked");
    }

    #[test]
    fn mixed_plan_uses_primary_plus_topup() {
        // 1300 ipm at T9: 1× Mk6 (1200) gets us most of the way; we need
        // one more belt for the remaining 100 ipm. The mixed plan
        // (1× Mk6 + 1× Mk2, 1320 cap, 98.5% util) should appear.
        let plans = plan_belts(1300.0, &all_belts(), 9);
        let mixed = plans.iter().find(|p| p.segments.len() == 2 && p.segments[0].mark == 6);
        assert!(mixed.is_some(), "expected a mixed Mk6 + smaller plan in the list");
        let m = mixed.unwrap();
        assert_eq!(m.segments[0].mark, 6);
        assert_eq!(m.segments[0].count, 1);
        // Top-up belt is the smallest one that closes the gap; capacity ≥ 100.
        assert!(m.total_capacity_per_minute >= 1300.0);
    }

    #[test]
    fn plans_are_ranked_by_total_unit_count_then_utilisation() {
        let plans = plan_belts(450.0, &all_belts(), 9);
        // Walk the rankings — total belts (summed across segments) must be
        // non-decreasing.
        let unit_counts: Vec<u32> = plans
            .iter()
            .map(|p| p.segments.iter().map(|s| s.count).sum())
            .collect();
        let mut sorted = unit_counts.clone();
        sorted.sort();
        assert_eq!(
            unit_counts, sorted,
            "plans must be ranked by total unit count ASC"
        );
    }

    #[test]
    fn results_are_capped_to_max_plans_returned() {
        // Plenty of viable mixed combinations in the full belt set;
        // confirm we never overflow the cap.
        let plans = plan_belts(2400.0, &all_belts(), 9);
        assert!(plans.len() <= MAX_PLANS_RETURNED);
    }

    // ---- Pipe plans ----

    #[test]
    fn three_hundred_cubic_at_tier_9_picks_single_mk1_pipe() {
        // Wiki Mk1 pipe = 300 m³/min — exact fit at 100% util.
        let plans = plan_pipes(300.0, &all_pipes(), 9);
        let first = &plans[0];
        assert_eq!(first.kind, TransportKind::Pipe);
        assert_eq!(first.segments[0].mark, 1);
        assert_eq!(first.segments[0].count, 1);
        assert!((first.utilisation_pct - 100.0).abs() < 0.01);
    }

    #[test]
    fn six_hundred_cubic_at_tier_9_picks_single_mk2_pipe() {
        // Wiki Mk2 pipe = 600 m³/min — fewest pipes (1) wins over 2× Mk1.
        let plans = plan_pipes(600.0, &all_pipes(), 9);
        let first = &plans[0];
        assert_eq!(first.segments[0].mark, 2);
        assert_eq!(first.segments[0].count, 1);
    }

    #[test]
    fn pipe_plan_locks_mk2_below_tier_6() {
        // At Tier 4, Mk2 pipe (unlock 6) is locked.
        let plans = plan_pipes(600.0, &all_pipes(), 4);
        let mk2 = plans.iter().find(|p| p.segments[0].mark == 2);
        assert!(mk2.is_some_and(|p| p.locked && p.min_unlock_tier == 6));
    }
}
