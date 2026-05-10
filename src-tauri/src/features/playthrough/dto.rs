use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlaythroughSummary {
    pub id: String,
    pub display_name: String,
    pub created_at: String,
    pub last_opened_at: Option<String>,
    pub schema_version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlaythroughDetail {
    pub id: String,
    pub display_name: String,
    pub game_version: String,
    pub created_at: String,
    pub current_tier: i64,
    pub current_milestone_progress: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlaythroughInput {
    pub display_name: String,
    /// Starting milestone tier (0–9). Defaults to 0 when omitted on the wire.
    #[serde(default)]
    pub starting_tier: u8,
}
