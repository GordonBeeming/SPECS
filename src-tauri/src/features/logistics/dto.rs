use serde::{Deserialize, Serialize};

/// Inputs to the planner: "I want to move N ipm of item X to a destination
/// that is D metres away, and my playthrough is unlocked through tier T."
/// The planner returns a ranked list of plans across every belt/pipe tier
/// in the dataset — including ones the playthrough hasn't unlocked yet,
/// flagged with `locked = true` so the UI can grey them out and explain
/// the gate instead of hiding viable options.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanInput {
    pub item_id: String,
    pub items_per_minute: f32,
    /// Pipes for fluids, belts for everything else. Saved redundantly here
    /// so the planner doesn't need to look the item up itself — the command
    /// layer already has the `Item` row in hand.
    pub is_fluid: bool,
    /// Highest milestone tier the playthrough has unlocked.
    pub unlocked_tier: u8,
    /// Optional distance hint for vehicle / train / drone plans (Phase 5b).
    /// Ignored for belt and pipe plans.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_m: Option<u32>,
}

/// Categorises a `TransportPlan`. Mirrors the `transport_kind` CHECK on
/// `logistics_link` and the `TransportKind` literal union on the React side.
/// Phase 5a populates Belt + Pipe; vehicles, trains, and drones land in
/// Phase 5b once the dataset has them.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransportKind {
    Belt,
    Pipe,
    Truck,
    Tractor,
    Train,
    Drone,
}

/// One contiguous strip of identical infrastructure inside a plan.
/// `2× Mk5 belts` is one segment; a mixed `1× Mk6 + 1× Mk1` plan has two.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransportSegment {
    pub mark: u8,
    pub count: u32,
    /// Capacity of a single unit at this mark (ipm for belts, m³/min for pipes).
    pub per_unit_capacity: f32,
    /// Milestone tier required to build this mark.
    pub unlock_tier: u8,
}

/// One viable way to satisfy the requested throughput. The planner returns
/// these in rank order — fewest total belts/pipes (summed across every
/// segment) first, then closest to 100% utilisation — so the UI can
/// present them top-down. "Total units" means a 1×Mk6 plan beats a
/// 1×Mk5 + 1×Mk1 plan because the former is one belt to build vs two,
/// even though both are cheap to lay out conceptually.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransportPlan {
    pub kind: TransportKind,
    pub segments: Vec<TransportSegment>,
    /// Sum of `count × per_unit_capacity` across all segments.
    pub total_capacity_per_minute: f32,
    /// `requested / total × 100`, capped at 100 to keep the gauge sensible
    /// when the plan over-provisions (over-provisioning is normal — you
    /// can't buy half a Mk6 belt). `0..=100`.
    pub utilisation_pct: f32,
    /// Highest unlock tier across segments — what the player needs before
    /// this plan is buildable.
    pub min_unlock_tier: u8,
    /// `true` if any segment's unlock tier is above the playthrough's
    /// current tier. The UI greys these out and explains the gate.
    pub locked: bool,
}

/// Persisted link between two factories carrying a single item flow.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogisticsLink {
    pub id: String,
    pub from_factory_id: String,
    pub to_factory_id: String,
    pub item_id: String,
    /// Items per minute the player wants to move A → B. Stored on disk as
    /// 100ths of an ipm (`items_per_minute_x100` in the SQL schema) to dodge
    /// f32 drift; the repo layer divides on read and multiplies on write —
    /// same trick as `FactoryMachine.clock_pct`.
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
