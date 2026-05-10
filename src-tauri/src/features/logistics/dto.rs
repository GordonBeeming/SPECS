use serde::{Deserialize, Serialize};

/// Persisted link between two factories carrying a single item flow.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogisticsLink {
    pub id: String,
    pub from_factory_id: String,
    pub to_factory_id: String,
    pub item_id: String,
    /// items per minute the player wants to move A → B
    pub items_per_minute: f32,
    /// 'belt' | 'pipe' | 'truck' | 'tractor' | 'train' | 'drone'
    pub transport_kind: String,
    /// JSON shape varies per transport_kind (e.g. `{"belts":[{"mark":6,"count":2}]}`).
    /// Schema-validated by the slice on write so the React side can trust it.
    pub transport_plan_json: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance_m: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
