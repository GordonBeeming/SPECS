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

/// Claimed/total node counts for one purity bucket.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PurityCount {
    pub total: i64,
    pub claimed: i64,
}

/// Per-resource slice of the whole-map budget. All max numbers are
/// stated at the parent `ResourceBudget.assumption_label` — they're
/// meaningless without it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceBudgetRow {
    pub resource_item_id: String,
    pub resource_item_name: String,
    /// Wells/geysers need labelling client-side (water from extractors
    /// is unbounded — only the wells are finite).
    pub kind: NodeKind,
    /// Σ node max over every node of this resource.
    pub world_max_ipm: f32,
    /// Σ actual claimed output (real miner + clock per claim).
    pub claimed_ipm: f32,
    /// Subset of `claimed_ipm` bound to a factory.
    pub bound_ipm: f32,
    /// Σ node max over claimed nodes — minus `claimed_ipm` is the
    /// upgrade headroom sitting on existing claims.
    pub claimed_max_ipm: f32,
    /// Σ node max over UNCLAIMED nodes — the headline number.
    pub remaining_ipm: f32,
    pub pure: PurityCount,
    pub normal: PurityCount,
    pub impure: PurityCount,
    /// Claims exceed the assumption's world max (e.g. Mk3 250% claims
    /// against a Mk1 budget). Rendered red, never blocks anything.
    pub overcommitted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceBudget {
    /// e.g. "Mk2 @ 100%" — shown beside every max/remaining figure.
    pub assumption_label: String,
    pub rows: Vec<ResourceBudgetRow>,
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
