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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFactoryInput {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddMachineInput {
    pub factory_id: String,
    pub building_id: String,
    pub recipe_id: String,
    pub count: i64,
    pub clock_pct: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMachineInput {
    pub id: String,
    pub count: i64,
    pub clock_pct: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryDetail {
    pub factory: Factory,
    pub machines: Vec<FactoryMachine>,
    pub ledger: FactoryLedger,
}
