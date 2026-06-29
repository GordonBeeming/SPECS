//! User-facing feature slices.
//!
//! Each slice owns its commands, DTOs, repo, domain logic, migrations, and
//! README. See `docs/vsa/rust/slice-template.md` to add a new one.

pub mod alts;
pub mod elevator;
pub mod factory;
pub mod health;
pub mod library;
pub mod logistics;
pub mod planner;
pub mod playthrough;
pub mod power;
pub mod resource_nodes;
pub mod trains;
pub mod validation;
