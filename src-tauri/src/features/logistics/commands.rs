//! Tauri command surface for the logistics slice.
//!
//! Phase 5 wires `list_logistics_links`, `create_logistics_link`,
//! `update_logistics_link`, `delete_logistics_link`, and the pure planner
//! `plan_logistics`. Every command takes `State<ActivePlaythrough>` and
//! delegates to `repo` + `domain`, exactly like the factory slice.

#![allow(dead_code)]
