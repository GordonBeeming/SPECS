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

/// Errors a derive_chain call can return. Distinct variants so the UI
/// can route each to a different surface (insufficient supply → claim
/// more nodes; no recipe → out of dataset; cycle → bug report).
///
/// `rename_all = "camelCase"` on an enum only renames variant names —
/// fields inside variant bodies need `rename_all_fields` to flow the
/// convention through. Without it, `item_id` shipped to the React
/// side as `item_id` and the error banner rendered with an empty id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum PlannerError {
    /// Target item id isn't in the dataset.
    UnknownTarget { item_id: String },
    /// No recipe in the dataset produces this item (e.g. a raw
    /// resource — the user should claim nodes, not build a chain).
    NoRecipeForTarget { item_id: String },
    /// Recipe graph has a cycle we couldn't break — should never
    /// happen in vanilla Satisfactory but we surface it loudly if it
    /// does so a dataset typo doesn't infinite-loop the planner.
    CycleDetected { item_id: String },
}

// ---- Production plan (graph-first designer) ----

/// "Make `ipm`/min of `item_id` in this factory." `export_ipm` is the
/// slice offered to other factories; the rest stays local.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanTargetSpec {
    pub item_id: String,
    pub ipm: f32,
    #[serde(default)]
    pub export_ipm: Option<f32>,
}

/// "Item `item_id` arrives from elsewhere — cut the graph here."
/// `source_factory_id: None` is the unsourced state: the cut still
/// happens, the demand lands in `PlanNode::Import.unassigned_ipm`, and
/// a `PlanWarning::ImportUnsourced` flags it. Planning the endgame
/// backwards depends on this being a valid, saveable state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanImportSpec {
    pub item_id: String,
    #[serde(default)]
    pub source_factory_id: Option<String>,
    /// Max ipm the source can spare. `None` ≈ unbounded.
    #[serde(default)]
    pub ipm_cap: Option<f32>,
}

/// What one sourced import spec contributed to an item's demand.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportAllocation {
    pub source_factory_id: String,
    pub resolved_ipm: f32,
}

/// One node of the computed production graph. `node_key` is item-based
/// (`recipe:Desc_IronPlate_C`, `raw:…`, `import:…`, `byproduct:…`) so a
/// recipe swap keeps the node's saved layout position and its
/// materialized machine identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum PlanNode {
    /// A production step: a bank of machines running one recipe.
    Recipe {
        node_key: String,
        item_id: String,
        item_name: String,
        recipe_id: String,
        recipe_name: String,
        building_id: String,
        building_name: String,
        machine_count: i64,
        clock_pct: f32,
        power_mw: f32,
        /// ipm of `item_id` this step produces (sized to demand).
        output_ipm: f32,
        is_alt: bool,
        /// True when `item_id` is one of the plan's targets.
        is_target: bool,
        /// The target's requested rate; differs from `output_ipm` when
        /// other steps in this factory also consume the item.
        target_ipm: Option<f32>,
        /// Pre-scaled input flows of the bank (machine_count × clock).
        inputs: Vec<RecipeFlow>,
        /// Full output set at the sized rate (includes byproducts).
        outputs: Vec<RecipeFlow>,
    },
    /// Raw resource demand at a leaf (mined/pumped, not crafted).
    Raw {
        node_key: String,
        item_id: String,
        item_name: String,
        ipm: f32,
        /// What the playthrough's claimed nodes currently supply.
        claimed_supply_ipm: f32,
    },
    /// An input cut — supplied by other factories (or nobody yet).
    Import {
        node_key: String,
        item_id: String,
        item_name: String,
        /// Total demand for the item across the graph.
        ipm: f32,
        allocations: Vec<ImportAllocation>,
        /// Demand no source covers — unsourced specs and cap gaps.
        unassigned_ipm: f32,
    },
    /// Surplus output nobody in this plan consumes.
    Byproduct {
        node_key: String,
        item_id: String,
        item_name: String,
        surplus_ipm: f32,
        /// Fluids can't be sunk — a fluid surplus stalls the line.
        #[serde(default)]
        is_fluid: bool,
    },
}

impl PlanNode {
    pub fn node_key(&self) -> &str {
        match self {
            PlanNode::Recipe { node_key, .. }
            | PlanNode::Raw { node_key, .. }
            | PlanNode::Import { node_key, .. }
            | PlanNode::Byproduct { node_key, .. } => node_key,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanEdge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub item_id: String,
    pub item_name: String,
    pub ipm: f32,
}

/// Non-blocking findings. The plan always computes and always saves;
/// these render as an amber banner, never as an error.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum PlanWarning {
    /// Raw demand exceeds what claimed nodes supply.
    RawShort {
        item_id: String,
        item_name: String,
        demand_ipm: f32,
        claimed_ipm: f32,
    },
    /// An import has demand with no source factory assigned.
    ImportUnsourced {
        item_id: String,
        item_name: String,
        ipm: f32,
    },
    /// Every source for the item is assigned but the caps fall short.
    ImportShort {
        item_id: String,
        item_name: String,
        gap_ipm: f32,
    },
    /// A liquid byproduct nobody consumes — solids can go to the sink,
    /// a stranded fluid stalls the whole line in game.
    FluidSurplus {
        item_id: String,
        item_name: String,
        ipm: f32,
    },
    /// The optimizer failed or ran out of budget; the graph shown is
    /// the greedy standard-recipe chain instead.
    OptimizerFellBack { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanGraph {
    pub nodes: Vec<PlanNode>,
    pub edges: Vec<PlanEdge>,
    pub total_machines: i64,
    pub total_power_mw: f32,
    /// Raw demand at the leaves, per item.
    pub raw_demand: HashMap<String, f32>,
    pub warnings: Vec<PlanWarning>,
    /// True when a target can only be made with SAM, so the per-plan
    /// "Include SAM" toggle was forced on (UI renders it disabled).
    #[serde(default)]
    pub sam_forced: bool,
}

/// Per-compute knobs the designer sends along with the plan inputs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanComputeOptions {
    /// Allow recipes whose chain needs SAM. Per-plan (persisted with
    /// the factory's plan); defaults off.
    #[serde(default)]
    pub include_sam: bool,
    /// Global guard for the optimizer; on overrun the greedy chain is
    /// shown instead (warn, don't block).
    #[serde(default = "default_solver_budget_ms")]
    pub solver_budget_ms: u64,
}

fn default_solver_budget_ms() -> u64 {
    2000
}

impl Default for PlanComputeOptions {
    fn default() -> Self {
        Self { include_sam: false, solver_budget_ms: default_solver_budget_ms() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanLayoutEntry {
    pub node_key: String,
    pub x: f64,
    pub y: f64,
}

/// A saved import row — `PlanImportSpec` plus its row id so the map's
/// drag-to-source gesture can address a specific unsourced input.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanImportRowDto {
    pub id: String,
    pub item_id: String,
    pub source_factory_id: Option<String>,
    pub ipm_cap: Option<f32>,
}

/// The persisted plan inputs for one factory, as loaded by
/// `factory_plan_get`. The designer recomputes the graph from these.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryPlan {
    pub factory_id: String,
    pub targets: Vec<PlanTargetSpec>,
    /// Per-plan SAM toggle, persisted in `factory_plan_option`.
    #[serde(default)]
    pub include_sam: bool,
    /// item id → recipe id the user chose for that item.
    pub recipe_overrides: HashMap<String, String>,
    pub imports: Vec<PlanImportRowDto>,
    pub layout: Vec<PlanLayoutEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputePlanInput {
    /// Needed to recognise self-source rows ("build it here") in the
    /// import list.
    pub factory_id: String,
    pub targets: Vec<PlanTargetSpec>,
    #[serde(default)]
    pub imports: Vec<PlanImportSpec>,
    #[serde(default)]
    pub recipe_overrides: HashMap<String, String>,
    #[serde(default)]
    pub options: PlanComputeOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ComputePlanResult {
    Ok { graph: PlanGraph },
    Err { error: PlannerError },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlanInput {
    pub factory_id: String,
    pub targets: Vec<PlanTargetSpec>,
    #[serde(default)]
    pub imports: Vec<PlanImportSpec>,
    #[serde(default)]
    pub recipe_overrides: HashMap<String, String>,
    #[serde(default)]
    pub options: PlanComputeOptions,
    /// Distance baked into materialized logistics links. The React
    /// side defaults this to 1000 m; the picker refines it later.
    #[serde(default = "default_link_distance")]
    pub default_link_distance_m: i64,
}

fn default_link_distance() -> i64 {
    1000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlanResult {
    pub graph: PlanGraph,
    /// Plan-managed machines created by this save, in node order.
    pub machine_ids: Vec<String>,
    /// Logistics links materialized for sourced imports.
    pub link_ids: Vec<String>,
}

/// One product a factory offers for export, with how much of the
/// offer other factories already draw via logistics links.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportOfferProduct {
    pub item_id: String,
    pub item_name: String,
    pub export_ipm: f32,
    pub drawn_ipm: f32,
    /// `export - drawn`, floored at 0 — 0 still means "exportable,
    /// bump production there first".
    pub remaining_ipm: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportOffer {
    pub factory_id: String,
    pub factory_name: String,
    pub products: Vec<ExportOfferProduct>,
}

/// One input across the playthrough still waiting on a source factory
/// — the map shows these as pin badges and drag-to-source handles.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnsourcedInput {
    pub import_id: String,
    pub factory_id: String,
    pub item_id: String,
    pub item_name: String,
    pub ipm_cap: Option<f32>,
}
