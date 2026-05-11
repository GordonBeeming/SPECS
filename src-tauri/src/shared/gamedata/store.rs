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

    /// True if no recipe in the dataset produces this item.
    /// (Currently only a sanity helper — the planner reaches its
    /// termination condition via `is_extracted_resource` below
    /// because several "natural" items show up as recipe byproducts
    /// elsewhere.)
    #[allow(dead_code)]
    pub fn is_raw_resource(&self, item_id: &str) -> bool {
        self.inner
            .recipes_by_output_item
            .get(item_id)
            .map(|v| v.is_empty())
            .unwrap_or(true)
    }

    /// True for items that the game exclusively sources from
    /// extractors / wells / vents — Iron Ore, Water, Crude Oil, etc.
    /// They may *also* appear as recipe byproducts (Water from
    /// Battery production, Crude Oil from various refines) but the
    /// planner should still constrain on claimed supply: a player
    /// without a Water Extractor can't realistically run a Pure Iron
    /// Ingot chain just because Battery production also drips water
    /// out the side.
    pub fn is_extracted_resource(&self, item_id: &str) -> bool {
        matches!(
            item_id,
            "Desc_OreIron_C"
                | "Desc_OreCopper_C"
                | "Desc_OreGold_C"
                | "Desc_Stone_C"
                | "Desc_Coal_C"
                | "Desc_Sulfur_C"
                | "Desc_OreBauxite_C"
                | "Desc_RawQuartz_C"
                | "Desc_OreUranium_C"
                | "Desc_SAM_C"
                | "Desc_LiquidOil_C"
                | "Desc_Water_C"
                | "Desc_NitrogenGas_C"
                | "Desc_Geyser_C"
        )
    }
}

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
}
