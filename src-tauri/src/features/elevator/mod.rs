//! Space Elevator slice — Project Assembly delivery requirements joined with
//! the active playthrough's production.
//!
//! Surface (requires an active playthrough):
//! - `elevator_overview` — every phase, each required part's delivery quantity,
//!   how much the network produces, and the per-factory split of consumed /
//!   synced-onward / free.
//!
//! Owns no tables. The phase requirements are bundled game data
//! (`shared/gamedata`); production is read through the factory + logistics
//! slices' public functions.

pub mod commands;
pub mod dto;
