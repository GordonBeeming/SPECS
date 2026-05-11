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

/// Per-playthrough Somersloop / power-shard supply the player chooses
/// to track. Read + written via the inventory_amplifier singleton row
/// (`id = 1` per migration V0005). Zero on both sides means "I don't
/// care, just let me amplify" — the UI then suppresses any low-supply
/// nag.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AmplifierInventory {
    pub somersloop_quantity: i64,
    pub power_shard_quantity: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAmplifierInventoryInput {
    pub somersloop_quantity: i64,
    pub power_shard_quantity: i64,
}
