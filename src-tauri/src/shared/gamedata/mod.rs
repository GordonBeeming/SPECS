//! Bundled, read-only Satisfactory game data.
//!
//! The dataset (`game-data/v0.1.json`) is loaded once at startup, validated,
//! and parked in a [`GameData`] struct that slices borrow through the Tauri
//! state. This is read-only data — playthrough-specific decisions (current
//! tier, alt recipes unlocked, etc.) live in the playthrough DB, not here.
//!
//! The current dataset is a curated Tier 0–2 fixture sized to prove the
//! library wiring without committing to the full ~150-recipe Satisfactory 1.1
//! catalogue yet. Expanding it is purely additive.

pub mod loader;
pub mod store;
pub mod types;

pub use store::GameData;
