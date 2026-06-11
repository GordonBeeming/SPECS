use serde::{Deserialize, Serialize};

use crate::shared::gamedata::types::{NodeKind, NodePurity};

/// One extractor building a node can legally take, with the data the
/// pickers need to render and gate it. Produced by
/// `domain::allowed_extractors` — the same function `set_node_claim`
/// validates against, so UI options and server rules can't drift.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractorOption {
    pub id: String,
    pub name: String,
    /// Output at 100% clock on a Normal-purity node.
    pub base_ipm: f32,
    pub unlock_tier: u8,
}

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
    /// The extractor buildings this node accepts — drives every picker.
    /// Empty for geysers.
    pub allowed_extractors: Vec<ExtractorOption>,
    /// The claim's stored extractor isn't in `allowed_extractors` (e.g.
    /// a Miner Mk2 saved on an oil node before oil got its own extractor
    /// family). The rate above is already computed with the correct
    /// extractor; this flag lets the UI warn so the user resaves.
    pub claim_invalid_extractor: bool,
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

/// One map marker for a bank (or two) of free-placed water
/// extractors. `outputIpm` is computed server-side so every consumer
/// shows the same number.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WaterExtractorGroup {
    pub id: String,
    pub world_x: f64,
    pub world_y: f64,
    pub count: i64,
    pub clock_pct: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count2: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock2_pct: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub factory_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Locked groups bind-on-drag instead of moving (node-like).
    pub locked: bool,
    pub output_ipm: f32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetWaterExtractorGroupInput {
    /// Omit to create (server allocates the uuid); provide to update.
    #[serde(default)]
    pub id: Option<String>,
    pub world_x: f64,
    pub world_y: f64,
    pub count: i64,
    pub clock_pct: f32,
    #[serde(default)]
    pub count2: Option<i64>,
    #[serde(default)]
    pub clock2_pct: Option<f32>,
    #[serde(default)]
    pub factory_id: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub locked: bool,
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
