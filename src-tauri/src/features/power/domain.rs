//! Pure power math. Generator output and fuel consumption both scale
//! linearly with `count × (clock/100)`. Generators don't get the
//! Somersloop / power-shard amplification curve from the factory
//! slice; that's a machine-side property.

use crate::shared::gamedata::types::{Generator, GeneratorFuel};

/// MW produced by `count` copies of `generator` burning `fuel` at the
/// given clock. Returns 0 for any non-positive input.
///
/// `power = effective_power × count × (clock/100)`
/// where `effective_power` is the fuel's `power_mw_override` if set
/// (some nuclear fuels output more than the default), otherwise the
/// generator's `power_mw`.
pub fn generator_power_mw(
    generator: &Generator,
    fuel: &GeneratorFuel,
    count: i64,
    clock_pct: f32,
) -> f32 {
    if count <= 0 || clock_pct <= 0.0 {
        return 0.0;
    }
    let base = fuel.power_mw_override.unwrap_or(generator.power_mw);
    if base <= 0.0 {
        return 0.0;
    }
    base * (count as f32) * (clock_pct / 100.0)
}

/// Fuel and supplemental items per minute consumed by `count` copies
/// of the generator/fuel combo at the given clock. The main fuel side
/// is always returned (every fuel has a primary item id); rate is 0
/// when `count` or `clock_pct` is non-positive. The supplemental side
/// is `None` when the fuel doesn't declare one OR when the declared
/// rate is 0; an explicit-but-zero supplemental is filtered to keep
/// downstream code from showing "0 ipm of water" rows.
pub fn generator_fuel_flows(
    fuel: &GeneratorFuel,
    count: i64,
    clock_pct: f32,
) -> ((String, f32), Option<(String, f32)>) {
    let mult = if count <= 0 || clock_pct <= 0.0 {
        0.0
    } else {
        (count as f32) * (clock_pct / 100.0)
    };
    let fuel_pair = (fuel.fuel_item_id.clone(), fuel.fuel_per_minute * mult);
    let supplemental = match (&fuel.supplemental_item_id, fuel.supplemental_per_minute) {
        // Drop zero-rate supplementals — happens both when the fuel
        // declares 0 (rare) and when count/clock collapse `mult` to 0
        // (so the UI doesn't render "0 ipm water" rows next to a
        // disabled generator bank).
        (Some(id), Some(rate)) if rate > 0.0 && mult > 0.0 => {
            Some((id.clone(), rate * mult))
        }
        _ => None,
    };
    (fuel_pair, supplemental)
}

/// Items per minute the generator/fuel combo *emits* — the other half of
/// [`generator_fuel_flows`], which only covers what goes in. Nuclear is
/// the one family that emits anything: a Uranium Fuel Rod leaves Uranium
/// Waste behind, a Plutonium one leaves Plutonium Waste, and burning a
/// rod is the game's only source of either. `None` for a fuel that burns
/// clean, and for a bank that's switched off — the same `count`/`clock`
/// collapse the supplemental side uses, so a disabled bank doesn't
/// advertise waste it isn't making.
pub fn generator_byproduct_flow(
    fuel: &GeneratorFuel,
    count: i64,
    clock_pct: f32,
) -> Option<(String, f32)> {
    if count <= 0 || clock_pct <= 0.0 {
        return None;
    }
    match (&fuel.byproduct_item_id, fuel.byproduct_per_minute) {
        (Some(id), Some(rate)) if rate > 0.0 => {
            Some((id.clone(), rate * (count as f32) * (clock_pct / 100.0)))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::gamedata::types::GeneratorCategory;

    fn coal_gen() -> Generator {
        Generator {
            id: "Build_GeneratorCoal_C".into(),
            name: "Coal".into(),
            category: GeneratorCategory::Burner,
            power_mw: 75.0,
            unlock_tier: 3,
            fuels: vec![],
        }
    }

    fn coal_fuel() -> GeneratorFuel {
        GeneratorFuel {
            fuel_item_id: "Desc_Coal_C".into(),
            fuel_per_minute: 15.0,
            supplemental_item_id: Some("Desc_Water_C".into()),
            supplemental_per_minute: Some(45.0),
            power_mw_override: None,
            byproduct_item_id: None,
            byproduct_per_minute: None,
        }
    }

    fn uranium_fuel() -> GeneratorFuel {
        GeneratorFuel {
            fuel_item_id: "Desc_NuclearFuelRod_C".into(),
            fuel_per_minute: 0.2,
            supplemental_item_id: Some("Desc_Water_C".into()),
            supplemental_per_minute: Some(240.0),
            power_mw_override: None,
            byproduct_item_id: Some("Desc_NuclearWaste_C".into()),
            byproduct_per_minute: Some(10.0),
        }
    }

    #[test]
    fn generator_power_at_100pct_one_unit_is_base() {
        let p = generator_power_mw(&coal_gen(), &coal_fuel(), 1, 100.0);
        assert_eq!(p, 75.0);
    }

    #[test]
    fn generator_power_scales_count_and_clock() {
        // 4 generators at 50% = 4 × 75 × 0.5 = 150 MW.
        let p = generator_power_mw(&coal_gen(), &coal_fuel(), 4, 50.0);
        assert_eq!(p, 150.0);
    }

    #[test]
    fn generator_power_uses_override_when_set() {
        let mut fuel = coal_fuel();
        fuel.power_mw_override = Some(125.0);
        let p = generator_power_mw(&coal_gen(), &fuel, 1, 100.0);
        assert_eq!(p, 125.0);
    }

    #[test]
    fn generator_power_returns_zero_for_invalid_inputs() {
        assert_eq!(generator_power_mw(&coal_gen(), &coal_fuel(), 0, 100.0), 0.0);
        assert_eq!(generator_power_mw(&coal_gen(), &coal_fuel(), 1, 0.0), 0.0);
        assert_eq!(generator_power_mw(&coal_gen(), &coal_fuel(), -1, 100.0), 0.0);
    }

    #[test]
    fn fuel_flows_return_main_and_supplemental_at_full_rate() {
        let (main, supp) = generator_fuel_flows(&coal_fuel(), 1, 100.0);
        assert_eq!(main, ("Desc_Coal_C".to_string(), 15.0));
        assert_eq!(supp, Some(("Desc_Water_C".to_string(), 45.0)));
    }

    #[test]
    fn fuel_flows_scale_with_count_and_clock() {
        // 2 coal gens at 50% → halve fuel and water per generator:
        // main = 15 × 2 × 0.5 = 15; supp = 45 × 2 × 0.5 = 45.
        let (main, supp) = generator_fuel_flows(&coal_fuel(), 2, 50.0);
        assert_eq!(main, ("Desc_Coal_C".to_string(), 15.0));
        assert_eq!(supp, Some(("Desc_Water_C".to_string(), 45.0)));
    }

    #[test]
    fn fuel_flows_omit_supplemental_when_fuel_has_none() {
        let mut fuel = coal_fuel();
        fuel.supplemental_item_id = None;
        fuel.supplemental_per_minute = None;
        let (main, supp) = generator_fuel_flows(&fuel, 1, 100.0);
        assert_eq!(main.1, 15.0);
        assert!(supp.is_none());
    }

    #[test]
    fn fuel_flows_zero_main_and_no_supplemental_for_invalid_count_or_clock() {
        // Main side is always returned (the function contract); rate
        // collapses to 0. Supplemental drops to None so the UI doesn't
        // render a "0 ipm water" row next to a disabled generator.
        let (main, supp) = generator_fuel_flows(&coal_fuel(), 0, 100.0);
        assert_eq!(main.1, 0.0);
        assert!(supp.is_none(), "supplemental should be None when mult is 0");
    }

    #[test]
    fn byproduct_flow_scales_with_count_and_clock() {
        // 4 plants at 50% = 10 × 4 × 0.5 = 20 ipm of Uranium Waste.
        let flow = generator_byproduct_flow(&uranium_fuel(), 4, 50.0);
        assert_eq!(flow, Some(("Desc_NuclearWaste_C".to_string(), 20.0)));
    }

    #[test]
    fn byproduct_flow_is_none_for_a_clean_fuel_or_a_disabled_bank() {
        assert!(generator_byproduct_flow(&coal_fuel(), 1, 100.0).is_none());
        assert!(generator_byproduct_flow(&uranium_fuel(), 0, 100.0).is_none());
        assert!(generator_byproduct_flow(&uranium_fuel(), 1, 0.0).is_none());
    }
}
