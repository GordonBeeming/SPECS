use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Factory {
    pub id: String,
    pub name: String,
    pub world_x: f64,
    pub world_y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Player-chosen game-data class id used as the factory's visual
    /// glyph (e.g. `Build_ManufacturerMk1_C`). `None` falls back to the
    /// brand `<Factory>` lucide icon on the React side.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub machine_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryMachine {
    pub id: String,
    pub factory_id: String,
    pub building_id: String,
    pub recipe_id: String,
    pub count: i64,
    /// 1.0 – 250.0 percent. Stored as 100ths-of-percent on disk; the SQL
    /// CHECK constraint enforces the same range so 0% / >250% never persists.
    pub clock_pct: f32,
    /// Phase 8 amplification — both off by default; the player explicitly
    /// opts in per machine. `use_somersloop` gates whether the
    /// `somersloop_slots_filled` count counts toward the amp ratio at all.
    /// `power_shard_count` drives the overclock cap: 0 → 100% max,
    /// 1 → 150%, 2 → 200%, 3 → 250%.
    pub use_somersloop: bool,
    pub somersloop_slots_filled: i64,
    pub power_shard_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ItemFlow {
    pub item_id: String,
    pub item_name: String,
    pub is_fluid: bool,
    /// items per minute produced (sum of outputs across all machines)
    pub produced_per_minute: f32,
    /// items per minute consumed (sum of inputs across all machines)
    pub consumed_per_minute: f32,
    /// produced - consumed. Negative means the factory needs imports;
    /// positive means it has surplus to ship out.
    pub net_per_minute: f32,
    /// ipm available from claimed resource nodes bound to *this*
    /// factory. Surfaces as a "From nodes: X ipm" chip on raw-material
    /// rows so the user can see at a glance whether their staked
    /// supply covers what the recipe needs.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub from_nodes_per_minute: f32,
    /// ipm arriving via incoming logistics links from other factories.
    /// A deficit covered by links is supplied, not missing — the map
    /// popover's raw-demand rollup subtracts this before tracing.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub from_links_per_minute: f32,
}

fn is_zero(v: &f32) -> bool {
    *v == 0.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryLedger {
    pub factory_id: String,
    pub flows: Vec<ItemFlow>,
    /// Aggregate power draw at the configured clocks (MW).
    pub power_mw: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFactoryInput {
    pub name: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFactoryInput {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFactoryIconInput {
    pub id: String,
    /// `None` clears the icon (back to the brand fallback).
    #[serde(default)]
    pub icon_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFactoryPositionInput {
    pub id: String,
    /// In-game world coordinates. The map view writes these straight
    /// from drag events — no rounding here, the SQL column is REAL.
    pub world_x: f64,
    pub world_y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMachineLayoutInput {
    pub machine_id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MachineLayout {
    pub machine_id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMachineInput {
    pub factory_id: String,
    pub building_id: String,
    pub recipe_id: String,
    pub count: i64,
    pub clock_pct: f32,
    /// Defaults to false (off) when the React side omits it — players
    /// must opt into amplification explicitly. Adding via JSON without
    /// these fields keeps existing client code working.
    #[serde(default)]
    pub use_somersloop: bool,
    #[serde(default)]
    pub somersloop_slots_filled: i64,
    #[serde(default)]
    pub power_shard_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMachineInput {
    pub id: String,
    pub count: i64,
    pub clock_pct: f32,
    #[serde(default)]
    pub use_somersloop: bool,
    #[serde(default)]
    pub somersloop_slots_filled: i64,
    #[serde(default)]
    pub power_shard_count: i64,
    /// Optional: swap the machine's recipe (and matching building)
    /// in-place. Backwards-compatible — older callers that omit this
    /// keep the current recipe.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recipe_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub building_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryDetail {
    pub factory: Factory,
    pub machines: Vec<FactoryMachine>,
    pub ledger: FactoryLedger,
}
