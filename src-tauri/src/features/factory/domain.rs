//! Pure recipe math.
//!
//! Throughput at 100% clock is `recipe.per_minute` straight from the
//! bundled game data. Overclocking scales linearly: a 250% Constructor
//! produces 2.5× the items it would at 100%. (Power scales non-linearly —
//! that's `overclock` slice in Phase 8/9.)
//!
//! All functions here are pure — they take values (no `tauri::State`, no
//! DB) and return values. Tests sit alongside.

use crate::shared::gamedata::types::Recipe;

/// `(item_id, items-per-minute)` pairs for one side of a machine bank.
pub type ItemFlows = Vec<(String, f32)>;

/// Effective items-per-minute for a single machine running `recipe` at the
/// given count + clock. `clock_pct` is in percent (e.g. `100.0` = 100%,
/// `250.0` = max overclock); `recipe_per_minute` is the dataset's
/// 100%-clock value for one machine.
///
/// Returns 0 if any input is non-positive — defensive against invalid
/// rows; the SQL CHECK constraint forbids them but pure-math functions
/// shouldn't depend on storage invariants.
///
/// Used by tests and reserved for the logistics planner (Phase 5) and
/// network view (Phase 7) — `compose_ledger` reaches for `recipe_io_flows`
/// directly because it needs both sides of every recipe at once.
#[allow(dead_code)]
pub fn machine_throughput_per_minute(
    recipe_per_minute: f32,
    count: i64,
    clock_pct: f32,
) -> f32 {
    if recipe_per_minute <= 0.0 || count <= 0 || clock_pct <= 0.0 {
        return 0.0;
    }
    recipe_per_minute * (count as f32) * (clock_pct / 100.0)
}

/// Clock-adjusted multiplier for a row of machines (count × clock fraction).
/// Useful when iterating over a recipe's inputs/outputs without re-doing
/// the count math each time.
pub fn machine_multiplier(count: i64, clock_pct: f32) -> f32 {
    if count <= 0 || clock_pct <= 0.0 {
        return 0.0;
    }
    (count as f32) * (clock_pct / 100.0)
}

/// Per-machine power draw at the given clock — simple linear model
/// (`base_power_mw × clock_fraction × count`). Used by older callers
/// that don't yet care about overclocking; the amplified version with
/// the wiki's exponent-1.321928 curve lives in `machine_power_mw_amp`.
#[allow(dead_code)]
pub fn machine_power_mw(base_power_mw: f32, count: i64, clock_pct: f32) -> f32 {
    if base_power_mw <= 0.0 || count <= 0 || clock_pct <= 0.0 {
        return 0.0;
    }
    base_power_mw * (count as f32) * (clock_pct / 100.0)
}

/// Wiki-derived power exponent — Power Shards drive non-linear scaling.
/// `power = base × (1 + amp_ratio)^2 × (clock/100)^1.321928`
const POWER_EXPONENT: f32 = 1.321928;

/// Amplified power draw accounting for overclock + Somersloop slot fill.
///
/// Formula matches the in-game wiki:
/// `power = base × (1 + amp_ratio)^2 × (clock/100)^1.321928 × count`
/// where `amp_ratio = filled / total_slots`. With zero filled slots the
/// `(1 + 0)^2 = 1` term collapses to the plain overclock-only curve.
///
/// Returns 0 for any non-positive input. `amp_total_slots` of 0 is
/// treated as "machine has no amplifier slots" — `amp_filled` is
/// ignored in that case.
pub fn machine_power_mw_amp(
    base_power_mw: f32,
    count: i64,
    clock_pct: f32,
    amp_filled: u8,
    amp_total_slots: u8,
) -> f32 {
    if base_power_mw <= 0.0 || count <= 0 || clock_pct <= 0.0 {
        return 0.0;
    }
    let amp_ratio = if amp_total_slots == 0 {
        0.0
    } else {
        (amp_filled.min(amp_total_slots) as f32) / (amp_total_slots as f32)
    };
    let clock_fraction = clock_pct / 100.0;
    let amp_factor = (1.0 + amp_ratio).powi(2);
    base_power_mw * (count as f32) * amp_factor * clock_fraction.powf(POWER_EXPONENT)
}

/// Output amplification from filled Somersloop slots:
/// `output_per_min × (1 + amp_ratio)`. Inputs scale linearly with the
/// same factor (the recipe is consumed faster) — the planner / ledger
/// applies this through `recipe_io_flows_amp`.
pub fn somersloop_output_factor(amp_filled: u8, amp_total_slots: u8) -> f32 {
    if amp_total_slots == 0 {
        return 1.0;
    }
    1.0 + (amp_filled.min(amp_total_slots) as f32) / (amp_total_slots as f32)
}

/// Sum a recipe's per-machine inputs/outputs into per-item flow tallies.
/// Returns `(item_id, ipm)` pairs for each side.
///
/// Multiplied through by `machine_multiplier(count, clock_pct)`.
#[allow(dead_code)]
pub fn recipe_io_flows(
    recipe: &Recipe,
    count: i64,
    clock_pct: f32,
) -> (ItemFlows, ItemFlows) {
    let mult = machine_multiplier(count, clock_pct);
    let inputs = recipe
        .inputs
        .iter()
        .map(|io| (io.item_id.clone(), io.per_minute * mult))
        .collect();
    let outputs = recipe
        .outputs
        .iter()
        .map(|io| (io.item_id.clone(), io.per_minute * mult))
        .collect();
    (inputs, outputs)
}

/// Amplified IO flows. Multiplies both sides by `count × clock × amp`
/// where `amp = (1 + amp_ratio)`. The amp factor is symmetric — both
/// inputs and outputs scale by the same number because filling slots
/// consumes the recipe faster (more inputs in) and produces more (more
/// outputs out).
pub fn recipe_io_flows_amp(
    recipe: &Recipe,
    count: i64,
    clock_pct: f32,
    amp_filled: u8,
    amp_total_slots: u8,
) -> (ItemFlows, ItemFlows) {
    let mult = machine_multiplier(count, clock_pct)
        * somersloop_output_factor(amp_filled, amp_total_slots);
    let inputs = recipe
        .inputs
        .iter()
        .map(|io| (io.item_id.clone(), io.per_minute * mult))
        .collect();
    let outputs = recipe
        .outputs
        .iter()
        .map(|io| (io.item_id.clone(), io.per_minute * mult))
        .collect();
    (inputs, outputs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::gamedata::types::{Recipe, RecipeIo};

    fn iron_ingot_recipe() -> Recipe {
        Recipe {
            id: "Recipe_IronIngot_C".into(),
            name: "Iron Ingot".into(),
            building_id: "Build_SmelterMk1_C".into(),
            is_alt: false,
            unlock_tier: 0,
            cycle_seconds: 2.0,
            inputs: vec![RecipeIo {
                item_id: "Desc_IronOre_C".into(),
                per_minute: 30.0,
            }],
            outputs: vec![RecipeIo {
                item_id: "Desc_IronIngot_C".into(),
                per_minute: 30.0,
            }],
        }
    }

    #[test]
    fn throughput_at_100pct_one_machine_is_recipe_value() {
        assert_eq!(machine_throughput_per_minute(30.0, 1, 100.0), 30.0);
    }

    #[test]
    fn throughput_scales_linearly_with_count() {
        assert_eq!(machine_throughput_per_minute(30.0, 4, 100.0), 120.0);
    }

    #[test]
    fn throughput_scales_linearly_with_clock() {
        assert_eq!(machine_throughput_per_minute(30.0, 1, 50.0), 15.0);
        assert_eq!(machine_throughput_per_minute(30.0, 1, 250.0), 75.0);
    }

    #[test]
    fn throughput_count_and_clock_compose() {
        // 3 smelters × 200% on Iron Ingot = 30 × 3 × 2.0 = 180 ipm
        assert_eq!(machine_throughput_per_minute(30.0, 3, 200.0), 180.0);
    }

    #[test]
    fn throughput_returns_zero_for_invalid_inputs() {
        assert_eq!(machine_throughput_per_minute(0.0, 1, 100.0), 0.0);
        assert_eq!(machine_throughput_per_minute(30.0, 0, 100.0), 0.0);
        assert_eq!(machine_throughput_per_minute(30.0, 1, 0.0), 0.0);
        assert_eq!(machine_throughput_per_minute(30.0, -1, 100.0), 0.0);
    }

    #[test]
    fn power_scales_linearly_with_clock_and_count() {
        // Smelter base = 4 MW. 2 smelters at 100% = 8 MW. At 50% = 4 MW.
        assert_eq!(machine_power_mw(4.0, 2, 100.0), 8.0);
        assert_eq!(machine_power_mw(4.0, 2, 50.0), 4.0);
    }

    #[test]
    fn recipe_io_flows_multiply_each_side() {
        let r = iron_ingot_recipe();
        // 5 smelters × 200% = 10× multiplier. 30 ipm in/out becomes 300.
        let (ins, outs) = recipe_io_flows(&r, 5, 200.0);
        assert_eq!(ins, vec![("Desc_IronOre_C".to_string(), 300.0)]);
        assert_eq!(outs, vec![("Desc_IronIngot_C".to_string(), 300.0)]);
    }

    #[test]
    fn recipe_io_flows_zero_count_returns_zero_flows() {
        let r = iron_ingot_recipe();
        let (ins, outs) = recipe_io_flows(&r, 0, 100.0);
        assert_eq!(ins[0].1, 0.0);
        assert_eq!(outs[0].1, 0.0);
    }

    /// Pin to the values from the Phase 1 wiki research. The Miner Mk.3 row,
    /// Pure column = **480 ipm** at 100% clock (the dataset bakes purity into
    /// the recipe value, so it's the 100% number, not the Normal-node base).
    /// At 250% clock that's `480 × 2.5 = 1200 ipm`. A regression here would
    /// mean the throughput formula itself is wrong, not just a single recipe.
    #[test]
    fn miner_mk3_pure_at_250pct_matches_wiki() {
        let mk3_pure_at_100 = 480.0;
        assert_eq!(
            machine_throughput_per_minute(mk3_pure_at_100, 1, 250.0),
            1200.0
        );
    }

    // ---- Amplification (Phase 8) ----

    #[test]
    fn somersloop_factor_doubles_at_full_slots_and_is_unity_when_empty() {
        // 1 of 1 slot filled → factor = 1 + 1 = 2 (output doubles).
        assert!((somersloop_output_factor(1, 1) - 2.0).abs() < 1e-6);
        // 4 of 4 (Manufacturer-style amplifier) → factor = 2.
        assert!((somersloop_output_factor(4, 4) - 2.0).abs() < 1e-6);
        // Half-filled → 1.5×.
        assert!((somersloop_output_factor(2, 4) - 1.5).abs() < 1e-6);
        // Zero-filled → identity.
        assert_eq!(somersloop_output_factor(0, 4), 1.0);
        // Zero-slot machine → identity, regardless of `amp_filled`.
        assert_eq!(somersloop_output_factor(3, 0), 1.0);
        // Over-fill is clamped to total slots → still 2× max.
        assert!((somersloop_output_factor(99, 4) - 2.0).abs() < 1e-6);
    }

    /// Wiki formula: `power = base × (1 + amp_ratio)^2 × (clock/100)^1.321928 × count`.
    /// 100 MW machine, 1× count, 250% clock, amplifier full (ratio = 1):
    /// `(1+1)^2 = 4`, `2.5^1.321928 ≈ 3.358` → `100 × 4 × 3.358 ≈ 1343.1 MW`.
    /// Pinning to the computed value rather than a wiki legend so the
    /// test catches drift in the exponent or the amp factor.
    #[test]
    fn power_amp_compounds_overclock_with_amplifier() {
        let p = machine_power_mw_amp(100.0, 1, 250.0, 1, 1);
        let expected = 100.0 * 4.0 * (2.5_f32).powf(1.321928);
        assert!(
            (p - expected).abs() < 0.01,
            "expected {expected} MW, got {p}"
        );
        // Sanity-check the magnitude: ~1300 MW range, not 2691 / not 800.
        assert!(p > 1300.0 && p < 1400.0);
    }

    #[test]
    fn power_amp_with_zero_slots_collapses_to_overclock_only() {
        // No amplifier slots → amp factor = 1; matches plain overclock curve.
        let amp = machine_power_mw_amp(50.0, 2, 200.0, 0, 0);
        // 50 × 2 × 1 × 2.0^1.321928 ≈ 50 × 2 × 2.5 = 250
        // (2.0^1.321928 = 2.4998)
        let expected = 50.0 * 2.0 * (2.0_f32).powf(1.321928);
        assert!((amp - expected).abs() < 0.01);
    }

    #[test]
    fn power_amp_returns_zero_for_invalid_inputs() {
        assert_eq!(machine_power_mw_amp(0.0, 1, 100.0, 0, 0), 0.0);
        assert_eq!(machine_power_mw_amp(50.0, 0, 100.0, 0, 0), 0.0);
        assert_eq!(machine_power_mw_amp(50.0, 1, 0.0, 0, 0), 0.0);
    }

    #[test]
    fn recipe_io_flows_amp_doubles_both_sides_at_full_slots() {
        let r = iron_ingot_recipe();
        // 1 smelter × 100% × 2× amp = 60 ipm in/out (was 30).
        let (ins, outs) = recipe_io_flows_amp(&r, 1, 100.0, 1, 1);
        assert!((ins[0].1 - 60.0).abs() < 1e-4);
        assert!((outs[0].1 - 60.0).abs() < 1e-4);
    }

    #[test]
    fn recipe_io_flows_amp_zero_slots_matches_unamplified_path() {
        let r = iron_ingot_recipe();
        let (ins_a, outs_a) = recipe_io_flows_amp(&r, 3, 200.0, 0, 0);
        let (ins_b, outs_b) = recipe_io_flows(&r, 3, 200.0);
        assert_eq!(ins_a, ins_b);
        assert_eq!(outs_a, outs_b);
    }
}
