//! Data shapes for bundled Satisfactory game data.
//!
//! These mirror the JSON in `game-data/v*.json`. Field names are
//! `camelCase` on the wire so the React side gets idiomatic JS without an
//! adapter step.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameDataFile {
    /// Schema version of this dataset. Bumped when shapes change.
    pub version: String,
    /// Satisfactory game version this dataset targets, e.g. `"1.1"`.
    pub game_version: String,
    pub items: Vec<Item>,
    pub buildings: Vec<Building>,
    pub recipes: Vec<Recipe>,
    pub milestones: Vec<Milestone>,
    pub belt_tiers: Vec<BeltTier>,
    pub pipe_tiers: Vec<PipeTier>,
    /// Power generators: Coal, Fuel, Nuclear, Biomass, Geothermal.
    /// Optional so older dataset files keep deserialising while Phase
    /// 9 lands.
    #[serde(default)]
    pub generators: Vec<Generator>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Generator {
    pub id: String,
    pub name: String,
    pub category: GeneratorCategory,
    /// Power output at 100% clock with the chosen fuel (MW).
    pub power_mw: f32,
    pub unlock_tier: u8,
    /// Fuels this generator can burn. Each entry sets the fuel's
    /// consumption rate; the supplemental water/coolant rate is
    /// optional (only Coal, Fuel, and Nuclear use it).
    pub fuels: Vec<GeneratorFuel>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GeneratorCategory {
    Burner,
    Fluid,
    Nuclear,
    Geothermal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorFuel {
    pub fuel_item_id: String,
    /// Items per minute consumed at 100% clock.
    pub fuel_per_minute: f32,
    /// Optional supplemental fluid (e.g. water for Coal, water for
    /// Nuclear). Items per minute at 100% clock.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supplemental_item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supplemental_per_minute: Option<f32>,
    /// Output if different from the generator's `power_mw` (used by
    /// nuclear's higher-grade fuels). `None` means use the generator's
    /// default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub power_mw_override: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub category: ItemCategory,
    pub stack_size: u32,
    pub is_fluid: bool,
    /// Hex colour for charts / graph edges. Optional — slices fall back to
    /// the brand palette when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ItemCategory {
    Raw,
    Ingot,
    Part,
    Component,
    Fluid,
    Ammo,
    Equipment,
    Special,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Building {
    pub id: String,
    pub name: String,
    pub category: BuildingCategory,
    pub power_mw: f32,
    pub unlock_tier: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BuildingCategory {
    Extraction,
    Smelting,
    Manufacturing,
    Logistics,
    Power,
    Storage,
    Special,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub name: String,
    /// Building this recipe runs in (must reference a `Building.id`).
    pub building_id: String,
    pub is_alt: bool,
    pub unlock_tier: u8,
    /// Whole-cycle duration in seconds (used to derive items-per-minute under
    /// overclocking / amplification).
    pub cycle_seconds: f32,
    pub inputs: Vec<RecipeIo>,
    pub outputs: Vec<RecipeIo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecipeIo {
    pub item_id: String,
    /// Items per minute at 100% clock, with all amplifier slots empty.
    pub per_minute: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub id: String,
    pub tier: u8,
    pub name: String,
    /// IDs of buildings / recipes / belt tiers / etc this milestone unlocks.
    /// Plain string ids — consumers cross-reference against the right list.
    #[serde(default)]
    pub unlocks: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BeltTier {
    pub mark: u8,
    pub items_per_minute: u32,
    pub unlock_tier: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PipeTier {
    pub mark: u8,
    pub cubic_meters_per_minute: u32,
    pub unlock_tier: u8,
}
