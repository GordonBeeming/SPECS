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
        /// What's left of `output_ipm` after this factory's own steps
        /// have taken their share — the number an export is worth
        /// declaring. Same derivation as `ExportOfferProduct.spare_ipm`
        /// (see `domain::spare_ipm`), with "drawn" meaning the machines
        /// next to it rather than the factories downstream of it.
        /// Prefilling an export from gross `output_ipm` instead declares
        /// a rate the factory can't honour and Validate reports it as an
        /// overdraw on the far side.
        #[serde(default)]
        free_output_ipm: f32,
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
    /// A byproduct being fed back into the chain (item isn't the
    /// producing node's primary output). Rendered distinctly — piping
    /// these wrong is how lines stall.
    #[serde(default)]
    pub is_reuse: bool,
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
    /// Steps in this plan need a tier the playthrough hasn't reached —
    /// their whole input chain, not just the recipe's own stamp. Kept
    /// as one aggregated warning: an above-tier product drags its chain
    /// with it, and a line per step would bury every other warning.
    AboveTier {
        current_tier: u8,
        /// The highest tier any above-tier step needs — "get to here
        /// and this plan is buildable".
        required_tier: u8,
        /// Item faces of the above-tier steps, sorted and deduped.
        item_names: Vec<String>,
    },
    /// A target has no way to be produced — a raw resource, an id the
    /// current dataset no longer knows, or a chain whose leaves never
    /// bottom out in something buildable. Excluded from this compute
    /// (warn, don't block) instead of failing the whole graph: the
    /// factory must always stay openable so the user can fix or remove
    /// the offending target, even right after a dataset update orphans
    /// it.
    TargetUnplannable {
        item_id: String,
        item_name: String,
        reason: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanGraph {
    pub nodes: Vec<PlanNode>,
    pub edges: Vec<PlanEdge>,
    pub total_machines: i64,
    /// Machines plus the factory's bound extractors — the extractors
    /// aren't graph nodes, so `total_machines` alone can't account for
    /// this figure. `extractor_count`/`extractor_power_mw` carry their
    /// share so a header can show both sides counting the same set.
    pub total_power_mw: f32,
    /// Extractors claimed for this factory (miners, oil/water pumps,
    /// well satellites), folded into `total_power_mw`.
    #[serde(default)]
    pub extractor_count: i64,
    /// The extractors' share of `total_power_mw`.
    #[serde(default)]
    pub extractor_power_mw: f32,
    /// Raw demand at the leaves, per item.
    pub raw_demand: HashMap<String, f32>,
    pub warnings: Vec<PlanWarning>,
    /// True when a target can only be made with SAM, so the per-plan
    /// "Include SAM" toggle was forced on (UI renders it disabled).
    #[serde(default)]
    pub sam_forced: bool,
    /// Alt recipes this solve leans on that the playthrough hasn't
    /// collected yet, by display name, sorted.
    ///
    /// The planner deliberately plans with any alt the current tier
    /// reaches, collected or not (see `tier_reachable_alts`) — which
    /// means a plan can rest entirely on hard drives nobody has scanned
    /// and look completely buildable. "Unlocked at T5" and "I have it"
    /// are different questions and only the first one was being asked.
    /// Validate answers the second after the fact; this carries it while
    /// the recipes are still being chosen.
    #[serde(default)]
    pub uncollected_alts: Vec<String>,
    /// Items this plan builds locally that another factory already makes
    /// with capacity to spare. The Sources panel can answer this per
    /// item once you go and ask it; carried on the graph so the designer
    /// can offer it at the moment the local copy appears instead.
    #[serde(default)]
    pub existing_producers: Vec<ExistingProducer>,
}

/// One item a plan is about to build locally that somebody else already
/// makes, with who and how much they have going spare.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExistingProducer {
    /// The local step this is an alternative to.
    pub node_key: String,
    pub item_id: String,
    pub item_name: String,
    /// What this plan builds locally, for the "…instead of N/min here"
    /// half of the sentence.
    pub local_ipm: f32,
    /// Sorted by spare capacity, most first.
    pub sources: Vec<ExistingProducerSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExistingProducerSource {
    pub factory_id: String,
    pub factory_name: String,
    /// `ExportOfferProduct.spare_ipm` — what widening the export slice
    /// alone would free up, no extra machines at the source.
    pub spare_ipm: f32,
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

/// One product a factory makes for others to take, with how much of it
/// is promised (`export_ipm`) and how much is already spoken for
/// (`drawn_ipm`).
///
/// A factory that produces an item and has never declared an export
/// slice still belongs here. Leaving it out makes a plant with 60/min
/// entirely spare read as "not exporting this, plan it there later", so
/// the panel answers "who can feed me?" with "nobody" while the answer
/// sits one click away.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportOfferProduct {
    pub item_id: String,
    pub item_name: String,
    /// The target's own rate — what's left after this factory's other
    /// steps have taken their share, so it's the ceiling on what any
    /// export slice could ever offer.
    pub produced_ipm: f32,
    pub export_ipm: f32,
    pub drawn_ipm: f32,
    /// `export - drawn`, floored at 0 — 0 still means "exportable,
    /// bump production there first".
    pub remaining_ipm: f32,
    /// `produced - drawn`, floored at 0: what widening the export slice
    /// alone would free up, with no extra machines and no cost to the
    /// exporter's own plan. Always ≥ `remaining_ipm`.
    pub spare_ipm: f32,
    /// True when the exporter has a plan target for this item; false
    /// when it only makes it as an intermediate.
    ///
    /// This is the "can `raise_export_target` be called at all?" flag.
    /// That command refuses without a target — deliberately, because
    /// giving another factory a new product target changes what that
    /// factory is — so a UI that offers a raise on an intermediate is
    /// offering a button whose only outcome is an error.
    ///
    /// The rates can't answer this. A zero `produced_ipm` happens to
    /// imply an intermediate today (a target's rate is never zero), but
    /// an intermediate with *partial* surplus is indistinguishable from
    /// a small target by its numbers alone, and that's precisely the
    /// case a rate-based guess gets wrong.
    #[serde(default)]
    pub has_target: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportOffer {
    pub factory_id: String,
    pub factory_name: String,
    pub products: Vec<ExportOfferProduct>,
}

/// What raising an exporter's target did — the numbers that moved, and
/// what it cost the exporter's own plan.
///
/// The two warning lists are a diff, not the exporter's whole warning
/// list, and they're separate because they read as different sentences.
/// A factory that was already 20/min short on ore didn't break because
/// of this raise, so saying "that left it short" sends the user hunting
/// for damage that predates the click; the same shortfall widening to
/// 60/min is worth saying out loud, but as "widened", not "caused".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RaiseExportTargetResult {
    pub factory_id: String,
    pub factory_name: String,
    pub item_id: String,
    pub item_name: String,
    pub previous_target_ipm: f32,
    pub new_target_ipm: f32,
    pub previous_export_ipm: f32,
    pub new_export_ipm: f32,
    /// Export slice minus what other factories already draw — what a
    /// new consumer can actually take.
    pub remaining_ipm: f32,
    /// Findings that weren't there before this raise. Reported, never
    /// actioned: closing one of these could mean claiming a node,
    /// raising a further exporter, swapping a recipe or accepting the
    /// gap, and only the user can pick.
    pub introduced_warnings: Vec<PlanWarning>,
    /// Findings that were already open and got bigger.
    pub worsened_warnings: Vec<PlanWarning>,
}

/// The earliest tier an item is really reachable at — its whole input
/// chain, not the stamp on one recipe. Feeds the product pickers so
/// they can group honestly and mark what's still out of reach.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ItemTier {
    pub item_id: String,
    /// With alts counted as available at their own unlock tier — the
    /// same rule the planner plans by. `None` = no chain ever grounds
    /// out (event items, anything gated behind a missing ingredient).
    pub tier: Option<u8>,
    /// Standard recipes only. Higher than `tier` for an item whose
    /// early route is an alt, `None` when the item is alt-only.
    pub standard_tier: Option<u8>,
    /// Earliest tier the player can *have* the item once hand-gathered
    /// pickups count — Wood off a tree, and the Biomass and Solid
    /// Biofuel it feeds. Only sent when it beats `tier`, so an absent
    /// value means "`tier` is already the whole answer" and a consumer
    /// reads `hand_gathered_tier.or(tier)`.
    ///
    /// It is not interchangeable with `tier`: a factory can't be
    /// planned around something no belt carries, which is why the two
    /// travel separately instead of one `min`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hand_gathered_tier: Option<u8>,
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
