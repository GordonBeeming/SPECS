//! Whole-chain tier reachability.
//!
//! A recipe's own `unlock_tier` says nothing about whether the player
//! can run it: `Alternate: Crystal Computer` is stamped Tier 5, but its
//! Crystal Oscillator input has no chain that grounds out before Tier 6
//! (Tier 7 without alts). Anything that gates on the stamp alone —
//! a product picker, the optimizer's candidate set — will happily plan
//! a factory that cannot be built. The question worth asking is "what's
//! the earliest tier this item's whole chain grounds out at?", and this
//! module answers it for every item at once.
//!
//! A recipe's own ground tier is `max(recipe.unlock_tier,
//! building.unlock_tier)` — an alt shipped with a lower unlock tier
//! than the building it runs in is a real shape in this dataset. An
//! item's tier is the cheapest viable recipe once every input is itself
//! available by that tier; extracted resources ground out at tier 0
//! unconditionally, mirroring how `compute_plan_graph` treats claimed
//! raw supply.
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

use crate::shared::gamedata::types::Recipe;
use crate::shared::gamedata::GameData;

use super::domain::is_inverse_recipe;

/// Whether alt recipes count towards an item's tier. `On` matches the
/// planner's own rule — every alt at or below its unlock tier is
/// plannable, collected or not (see `tier_reachable_alts`) — so it's
/// what production callers want. `Off` answers the narrower "can this
/// be reached with standard recipes only?", which is what a picker
/// wants for grouping so a late-game item doesn't bucket early on the
/// strength of a Hard Drive alt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AltMode {
    Off,
    On,
}

/// item id → earliest tier its chain fully grounds out at. `None` means
/// no chain ever grounds out under this alt mode (alt-only items with
/// alts off, event items whose inputs nothing produces).
pub type TierTable = HashMap<String, Option<u8>>;

/// The earliest tier `recipe` can actually be run at: its own unlock
/// tier, its building's, and every input's chain tier. `None` when an
/// input has no known tier yet — during relaxation that means "not
/// resolved on this pass", and once the table is final it means the
/// recipe is unreachable.
pub fn recipe_chain_tier(game_data: &GameData, table: &TierTable, recipe: &Recipe) -> Option<u8> {
    let building_tier = game_data
        .building(&recipe.building_id)
        .map(|b| b.unlock_tier)
        .unwrap_or(0);
    let mut tier = recipe.unlock_tier.max(building_tier);
    for input in &recipe.inputs {
        tier = tier.max(table.get(&input.item_id).copied().flatten()?);
    }
    Some(tier)
}

/// Solve every item's tier together. See the module doc for why this is
/// a whole-graph relaxation rather than a per-item walk.
pub fn item_tier_table(game_data: &GameData, alts: AltMode) -> TierTable {
    let mut tier: TierTable = game_data
        .items()
        .iter()
        .map(|item| {
            // Extracted resources ground out at tier 0 regardless of
            // any recipe that happens to also emit them (e.g. Water as
            // a byproduct) — matches how `compute_plan_graph` treats
            // claimed raw supply as unconditionally viable.
            let seed = if game_data.is_extracted_resource(&item.id) { Some(0) } else { None };
            (item.id.clone(), seed)
        })
        .collect();

    loop {
        let mut changed = false;
        for item in game_data.items() {
            if game_data.is_extracted_resource(&item.id) {
                continue;
            }
            let mut best = tier.get(&item.id).copied().flatten();
            for recipe in game_data.recipes_producing(&item.id) {
                if is_inverse_recipe(&recipe.id) {
                    continue;
                }
                if recipe.is_alt && alts == AltMode::Off {
                    continue;
                }
                if let Some(candidate) = recipe_chain_tier(game_data, &tier, recipe) {
                    best = Some(best.map_or(candidate, |b: u8| b.min(candidate)));
                }
            }
            if best != tier.get(&item.id).copied().flatten() {
                tier.insert(item.id.clone(), best);
                changed = true;
            }
        }
        if !changed {
            return tier;
        }
    }
}

/// Every recipe whose whole chain is buildable at `tier` — the
/// candidate set a plan at that tier may draw from.
///
/// Alt availability is left to the caller's `unlocked_alts` filter:
/// with the planner's own rule (every alt at or below its unlock tier)
/// this set is exactly the buildable one, and with a narrower set the
/// caller's filter still applies on top, so the gate can only ever
/// remove recipes.
pub fn recipes_reachable_at(
    game_data: &GameData,
    table: &TierTable,
    tier: u8,
) -> HashSet<String> {
    game_data
        .recipes()
        .iter()
        .filter(|r| recipe_chain_tier(game_data, table, r).is_some_and(|t| t <= tier))
        .map(|r| r.id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gd() -> GameData {
        GameData::from_bundled().unwrap()
    }

    fn tier_of(table: &TierTable, item_id: &str) -> Option<u8> {
        table.get(item_id).copied().flatten()
    }

    #[test]
    fn a_recipes_stamp_never_beats_its_inputs() {
        // The case from the playthrough: Alternate: Crystal Computer is
        // stamped Tier 5, but Crystal Oscillator has no chain below
        // Tier 6 (Tier 7 with standard recipes only), so the recipe is
        // a Tier 6 recipe however it's stamped.
        let gd = gd();
        let table = item_tier_table(&gd, AltMode::On);
        let recipe = gd.recipe("Recipe_Alternate_Computer_2_C").expect("crystal computer alt");
        assert_eq!(recipe.unlock_tier, 5, "dataset still stamps this one Tier 5");
        assert_eq!(tier_of(&table, "Desc_CrystalOscillator_C"), Some(6));
        assert_eq!(recipe_chain_tier(&gd, &table, recipe), Some(6));

        let standard_only = item_tier_table(&gd, AltMode::Off);
        assert_eq!(tier_of(&standard_only, "Desc_CrystalOscillator_C"), Some(7));
        assert_eq!(recipe_chain_tier(&gd, &standard_only, recipe), Some(7));
    }

    #[test]
    fn item_tiers_agree_with_hand_checked_items() {
        let gd = gd();
        let on = item_tier_table(&gd, AltMode::On);
        let off = item_tier_table(&gd, AltMode::Off);

        // Iron Plate: Smelter + Constructor, both Tier 0 buildings, no
        // alt required — producible from the very first tier.
        assert_eq!(tier_of(&on, "Desc_IronPlate_C"), Some(0));
        assert_eq!(tier_of(&off, "Desc_IronPlate_C"), Some(0));

        // AI Limiter's standard recipe is Tier 7; the Plastic alt lands
        // the whole chain at Tier 5.
        assert_eq!(tier_of(&off, "Desc_CircuitBoardHighSpeed_C"), Some(7));
        assert_eq!(tier_of(&on, "Desc_CircuitBoardHighSpeed_C"), Some(5));

        // An extracted resource is always available.
        assert_eq!(tier_of(&on, "Desc_OreIron_C"), Some(0));
    }

    #[test]
    fn relaxation_does_not_under_report_cycle_adjacent_items() {
        // Regression coverage for the exact bug a memoized-DFS version
        // of this table had: items whose recipe sits near a recycling
        // loop (Rubber/Plastic, here) got a too-pessimistic — or
        // entirely missing — tier because the DFS cached a result
        // computed while an unrelated ancestor was mid-cycle. These
        // three were confirmed wrong under that approach and are
        // hand-verified correct here.
        let gd = gd();
        let on = item_tier_table(&gd, AltMode::On);
        let off = item_tier_table(&gd, AltMode::Off);
        assert_eq!(
            tier_of(&on, "Desc_SpaceElevatorPart_2_C"),
            Some(3),
            "Smart Plating's standard recipe only needs Modular Frame (T2) + Steel Plate (T3), \
             both grounded well before its own T7 alt"
        );
        assert_eq!(
            tier_of(&off, "Desc_AlienPowerFuel_C"),
            Some(9),
            "producible via its standard T9 recipe even with alts off"
        );
        assert_eq!(
            tier_of(&on, "Desc_SpaceElevatorPart_9_C"),
            Some(8),
            "Nuclear Pasta's standard recipe needs Copper Dust + Pressure Conversion Cube, both T8"
        );
    }

    #[test]
    fn reachable_recipes_grow_with_tier_and_exclude_above_tier_chains() {
        let gd = gd();
        let table = item_tier_table(&gd, AltMode::On);
        let t0 = recipes_reachable_at(&gd, &table, 0);
        let t6 = recipes_reachable_at(&gd, &table, 6);
        let t9 = recipes_reachable_at(&gd, &table, 9);
        assert!(t0.len() < t6.len() && t6.len() < t9.len());
        assert!(t0.is_subset(&t6) && t6.is_subset(&t9));

        // The Supercomputer chain is Tier 7 all the way down — nothing
        // in it may be offered to a Tier 6 plan.
        assert!(!t6.contains("Recipe_ComputerSuper_C"));
        assert!(t9.contains("Recipe_ComputerSuper_C"));
        // ... while the ordinary Computer is a Tier 6 recipe.
        assert!(t6.contains("Recipe_Computer_C"));
    }
}

