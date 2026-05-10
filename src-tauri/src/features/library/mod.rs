//! Library slice — read-only browser over the bundled game data.
//!
//! Slice surface:
//! - `library_summary` — counts and dataset version, drives the header chip.
//! - `library_items` — every item in the dataset.
//! - `library_buildings` — every building.
//! - `library_recipes` — every recipe (inputs/outputs flattened for the UI).
//! - `library_milestones` — every milestone tier.
//! - `library_belt_tiers` / `library_pipe_tiers` — transport throughput tables.
//!
//! No persistence yet — Phase 3 wires playthrough state and adds the
//! "locked at Tier X" overlay against the same data.

pub mod commands;
pub mod dto;
