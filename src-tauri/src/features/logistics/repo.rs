//! Logistics-link CRUD against the active playthrough DB.
//!
//! Phase 5 fills this in alongside `commands.rs`. Mirrors the factory slice's
//! `repo.rs` patterns: take a `&Connection`, store percentages/ipm as
//! `i64 × 100` to dodge f32 drift, and surface affected-row counts so the
//! command layer can map zero-row updates to `AppError::NotFound`.
