//! Planner slice — "I want 60 Modular Frames per minute" turns into a
//! complete factory chain with machine counts, power draw and per-stage
//! recipe choices. Supply-aware: only picks a recipe when every one of
//! its inputs traces back to either a raw resource (`gamedata.is_raw_resource`)
//! or another recipe whose inputs are themselves viable. The `apply`
//! command materialises the chain into the playthrough's factory +
//! logistics rows.

pub mod commands;
pub mod domain;
pub mod dto;
