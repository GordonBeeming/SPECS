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

/// Clock-adjusted multiplier for a row of machines (count × clock fraction).
/// Useful when iterating over a recipe's inputs/outputs without re-doing
/// the count math each time.
pub fn machine_multiplier(count: i64, clock_pct: f32) -> f32 {
    if count <= 0 || clock_pct <= 0.0 {
        return 0.0;
    }
    (count as f32) * (clock_pct / 100.0)
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

/// IO flows for a bank of machines: both sides of `recipe` multiplied
/// by `count × clock × amp`, where `amp = (1 + amp_ratio)`. The amp
/// factor is symmetric — both inputs and outputs scale by the same
/// number because filling slots consumes the recipe faster (more inputs
/// in) and produces more (more outputs out).
///
/// Pass `0, 0` for an unamplified bank. There is deliberately no
/// separate unamplified variant: one existed, took the same inputs
/// minus the slot pair, and silently dropped Somersloop amplification
/// for anyone who reached for the shorter name.
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
    fn multiplier_scales_with_count_and_clock_and_floors_invalid_rows() {
        assert_eq!(machine_multiplier(1, 100.0), 1.0);
        assert_eq!(machine_multiplier(4, 100.0), 4.0);
        // 3 machines × 200% = 6× the recipe's 100%-clock rate.
        assert_eq!(machine_multiplier(3, 200.0), 6.0);
        // Non-positive rows floor to zero. The SQL CHECK constraint
        // forbids them, but pure math must not depend on storage
        // invariants to avoid emitting a negative flow.
        assert_eq!(machine_multiplier(0, 100.0), 0.0);
        assert_eq!(machine_multiplier(-1, 100.0), 0.0);
        assert_eq!(machine_multiplier(1, 0.0), 0.0);
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
    fn recipe_io_flows_amp_zero_slots_is_plain_count_times_clock() {
        let r = iron_ingot_recipe();
        // 3 smelters × 200% = 6× multiplier, no amp factor: 30 ipm each
        // side becomes 180.
        let (ins, outs) = recipe_io_flows_amp(&r, 3, 200.0, 0, 0);
        assert_eq!(ins, vec![("Desc_IronOre_C".to_string(), 180.0)]);
        assert_eq!(outs, vec![("Desc_IronIngot_C".to_string(), 180.0)]);
    }

    #[test]
    fn recipe_io_flows_amp_zero_count_returns_zero_flows() {
        let r = iron_ingot_recipe();
        let (ins, outs) = recipe_io_flows_amp(&r, 0, 100.0, 0, 0);
        assert_eq!(ins[0].1, 0.0);
        assert_eq!(outs[0].1, 0.0);
    }
}
