//! IPC DTOs for the Space Elevator slice. Field names are `camelCase` on the
//! wire so the React side reads them without an adapter step.

use serde::{Deserialize, Serialize};

/// The whole Space Elevator overview: every Project Assembly phase with its
/// delivery requirements joined against the active playthrough's production.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElevatorOverview {
    pub phases: Vec<ElevatorPhase>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElevatorPhase {
    pub phase: u8,
    pub name: String,
    /// HUB tiers this phase's delivery unlocks (empty for the final launch).
    pub unlocks_tiers: Vec<u8>,
    pub parts: Vec<ElevatorPartProgress>,
}

/// One required part for a phase, with how much the network currently makes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElevatorPartProgress {
    pub item_id: String,
    pub item_name: String,
    /// Total units the phase requires delivered to the elevator.
    pub required_quantity: u32,
    /// Sum of `produced_per_minute` across every factory making this part.
    pub total_produced_per_minute: f32,
    /// The factories producing this part, busiest first.
    pub producers: Vec<ElevatorProducer>,
}

/// A single factory's contribution to one part, split into what's already
/// spoken for (internal recipes + outgoing links) and what's free to deliver.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElevatorProducer {
    pub factory_id: String,
    pub factory_name: String,
    pub produced_per_minute: f32,
    /// Consumed by other recipes inside this same factory.
    pub consumed_internally_per_minute: f32,
    /// Sent onward to other factories via logistics links.
    pub synced_out_per_minute: f32,
    /// `produced − consumed_internally − synced_out`. Negative means the
    /// factory is over-committed (promising more than it makes).
    pub available_per_minute: f32,
}
