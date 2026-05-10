//! Factory slice — owns factory + per-machine config inside the active
//! playthrough's `.specsdb` file.
//!
//! Surface (each command requires an active playthrough):
//! - `list_factories` / `get_factory_detail`
//! - `create_factory` / `rename_factory` / `delete_factory`
//! - `add_factory_machine` / `update_factory_machine` / `remove_factory_machine`
//! - `factory_ledger` — net ipm per item across all machines in a factory.
//!
//! Pure recipe math lives in `domain.rs` and carries the lion's share of the
//! tests — getting clock + count math wrong silently produces wrong factory
//! plans, so the formulas are pinned to wiki-verified table values.

pub mod commands;
pub mod domain;
pub mod dto;
pub mod repo;
