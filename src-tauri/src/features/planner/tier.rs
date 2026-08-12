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
//! available by that tier; a raw resource grounds out at the tier of
//! the extractor that reaches it, mirroring how `compute_plan_graph`
//! treats claimed raw supply.
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
//! (raw resources start at their extractor's tier), each pass tries to
//! improve every item from whatever its inputs currently know, and it
//! repeats until a full pass changes nothing.

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

/// What counts as a supply the chain may terminate on.
///
/// The two answers differ for exactly the items a player picks up off
/// the ground. A Biomass Burner is *meant* to be hand-fed Wood at
/// Tier 0, so a fuel picker has to see Wood as available. A factory
/// planner must not: no belt ever carries Wood, so a plan that leans
/// on it is a plan that can't be built. Same graph, different
/// question, so it's a parameter rather than a compromise in the
/// middle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Sourcing {
    /// Extractor output only — what a machine can be fed from a belt
    /// or a pipe.
    Automated,
    /// Extractor output plus what the player carries in by hand.
    HandGathered,
}

/// item id → earliest tier its chain fully grounds out at. `None` means
/// no chain ever grounds out under this alt mode and sourcing (alt-only
/// items with alts off, hand-gathered chains under `Automated`, event
/// items whose inputs nothing produces).
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

/// The tier an item arrives at without being manufactured, or `None`
/// when it has to be: raw resources come in at their extractor's tier,
/// hand-gathered pickups at tier 0 and only when they're allowed to
/// count at all.
///
/// A seeded item is *pinned* at this tier by `item_tier_table` — no
/// recipe can talk it lower. That's deliberate for the same reason
/// `compute_plan_graph` charges raw supply against claimed nodes: Water
/// falls out of Battery production as a byproduct, and a player with no
/// Water Extractor still can't run a chain that needs water.
fn supply_tier(game_data: &GameData, item_id: &str, sourcing: Sourcing) -> Option<u8> {
    if let Some(tier) = game_data.extraction_tier(item_id) {
        return Some(tier);
    }
    match sourcing {
        Sourcing::HandGathered if game_data.is_hand_gathered(item_id) => Some(0),
        _ => None,
    }
}

/// Solve every item's tier together. See the module doc for why this is
/// a whole-graph relaxation rather than a per-item walk.
pub fn item_tier_table(game_data: &GameData, alts: AltMode, sourcing: Sourcing) -> TierTable {
    let mut tier: TierTable = game_data
        .items()
        .iter()
        .map(|item| (item.id.clone(), supply_tier(game_data, &item.id, sourcing)))
        .collect();

    loop {
        let mut changed = false;
        for item in game_data.items() {
            if supply_tier(game_data, &item.id, sourcing).is_some() {
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

/// Items no arrangement of extractors and machines can ever supply:
/// every route to them grounds out in something the player carries in
/// by hand. Wood and Leaves, but also the Biomass, Solid Biofuel and
/// Liquid Biofuel made from them, however many machines are in
/// between.
///
/// **This is not an exemption from anything on its own.** Liquid
/// Biofuel is in here and a Fuel Generator drinking 270/min of it with
/// 60/min piped in is a real, closable shortfall — the player built
/// that Refinery line and it's short. What the set answers is narrower:
/// "if this factory reports no supply at all, could it ever have
/// any?". `check_generator_supply` pairs it with a zero-supply check
/// for exactly that reason, and treating membership alone as "don't
/// warn" is how every biofuel plant in the game lost its shortfall
/// warning once already.
pub fn items_with_no_automated_supply(game_data: &GameData) -> HashSet<String> {
    let automated = item_tier_table(game_data, AltMode::On, Sourcing::Automated);
    game_data
        .items()
        .iter()
        .filter(|item| automated.get(&item.id).copied().flatten().is_none())
        .map(|item| item.id.clone())
        .collect()
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

    fn automated(gd: &GameData, alts: AltMode) -> TierTable {
        item_tier_table(gd, alts, Sourcing::Automated)
    }

    #[test]
    fn a_recipes_stamp_never_beats_its_inputs() {
        // The case from the playthrough: Alternate: Crystal Computer is
        // stamped Tier 5, but Crystal Oscillator has no chain below
        // Tier 6 (Tier 7 with standard recipes only), so the recipe is
        // a Tier 6 recipe however it's stamped.
        let gd = gd();
        let table = automated(&gd, AltMode::On);
        let recipe = gd.recipe("Recipe_Alternate_Computer_2_C").expect("crystal computer alt");
        assert_eq!(recipe.unlock_tier, 5, "dataset still stamps this one Tier 5");
        assert_eq!(tier_of(&table, "Desc_CrystalOscillator_C"), Some(6));
        assert_eq!(recipe_chain_tier(&gd, &table, recipe), Some(6));

        let standard_only = automated(&gd, AltMode::Off);
        assert_eq!(tier_of(&standard_only, "Desc_CrystalOscillator_C"), Some(7));
        assert_eq!(recipe_chain_tier(&gd, &standard_only, recipe), Some(7));
    }

    #[test]
    fn item_tiers_agree_with_hand_checked_items() {
        let gd = gd();
        let on = automated(&gd, AltMode::On);
        let off = automated(&gd, AltMode::Off);

        // Iron Plate: Smelter + Constructor, both Tier 0 buildings, no
        // alt required — producible from the very first tier.
        assert_eq!(tier_of(&on, "Desc_IronPlate_C"), Some(0));
        assert_eq!(tier_of(&off, "Desc_IronPlate_C"), Some(0));

        // AI Limiter's standard recipe is Tier 7; the Plastic alt lands
        // the whole chain at Tier 5.
        assert_eq!(tier_of(&off, "Desc_CircuitBoardHighSpeed_C"), Some(7));
        assert_eq!(tier_of(&on, "Desc_CircuitBoardHighSpeed_C"), Some(5));

        // A Miner Mk1 is a Tier 0 building, so ore is available from
        // the first minute.
        assert_eq!(tier_of(&on, "Desc_OreIron_C"), Some(0));
    }

    #[test]
    fn a_raw_resource_lands_on_its_extractors_tier_not_tier_zero() {
        let gd = gd();
        let on = automated(&gd, AltMode::On);
        // Water is a Battery byproduct and Crude Oil falls out of
        // several refines, so a "does any recipe make this" reading
        // puts both of them well below the building that actually
        // reaches them. The extractor is what decides.
        assert_eq!(tier_of(&on, "Desc_Water_C"), Some(3), "Water Extractor");
        assert_eq!(tier_of(&on, "Desc_LiquidOil_C"), Some(5), "Oil Extractor");
        assert_eq!(tier_of(&on, "Desc_NitrogenGas_C"), Some(8), "Resource Well Pressuriser");

        // Rocket Fuel moves 7 → 8 as a consequence: its chain drinks
        // Nitrogen Gas, and nothing reaches that before the Resource
        // Well Pressuriser.
        assert_eq!(tier_of(&on, "Desc_RocketFuel_C"), Some(8));

        // ... and the chain gate moves with it: nothing that drinks
        // water is offered to a plan below Tier 3.
        let t2 = recipes_reachable_at(&gd, &on, 2);
        for recipe in gd.recipes() {
            if recipe.inputs.iter().any(|i| i.item_id == "Desc_Water_C") {
                assert!(
                    !t2.contains(&recipe.id),
                    "{} needs water, which Tier 2 has no way to get",
                    recipe.id
                );
            }
        }
    }

    #[test]
    fn hand_gathered_fuels_reach_tier_zero_only_when_hand_gathering_counts() {
        // The Biomass Burner's five fuels. Nothing extracts Wood,
        // Leaves or Mycelia and no recipe makes them, so under
        // `Automated` the whole burner chain is unreachable at every
        // tier — which is the correct answer for a factory planner and
        // the wrong one for a fuel picker.
        let gd = gd();
        let automated_tiers = automated(&gd, AltMode::On);
        let hand = item_tier_table(&gd, AltMode::On, Sourcing::HandGathered);

        for item_id in ["Desc_Wood_C", "Desc_Leaves_C", "Desc_Mycelia_C"] {
            assert_eq!(tier_of(&automated_tiers, item_id), None);
            assert_eq!(tier_of(&hand, item_id), Some(0));
        }
        // Biomass and Solid Biofuel cascade from them: Biomass (Wood)
        // and Biomass (Leaves) are Tier 0 recipes, Solid Biofuel a
        // Tier 2 one.
        assert_eq!(tier_of(&automated_tiers, "Desc_GenericBiomass_C"), None);
        assert_eq!(tier_of(&hand, "Desc_GenericBiomass_C"), Some(0));
        assert_eq!(tier_of(&automated_tiers, "Desc_Biofuel_C"), None);
        assert_eq!(tier_of(&hand, "Desc_Biofuel_C"), Some(2));

        // Hand gathering only ever adds: an automated route keeps its
        // tier, and nothing it grounds out moves.
        assert_eq!(tier_of(&hand, "Desc_IronPlate_C"), Some(0));
        assert_eq!(tier_of(&hand, "Desc_Water_C"), Some(3));
        for item in gd.items() {
            let (Some(a), Some(h)) = (tier_of(&automated_tiers, &item.id), tier_of(&hand, &item.id))
            else {
                continue;
            };
            assert!(h <= a, "{} got later with more supply available", item.id);
        }
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
        let on = automated(&gd, AltMode::On);
        let off = automated(&gd, AltMode::Off);
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
    fn items_with_no_automated_supply_is_bounded_and_holds_the_whole_biofuel_chain() {
        let gd = gd();
        let stranded = items_with_no_automated_supply(&gd);

        // The size is pinned on purpose. A set derived from the whole
        // recipe graph is exactly the shape that grows quietly under a
        // dataset bump, and a membership-only test let a set three
        // times this size through once already. If this number moves,
        // read the diff before changing it.
        assert_eq!(
            stranded.len(),
            33,
            "hand-rooted chains, the FICSMAS tree, and nothing else: {:?}",
            {
                let mut v: Vec<_> = stranded.iter().collect();
                v.sort();
                v
            }
        );

        // Every generator fuel that can reach `check_generator_supply`
        // from in here, named so the list is a decision rather than a
        // count.
        for item_id in [
            "Desc_Wood_C",
            "Desc_Leaves_C",
            "Desc_Mycelia_C",
            "Desc_GenericBiomass_C",
            "Desc_Biofuel_C",
            "Desc_LiquidBiofuel_C",
        ] {
            assert!(stranded.contains(item_id), "{item_id} grounds out in a pickup");
        }
        // ... and everything a node or a machine can really supply.
        for item_id in [
            "Desc_Coal_C",
            "Desc_Water_C",
            "Desc_LiquidFuel_C",
            "Desc_LiquidTurboFuel_C",
            "Desc_NuclearFuelRod_C",
            "Desc_IronPlate_C",
        ] {
            assert!(!stranded.contains(item_id), "{item_id} has an automated route");
        }
    }

    #[test]
    fn a_chain_that_touches_a_pickup_is_not_itself_hand_gathered() {
        // "No automated tier" is a much wider net than "picked up off
        // the ground": it catches every chain that *passes through* a
        // pickup. Liquid Biofuel is the one that matters — a Refinery
        // product that moves by pipe and fuels a Fuel Generator, which
        // no player hand-feeds. Anything treating the first set as the
        // second silently exempts it from supply checks.
        let gd = gd();
        let automated = automated(&gd, AltMode::On);
        assert_eq!(
            tier_of(&automated, "Desc_LiquidBiofuel_C"),
            None,
            "its chain grounds out in Wood, so it has no automated tier"
        );
        assert!(
            !gd.is_hand_gathered("Desc_LiquidBiofuel_C"),
            "...but nobody carries Liquid Biofuel to a generator by hand"
        );
        for item_id in ["Desc_GenericBiomass_C", "Desc_Biofuel_C", "Desc_PackagedBiofuel_C"] {
            assert_eq!(tier_of(&automated, item_id), None, "{item_id} has no automated tier");
            assert!(!gd.is_hand_gathered(item_id), "{item_id} comes out of a machine");
        }
    }

    #[test]
    fn reachable_recipes_grow_with_tier_and_exclude_above_tier_chains() {
        let gd = gd();
        let table = automated(&gd, AltMode::On);
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

