use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PowerGen {
    pub id: String,
    pub factory_id: String,
    pub generator_id: String,
    pub fuel_item_id: String,
    pub count: i64,
    /// 1.0 – 250.0 percent. Stored as 100ths-of-percent on disk.
    pub clock_pct: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// In-game world position (Unreal cm). `None` falls back to the
    /// parent factory's location on the map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world_y: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPowerGenPositionInput {
    pub id: String,
    pub world_x: f64,
    pub world_y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePowerGenInput {
    pub factory_id: String,
    pub generator_id: String,
    pub fuel_item_id: String,
    pub count: i64,
    pub clock_pct: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePowerGenInput {
    pub id: String,
    pub count: i64,
    pub clock_pct: f32,
    pub fuel_item_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Per-factory power summary. Combines the factory ledger's machine
/// draw with the sum of its generator output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryPowerBalance {
    pub factory_id: String,
    /// MW produced by all generators on this factory at their current
    /// clocks.
    pub generated_mw: f32,
    /// MW drawn by all machines on this factory at their current
    /// clocks (sourced from `compose_ledger`).
    pub consumed_mw: f32,
    /// `generated - consumed`. Negative = the factory needs imported
    /// power (or off-factory generators); positive = surplus.
    pub net_mw: f32,
    /// Fuel + supplemental flows the generators consume per minute,
    /// keyed by item id. Positive numbers; the React side displays
    /// these as "you need to supply N ipm of X".
    pub fuel_flows: Vec<PowerFuelFlow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PowerFuelFlow {
    pub item_id: String,
    pub item_name: String,
    pub is_fluid: bool,
    pub per_minute: f32,
}
