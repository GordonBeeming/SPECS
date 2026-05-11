use serde::{Deserialize, Serialize};

use crate::shared::gamedata::types::{NodeKind, NodePurity};

/// One row in the Resources view. Combines the static catalog entry with
/// the per-playthrough claim state so the React side renders without
/// having to cross-reference two lists.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceNodeRow {
    pub id: String,
    pub resource_item_id: String,
    pub resource_item_name: String,
    pub purity: NodePurity,
    pub kind: NodeKind,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub core_id: Option<String>,
    /// `None` if unclaimed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claim: Option<ResourceNodeClaim>,
    /// Items per minute at the current claim's miner + clock + purity.
    /// `0.0` when unclaimed, when extractor is unset, or for geysers
    /// (which feed the power slice, not item flow).
    pub items_per_minute: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceNodeClaim {
    /// Building id of the extractor placed on this node. `None` for
    /// "claimed but not yet built".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub miner_id: Option<String>,
    /// 1..250 percent. Stored as 100ths-of-percent on disk; the wire
    /// format is decimal for symmetry with the rest of the app.
    pub clock_pct: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub factory_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNodeClaimInput {
    pub node_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub miner_id: Option<String>,
    pub clock_pct: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub factory_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}
