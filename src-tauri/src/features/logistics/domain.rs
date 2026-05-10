//! Pure transport-plan math.
//!
//! Phase 5 fills this in: take (item, ipm, distance, unlocked tier) and
//! produce a ranked `Vec<TransportPlan>` covering belts, pipes, vehicles,
//! trains, and drones. Functions here take values, return values — no
//! `tauri::State`, no DB. Tests sit alongside and pin against the wiki-
//! verified capacity table the bundled dataset already encodes.
