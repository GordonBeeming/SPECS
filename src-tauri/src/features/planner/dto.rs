use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChainStage {
    pub recipe_id: String,
    pub recipe_name: String,
    pub building_id: String,
    pub building_name: String,
    /// `Desc_*_C` id of the item this stage's count-and-clock were sized
    /// against. Almost always the recipe's first output; surfaced so the
    /// UI can highlight it specifically.
    pub output_item_id: String,
    /// Items per minute of `output_item_id` this stage must produce to
    /// satisfy downstream demand.
    pub output_ipm: f32,
    /// Number of machines at the configured clock to hit `output_ipm`.
    pub machine_count: i64,
    /// Clock percent (1..250) chosen to land the target ipm exactly.
    pub clock_pct: f32,
    /// Inputs the stage will draw from upstream factories, pre-scaled
    /// to `machine_count × clock_pct`.
    pub inputs: Vec<RecipeFlow>,
    /// Full output set of the recipe at the sized rate (includes
    /// byproducts).
    pub outputs: Vec<RecipeFlow>,
    pub is_alt: bool,
    /// Aggregate MW draw of this stage at the configured clocks.
    pub power_mw: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecipeFlow {
    pub item_id: String,
    pub item_name: String,
    pub per_minute: f32,
}

/// User-declared input to the planner: "for item X, treat factory Y (or
/// node Z) as the source and stop the upstream recursion here".
///
/// `Factory` cuts the chain at the named item and binds a real
/// logistics link from `id → target_factory` on apply.
///
/// `Node` is parsed for forward-compatibility but treated as plain raw
/// supply for now — the apply step does not yet rebind
/// `resource_node_claim.factory_id_nullable`. The variant exists so the
/// React side can already emit it without a future schema change to
/// the IPC payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum InputSourceKind {
    Factory { id: String },
    Node { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InputSource {
    /// Item the source supplies (`Desc_*_C`).
    pub item_id: String,
    pub source: InputSourceKind,
    /// Maximum items-per-minute the source can supply. `None` ≈
    /// unbounded — useful when the user hasn't measured spare capacity.
    pub ipm_cap: Option<f32>,
}

/// What the planner actually consumed from a user-declared
/// `InputSource`. Emitted only for `Factory` sources because they're
/// the ones that become logistics links on apply.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedImport {
    pub item_id: String,
    pub item_name: String,
    pub source_factory_id: String,
    pub resolved_ipm: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChainPlan {
    pub target_item_id: String,
    pub target_item_name: String,
    pub target_ipm: f32,
    pub stages: Vec<ChainStage>,
    pub total_machines: i64,
    pub total_power_mw: f32,
    /// Final raw-resource demand at the leaves of the chain. The
    /// `available_supply` snapshot is compared against this when
    /// deciding whether the planner returns a viable `ChainPlan` or
    /// a `PlannerError::Insufficient`.
    pub raw_demand: HashMap<String, f32>,
    /// `Factory`-kind input sources the planner consumed. One entry per
    /// (item, source factory) pair, ipm summed across the chain. The
    /// in-factory apply path turns each into a logistics link.
    #[serde(default)]
    pub imports: Vec<ResolvedImport>,
}

/// Errors a derive_chain call can return. Distinct variants so the UI
/// can route each to a different surface (insufficient supply → claim
/// more nodes; no recipe → out of dataset; cycle → bug report).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PlannerError {
    /// Target item id isn't in the dataset.
    UnknownTarget { item_id: String },
    /// No recipe in the dataset produces this item (e.g. a raw
    /// resource — the user should claim nodes, not build a chain).
    NoRecipeForTarget { item_id: String },
    /// At least one input down the chain has no path back to a
    /// supplied raw resource — and/or pinned input sources couldn't
    /// cover the demand. `missing` is the raw-supply gap per item;
    /// `imports` is the gap per item that the user *did* pin a source
    /// for but whose combined caps fell short. Both populated together
    /// when both conditions hit.
    Insufficient {
        missing: HashMap<String, f32>,
        #[serde(default)]
        imports: HashMap<String, f32>,
    },
    /// Recipe graph has a cycle we couldn't break — should never
    /// happen in vanilla Satisfactory but we surface it loudly if it
    /// does so a dataset typo doesn't infinite-loop the planner.
    CycleDetected { item_id: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeriveChainInput {
    pub target_item_id: String,
    pub target_ipm: f32,
    /// When true, build the plan even if raw supply doesn't cover
    /// the chain's demand. The UI surfaces this as 'Place anyway' so
    /// the player can put pins on the map immediately and bind nodes
    /// in afterwards instead of being blocked until they've claimed
    /// every required raw.
    #[serde(default)]
    pub bypass_supply: bool,
    /// User-pinned input sources. Empty by default — when populated,
    /// the planner cuts the upstream tree at each matching item and
    /// (for `Factory` sources) emits a `ResolvedImport`.
    #[serde(default)]
    pub sources: Vec<InputSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum DeriveChainResult {
    Ok { plan: ChainPlan },
    Err { error: PlannerError },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyChainPlanInput {
    pub plan: ChainPlan,
    /// Used as the factory name prefix: factories land as
    /// "<prefix> — <recipe name>". Trimmed; defaults to the target
    /// item's name when empty.
    pub naming_prefix: String,
    /// Distance in metres baked into the auto-generated logistics
    /// links between consecutive stages. Defaults to 1000 m on the
    /// React side.
    pub default_link_distance_m: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyChainPlanResult {
    /// Factory ids created, in stage order.
    pub factory_ids: Vec<String>,
    /// Logistics link ids created.
    pub link_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyChainToFactoryInput {
    /// Target factory the new machines land in. Must already exist in
    /// the playthrough.
    pub factory_id: String,
    pub plan: ChainPlan,
    /// Distance in metres baked into the auto-generated logistics
    /// links from `ResolvedImport.source_factory_id → factory_id`.
    pub default_link_distance_m: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyChainToFactoryResult {
    /// Machine ids created inside `factory_id`, in stage order.
    pub machine_ids: Vec<String>,
    /// Logistics link ids created — one per `ChainPlan.imports` entry.
    pub link_ids: Vec<String>,
}
