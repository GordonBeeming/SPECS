//! Trains slice — shared train routes carrying multiple logistics links.
//!
//! A `train_route` is a loop visiting 2+ factories in order; one or more
//! `logistics_link`s with `transport_kind = 'train'` can be attached to
//! the route via `train_route_link` so the player sees them as carried
//! by an existing route rather than each having a dedicated train.
//!
//! Pure cycle-time math lives in `domain.rs` and is the heavily-tested
//! piece — getting it wrong silently produces wrong throughput numbers
//! in the planner. Phase 6 estimates with
//! `cycle_s = 2 × distance_m / avg_speed + per_stop_overhead × stops`
//! against a calibrated speed table.

pub mod commands;
pub mod domain;
pub mod dto;
pub mod repo;
