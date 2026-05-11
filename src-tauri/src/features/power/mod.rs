//! Power slice — per-factory generators with fuel consumption and
//! clock-aware MW totals. Pairs with the factory slice's
//! `compose_ledger` to give the React side a "net MW" reading
//! (generator output minus machine power).
//!
//! Pure math lives in `domain.rs`; CRUD against `power_gen` in
//! `repo.rs`; Tauri commands in `commands.rs`.

pub mod commands;
pub mod domain;
pub mod dto;
pub mod repo;
