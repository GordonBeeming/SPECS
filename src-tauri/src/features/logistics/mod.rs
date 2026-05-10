//! Logistics slice — cross-factory item flow.
//!
//! A `logistics_link` says "factory A sends N ipm of item X to factory B via
//! a chosen transport plan". The planner (Phase 5 core) takes
//! (item, ipm, distance, unlocked tier) and returns a ranked list of viable
//! plans across belts, pipes, vehicles, trains, and drones. The user picks
//! one; the chosen plan persists as JSON on the link row.
//!
//! Surface (each command requires an active playthrough):
//! - `list_logistics_links` / `get_logistics_link`
//! - `create_logistics_link` / `update_logistics_link` / `delete_logistics_link`
//! - `plan_logistics` — pure planner; takes inputs, returns ranked options.
//!
//! Pure transport math lives in `domain.rs` and is the most heavily tested
//! piece of the slice — getting belt/pipe/vehicle capacities wrong silently
//! produces wrong network plans, so the formulas are pinned to wiki-verified
//! table values (Mk1=60 ipm, Mk6=1200 ipm, Mk1 pipe=300 m³/min, etc.).

pub mod commands;
pub mod domain;
pub mod dto;
pub mod repo;
