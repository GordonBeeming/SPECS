//! Resource-nodes slice — per-playthrough claims against the bundled
//! map-node catalog (`game-data/nodes.json`). The slice owns:
//!
//! - The list-with-claims surface the React Resources view consumes.
//! - Claim CRUD (`set_node_claim`, `clear_node_claim`).
//! - The supply-rollup math the planner + factory ledger use to
//!   gate "do you have enough water for Pure Iron Ingot?" decisions.

pub mod commands;
pub mod domain;
pub mod dto;
pub mod repo;
