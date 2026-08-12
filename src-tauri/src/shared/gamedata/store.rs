//! Indexed, immutable view of the bundled game data.
//!
//! Wraps the parsed [`GameDataFile`] with id-keyed lookups and cheap clones
//! (the underlying data is `Arc`'d). Slices borrow this from Tauri state.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;

use super::loader::{load_bundled, load_bundled_nodes};
use super::types::*;

#[derive(Clone)]
pub struct GameData {
    inner: Arc<Inner>,
}

// Lookup tables are populated for use by future slices (Phase 4+ — factory
// machine config, logistics planner, etc.). Suppressed warning until then.
#[allow(dead_code)]
struct Inner {
    file: GameDataFile,
    items_by_id: HashMap<String, usize>,
    buildings_by_id: HashMap<String, usize>,
    recipes_by_id: HashMap<String, usize>,
    milestones_by_id: HashMap<String, usize>,
    /// Index from output item id → indices into `file.recipes` that
    /// produce that item. Populated for the planner BFS so it can
    /// enumerate candidate recipes per stage without re-scanning the
    /// full recipe list each step.
    recipes_by_output_item: HashMap<String, Vec<usize>>,
    nodes: Vec<MapNode>,
    nodes_by_id: HashMap<String, usize>,
}

impl GameData {
    /// Load + index the bundled dataset.
    pub fn from_bundled() -> Result<Self> {
        Self::from_parts(load_bundled()?, load_bundled_nodes()?)
    }

    #[allow(dead_code)]
    pub fn from_file(file: GameDataFile) -> Result<Self> {
        Self::from_parts(file, Vec::new())
    }

    pub fn from_parts(file: GameDataFile, nodes: Vec<MapNode>) -> Result<Self> {
        let items_by_id = file
            .items
            .iter()
            .enumerate()
            .map(|(i, it)| (it.id.clone(), i))
            .collect();
        let buildings_by_id = file
            .buildings
            .iter()
            .enumerate()
            .map(|(i, b)| (b.id.clone(), i))
            .collect();
        let recipes_by_id = file
            .recipes
            .iter()
            .enumerate()
            .map(|(i, r)| (r.id.clone(), i))
            .collect();
        let milestones_by_id = file
            .milestones
            .iter()
            .enumerate()
            .map(|(i, m)| (m.id.clone(), i))
            .collect();
        let mut recipes_by_output_item: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, r) in file.recipes.iter().enumerate() {
            for out in &r.outputs {
                recipes_by_output_item
                    .entry(out.item_id.clone())
                    .or_default()
                    .push(i);
            }
        }
        let nodes_by_id = nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.clone(), i))
            .collect();
        Ok(Self {
            inner: Arc::new(Inner {
                file,
                items_by_id,
                buildings_by_id,
                recipes_by_id,
                milestones_by_id,
                recipes_by_output_item,
                nodes,
                nodes_by_id,
            }),
        })
    }

    pub fn version(&self) -> &str {
        &self.inner.file.version
    }

    pub fn game_version(&self) -> &str {
        &self.inner.file.game_version
    }

    pub fn items(&self) -> &[Item] {
        &self.inner.file.items
    }

    pub fn buildings(&self) -> &[Building] {
        &self.inner.file.buildings
    }

    pub fn recipes(&self) -> &[Recipe] {
        &self.inner.file.recipes
    }

    pub fn milestones(&self) -> &[Milestone] {
        &self.inner.file.milestones
    }

    pub fn space_elevator_phases(&self) -> &[SpaceElevatorPhase] {
        &self.inner.file.space_elevator_phases
    }

    pub fn belt_tiers(&self) -> &[BeltTier] {
        &self.inner.file.belt_tiers
    }

    pub fn pipe_tiers(&self) -> &[PipeTier] {
        &self.inner.file.pipe_tiers
    }

    pub fn generators(&self) -> &[Generator] {
        &self.inner.file.generators
    }

    pub fn generator(&self, id: &str) -> Option<&Generator> {
        self.inner.file.generators.iter().find(|g| g.id == id)
    }

    // Reserved for the miner-placement UI; the dataset row exists so
    // the slice can land additively when the resource-node slice ships.
    #[allow(dead_code)]
    pub fn miners(&self) -> &[Miner] {
        &self.inner.file.miners
    }

    pub fn transport_vehicles(&self) -> &[TransportVehicle] {
        &self.inner.file.transport_vehicles
    }

    // Lookup helpers — wired up for use by Phase 4+ slices (factory editor,
    // logistics planner). Quiet the dead-code warning until those land.

    #[allow(dead_code)]
    pub fn item(&self, id: &str) -> Option<&Item> {
        self.inner.items_by_id.get(id).map(|i| &self.inner.file.items[*i])
    }

    #[allow(dead_code)]
    pub fn building(&self, id: &str) -> Option<&Building> {
        self.inner
            .buildings_by_id
            .get(id)
            .map(|i| &self.inner.file.buildings[*i])
    }

    #[allow(dead_code)]
    pub fn recipe(&self, id: &str) -> Option<&Recipe> {
        self.inner
            .recipes_by_id
            .get(id)
            .map(|i| &self.inner.file.recipes[*i])
    }

    #[allow(dead_code)]
    pub fn milestone(&self, id: &str) -> Option<&Milestone> {
        self.inner
            .milestones_by_id
            .get(id)
            .map(|i| &self.inner.file.milestones[*i])
    }

    pub fn nodes(&self) -> &[MapNode] {
        &self.inner.nodes
    }

    pub fn node(&self, id: &str) -> Option<&MapNode> {
        self.inner
            .nodes_by_id
            .get(id)
            .map(|i| &self.inner.nodes[*i])
    }

    /// Recipes whose `outputs[].item_id` includes `item_id`. The planner
    /// uses this to enumerate candidate recipes per stage without a
    /// linear scan of the full recipe list. Returns an empty slice for
    /// raw resources (no recipe produces Iron Ore directly).
    pub fn recipes_producing(&self, item_id: &str) -> Vec<&Recipe> {
        match self.inner.recipes_by_output_item.get(item_id) {
            Some(idxs) => idxs.iter().map(|i| &self.inner.file.recipes[*i]).collect(),
            None => Vec::new(),
        }
    }

    /// True for items that the game exclusively sources from
    /// extractors / wells / vents — Iron Ore, Water, Crude Oil, etc.
    ///
    /// **This, not "no recipe produces it", is where a chain walk
    /// terminates.** The two questions look interchangeable and give
    /// different answers for exactly the resources that matter: Water
    /// and Crude Oil are both recipe byproducts, so a producer check
    /// says they're manufacturable and lets a plan walk straight past
    /// the extractor that has to supply them.
    ///
    /// They may *also* appear as recipe byproducts (Water from
    /// Battery production, Crude Oil from various refines) but the
    /// planner should still constrain on claimed supply: a player
    /// without a Water Extractor can't realistically run a Pure Iron
    /// Ingot chain just because Battery production also drips water
    /// out the side.
    ///
    /// The converse also holds, and it's the reason nuclear waste isn't
    /// on this list: a *generator* byproduct has no node to claim, so
    /// listing it here would have every plutonium plan advise claiming
    /// more nodes for an item that has none anywhere on the map.
    /// Generator byproducts are recipes instead — burning a rod in a
    /// Nuclear Power Plant produces waste the same way any machine
    /// produces its output — which grounds the chain out through the
    /// rod, and through uranium ore, which genuinely is extracted.
    pub fn is_extracted_resource(&self, item_id: &str) -> bool {
        EXTRACTED_RESOURCES.iter().any(|(id, _)| *id == item_id)
    }

    /// The same set as a list, for the frontend. `library_extracted_resources`
    /// ships it over IPC so the TypeScript raw-demand trace terminates on
    /// exactly the ids the planner terminates on.
    pub fn extracted_resources(&self) -> Vec<&'static str> {
        EXTRACTED_RESOURCES.iter().map(|(id, _)| *id).collect()
    }

    /// How `item_id` reaches the player without being manufactured.
    ///
    /// "Extracted" and "available from the start" are two different
    /// claims, and only the first is true of every raw resource: Crude
    /// Oil needs an Oil Extractor and Nitrogen Gas a resource well, so
    /// treating the whole raw list as Tier 0 invites a player to plan a
    /// factory around something five tiers out of reach.
    pub fn raw_supply(&self, item_id: &str) -> RawSupply {
        let Some((_, extractor)) = EXTRACTED_RESOURCES.iter().find(|(id, _)| *id == item_id) else {
            return RawSupply::Manufactured;
        };
        let Some(building_id) = extractor else {
            return RawSupply::WorkedInPlace;
        };
        match self.building(building_id) {
            Some(b) => RawSupply::Extracted { unlock_tier: b.unlock_tier },
            // `validate_id_tables` fails the load before this can
            // happen for the bundled data; a hand-built `GameData` in a
            // test can still get here, and answering "tier 0" would be
            // a confident wrong number.
            None => RawSupply::ExtractorMissing,
        }
    }

    /// The tier that first puts `item_id` on a belt or in a pipe, or
    /// `None` when nothing does. Convenience over [`Self::raw_supply`]
    /// for callers that only need the number; anything that has to tell
    /// "no extractor" from "a broken table" should match on the enum.
    pub fn extraction_tier(&self, item_id: &str) -> Option<u8> {
        match self.raw_supply(item_id) {
            RawSupply::Extracted { unlock_tier } => Some(unlock_tier),
            _ => None,
        }
    }

    /// True for the things the player walks up to and picks up — no
    /// building extracts them and no recipe makes them, so they're
    /// available from the first minute and can never be automated.
    ///
    /// Hand-fed power is the whole reason the Biomass Burner exists,
    /// so these have to be *obtainable* at Tier 0 without also being
    /// plannable factory inputs. See `planner::tier::Sourcing` for the
    /// two answers that split on.
    pub fn is_hand_gathered(&self, item_id: &str) -> bool {
        HAND_GATHERED_ITEM_IDS.contains(&item_id)
    }
}

/// Why an item needs no recipe. Three situations that all used to come
/// back as a bare `None`, which is how "a geyser is never on a belt"
/// and "this table names a building the dataset doesn't have" ended up
/// indistinguishable from "this is an ordinary manufactured part".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawSupply {
    /// Not a raw resource — a recipe is the only way to get it.
    Manufactured,
    /// An extractor puts it on a belt or in a pipe from `unlock_tier`.
    Extracted { unlock_tier: u8 },
    /// Claimable as a node but never carried anywhere: a geyser feeds
    /// the Geothermal Generator standing on it. `is_extracted_resource`
    /// is still true — the resource-node slice claims one — while the
    /// tier model treats it as reaching no chain, and both are right.
    WorkedInPlace,
    /// The table names an extractor this dataset has no building for.
    /// Broken data rather than an answer about the game.
    ExtractorMissing,
}

/// Backing list for `GameData::is_extracted_resource` and
/// `raw_supply`: resource id → the building that works it, or
/// `None` when nothing extracts it onto a belt. See
/// `is_extracted_resource` for what earns an id a place here and why
/// generator byproducts don't.
///
/// The extractor's *tier* deliberately isn't written here — it's read
/// off the building in the dataset, so a dataset that moves the Oil
/// Extractor moves Crude Oil with it. `validate` fails the load if any
/// of these ids stops resolving.
pub(super) const EXTRACTED_RESOURCES: &[(&str, Option<&str>)] = &[
    ("Desc_OreIron_C", Some("Build_MinerMk1_C")),
    ("Desc_OreCopper_C", Some("Build_MinerMk1_C")),
    ("Desc_OreGold_C", Some("Build_MinerMk1_C")),
    ("Desc_Stone_C", Some("Build_MinerMk1_C")),
    ("Desc_Coal_C", Some("Build_MinerMk1_C")),
    ("Desc_Sulfur_C", Some("Build_MinerMk1_C")),
    ("Desc_OreBauxite_C", Some("Build_MinerMk1_C")),
    ("Desc_RawQuartz_C", Some("Build_MinerMk1_C")),
    ("Desc_OreUranium_C", Some("Build_MinerMk1_C")),
    ("Desc_SAM_C", Some("Build_MinerMk1_C")),
    ("Desc_LiquidOil_C", Some("Build_OilPump_C")),
    // Lakes take a free-placed Water Extractor; the Tier 8 resource
    // well is the more expensive route to the same fluid, so the
    // Extractor's tier is the one that matters.
    ("Desc_Water_C", Some("Build_WaterPump_C")),
    // The Pressuriser is the powered building, but the satellite
    // Extractor is what stands on the well and puts gas in the pipe —
    // and it's the id `allowed_extractors` offers and a claim stores.
    // Both are Tier 8 today, so naming the wrong one is a number that
    // happens to be right.
    ("Desc_NitrogenGas_C", Some("Build_FrackingExtractor_C")),
    // A geyser feeds a Geothermal Generator in place. There is no
    // extractor, and no factory can be planned around one.
    ("Desc_Geyser_C", None),
];

/// Backing list for `GameData::is_hand_gathered`.
///
/// FICSMAS presents are deliberately absent: they only drop during the
/// seasonal event, so a playthrough can't count on them the way it can
/// count on a tree.
pub(super) const HAND_GATHERED_ITEM_IDS: &[&str] = &[
    "Desc_Wood_C",
    "Desc_Leaves_C",
    "Desc_Mycelia_C",
    "Desc_HogParts_C",
    "Desc_SpitterParts_C",
    "Desc_StingerParts_C",
    "Desc_HatcherParts_C",
    "Desc_Crystal_C",
    "Desc_Crystal_mk2_C",
    "Desc_Crystal_mk3_C",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn fx() -> GameData {
        GameData::from_bundled().expect("bundled")
    }

    #[test]
    fn lookup_by_id_returns_inserted_records() {
        let gd = fx();
        let first_item = &gd.items()[0];
        assert_eq!(gd.item(&first_item.id).map(|i| &i.id), Some(&first_item.id));
        assert!(gd.item("not-a-real-id").is_none());
    }

    #[test]
    fn version_fields_present() {
        let gd = fx();
        assert!(!gd.version().is_empty());
        assert!(!gd.game_version().is_empty());
    }

    /// Whether *some* chain of recipes reduces `item_id` to extracted
    /// resources. Mirrors what the planner needs to terminate: any one
    /// producing recipe whose every input grounds out is enough, so an
    /// alternate that leans on a hand-foraged item (Leaves, alien parts,
    /// a Power Shard) doesn't condemn the item. An item already on the
    /// stack counts as not-yet-grounded, which keeps a recipe cycle from
    /// vouching for itself.
    fn grounds_out(gd: &GameData, item_id: &str, on_stack: &mut Vec<String>) -> bool {
        if gd.is_extracted_resource(item_id) {
            return true;
        }
        if on_stack.iter().any(|i| i == item_id) {
            return false;
        }
        on_stack.push(item_id.to_string());
        let reachable = gd
            .recipes_producing(item_id)
            .iter()
            .any(|r| r.inputs.iter().all(|i| grounds_out(gd, &i.item_id, on_stack)));
        on_stack.pop();
        reachable
    }

    #[test]
    fn the_plutonium_branch_grounds_out() {
        // Every one of these used to dead-end at Uranium Waste, which no
        // recipe produced because the plant that emits it carried no
        // outputs. The planner correctly refused all of them, which took
        // Ficsonium, Singularity Cells and several Space Elevator parts
        // down with the branch.
        let gd = fx();
        for item_id in [
            "Desc_NuclearWaste_C",
            "Desc_PlutoniumWaste_C",
            "Desc_PlutoniumPellet_C",
            "Desc_PlutoniumCell_C",
            "Desc_PlutoniumFuelRod_C",
            "Desc_NonFissibleUranium_C",
            "Desc_Ficsonium_C",
        ] {
            assert!(
                grounds_out(&gd, item_id, &mut Vec::new()),
                "{item_id} has no chain down to extracted resources"
            );
        }
    }

    #[test]
    fn a_resources_tier_is_the_tier_of_the_extractor_that_reaches_it() {
        let gd = fx();
        // Miner Mk1 is a Tier 0 building, so every solid ore is
        // available from the start — including the ones a player won't
        // find until later.
        assert_eq!(gd.extraction_tier("Desc_OreIron_C"), Some(0));
        assert_eq!(gd.extraction_tier("Desc_OreBauxite_C"), Some(0));
        // These three are the reason this method exists: all raw, none
        // of them reachable at Tier 0.
        assert_eq!(gd.extraction_tier("Desc_Water_C"), Some(3));
        assert_eq!(gd.extraction_tier("Desc_LiquidOil_C"), Some(5));
        assert_eq!(gd.extraction_tier("Desc_NitrogenGas_C"), Some(8));
        // A geyser is burnt where it sits.
        assert_eq!(gd.extraction_tier("Desc_Geyser_C"), None);
        // Not a raw resource at all.
        assert_eq!(gd.extraction_tier("Desc_IronPlate_C"), None);
    }

    #[test]
    fn raw_supply_tells_the_three_no_recipe_cases_apart() {
        let gd = fx();
        assert_eq!(
            gd.raw_supply("Desc_Water_C"),
            RawSupply::Extracted { unlock_tier: 3 }
        );
        // Claimable as a node, never on a belt — and both halves of
        // that hold at once, which a bare `None` couldn't say.
        assert_eq!(gd.raw_supply("Desc_Geyser_C"), RawSupply::WorkedInPlace);
        assert!(gd.is_extracted_resource("Desc_Geyser_C"));
        assert_eq!(gd.extraction_tier("Desc_Geyser_C"), None);

        assert_eq!(gd.raw_supply("Desc_IronPlate_C"), RawSupply::Manufactured);
        assert_eq!(gd.raw_supply("Desc_Wood_C"), RawSupply::Manufactured, "gathered, not extracted");
    }

    #[test]
    fn every_raw_category_item_is_extracted_or_hand_gathered() {
        // The two views of "raw" have to agree: the JSON category says
        // a factory doesn't make it, and the Rust tables say where it
        // comes from instead. Biomass sat in the category with four
        // Constructor recipes behind it and neither table claiming it.
        //
        // Deliberately not "no recipe produces it" — a Converter makes
        // Bauxite out of other ores and Water drips out of Battery
        // production, and both are still things you get from a node.
        let gd = fx();
        for item in gd.items() {
            if item.category != ItemCategory::Raw {
                continue;
            }
            assert!(
                gd.is_extracted_resource(&item.id) || gd.is_hand_gathered(&item.id),
                "{} is filed raw but neither table says where it comes from",
                item.id
            );
        }
    }

    #[test]
    fn hand_gathered_pickups_are_neither_extracted_nor_crafted() {
        // Every id in the constant, not a sample of it. The tier model
        // seeds these at tier 0 on the strength of "no machine makes
        // this", so one that quietly gained a producing recipe would
        // hand a whole chain a tier it hasn't earned — and a spot check
        // of the first three would never see it.
        let gd = fx();
        for item_id in HAND_GATHERED_ITEM_IDS {
            assert!(gd.is_hand_gathered(item_id), "{item_id} is a world pickup");
            assert!(!gd.is_extracted_resource(item_id), "{item_id} has no extractor");
            assert!(
                gd.recipes_producing(item_id).is_empty(),
                "{item_id} has a producing recipe, so it isn't only hand-gathered"
            );
            assert!(gd.item(item_id).is_some(), "{item_id} is in the dataset");
        }
        assert!(!gd.is_hand_gathered("Desc_OreIron_C"));
        assert!(!gd.is_hand_gathered("Desc_GenericBiomass_C"), "Biomass is crafted");
    }

    #[test]
    fn the_hand_gathered_list_is_exactly_these_ten() {
        // Pinned as a set, because membership here does two unrelated
        // jobs: it seeds the tier model at tier 0, and it decides
        // whether a fuel's missing supply is reportable. An id added
        // here by mistake would silently suppress a real shortfall
        // warning somewhere else entirely, and no other test would
        // notice.
        assert_eq!(
            HAND_GATHERED_ITEM_IDS,
            [
                // Chopped, cut and picked.
                "Desc_Wood_C",
                "Desc_Leaves_C",
                "Desc_Mycelia_C",
                // Dropped by creatures.
                "Desc_HogParts_C",
                "Desc_SpitterParts_C",
                "Desc_StingerParts_C",
                "Desc_HatcherParts_C",
                // Found in caves and on cliffs.
                "Desc_Crystal_C",
                "Desc_Crystal_mk2_C",
                "Desc_Crystal_mk3_C",
            ]
        );
    }

    #[test]
    fn nuclear_waste_is_not_an_extracted_resource() {
        // It has no node anywhere on the map, so treating it as claimable
        // supply would answer every plutonium plan with "claim more
        // nodes" — advice the player cannot act on. It reaches the
        // planner as a generator byproduct recipe instead.
        let gd = fx();
        assert!(!gd.is_extracted_resource("Desc_NuclearWaste_C"));
        assert!(!gd.is_extracted_resource("Desc_PlutoniumWaste_C"));
        assert!(
            !gd.recipes_producing("Desc_NuclearWaste_C").is_empty(),
            "waste has to reach the planner some other way"
        );
    }
}
