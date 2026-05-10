use serde::{Deserialize, Serialize};

/// Inputs to the planner: "I want to move N ipm of item X to a destination
/// that is D metres away." Note that two pieces of context the React side
/// might be tempted to send — `is_fluid` and `unlocked_tier` — are
/// deliberately *not* on this struct: `plan_logistics` derives them from
/// the bundled game data row for `item_id` and the active playthrough's
/// progress row respectively, so a stale or malformed client can't trick
/// the planner into picking belts for a fluid or showing high-tier plans
/// as unlocked.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanInput {
    pub item_id: String,
    pub items_per_minute: f32,
    /// Optional distance hint for vehicle / train / drone plans (Phase 5b).
    /// Ignored for belt and pipe plans. `i64` to match the other CRUD
    /// inputs — keeps the "negative distance gives a friendly Invalid"
    /// path consistent across the slice instead of failing deserialization
    /// silently when an unsigned type is used.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_m: Option<i64>,
}

/// Categorises a `TransportPlan`. Mirrors the `transport_kind` CHECK on
/// `logistics_link` and the `TransportKind` literal union on the React side.
/// Phase 5a populates Belt + Pipe; vehicles, trains, and drones land in
/// Phase 5b once the dataset has them.
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

impl TransportKind {
    /// Wire/SQL representation. Matches the values the `transport_kind`
    /// CHECK constraint accepts so command code can pass the result
    /// straight to the repo.
    pub fn as_db_str(self) -> &'static str {
        match self {
            TransportKind::Belt => "belt",
            TransportKind::Pipe => "pipe",
            TransportKind::Truck => "truck",
            TransportKind::Tractor => "tractor",
            TransportKind::Train => "train",
            TransportKind::Drone => "drone",
        }
    }
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

/// New link request from the React side. The user has already picked a
/// plan from the planner output and is asking us to persist it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLogisticsLinkInput {
    pub from_factory_id: String,
    pub to_factory_id: String,
    pub item_id: String,
    pub items_per_minute: f32,
    pub transport_kind: TransportKind,
    /// JSON-serialised `TransportPlan` the user picked. Stored verbatim
    /// — re-validation happens on the React side when the link is edited.
    pub transport_plan_json: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_m: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Edit request for an existing link — change throughput, swap the
/// chosen plan, edit distance/notes. Factory endpoints + item are
/// immutable on a link (delete + recreate if those need to change).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLogisticsLinkInput {
    pub id: String,
    pub items_per_minute: f32,
    pub transport_kind: TransportKind,
    pub transport_plan_json: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distance_m: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
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
