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

/// Per-machine power draw at the given clock. Phase 4 uses the simple
/// linear model (`base_power_mw × clock_fraction × count`). Phase 8 will
/// replace this with the wiki's exponent-1.321928 curve when overclocking
/// + Somersloop are wired together.
pub fn machine_power_mw(base_power_mw: f32, count: i64, clock_pct: f32) -> f32 {
    if base_power_mw <= 0.0 || count <= 0 || clock_pct <= 0.0 {
        return 0.0;
    }
    base_power_mw * (count as f32) * (clock_pct / 100.0)
}

/// Sum a recipe's per-machine inputs/outputs into per-item flow tallies.
/// Returns `(item_id, ipm)` pairs for each side.
///
/// Multiplied through by `machine_multiplier(count, clock_pct)`.
pub fn recipe_io_flows(
    recipe: &Recipe,
    count: i64,
    clock_pct: f32,
) -> (Vec<(String, f32)>, Vec<(String, f32)>) {
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
}
