//! Playthrough slice — owns playthrough lifecycle.
//!
//! Surface:
//! - `create_playthrough` — generate a new `.specsdb`, register it, set as current.
//! - `list_playthroughs` — registered playthroughs from the App DB.
//! - `open_playthrough` — switch to an existing playthrough.
//! - `close_playthrough` — drop the active playthrough handle.
//! - `delete_playthrough` — close + remove the file + drop the registry row.
//! - `current_playthrough` — active playthrough's metadata + progress.
//! - `set_current_tier` — bump the player's milestone tier.
//!
//! State:
//! - App DB row in `playthrough_registry` per playthrough on disk.
//! - In-memory `tauri::State<ActivePlaythrough>` holds the open handle.
//! - Per-playthrough `.specsdb` file under `<app-data>/playthroughs/`.

pub mod commands;
pub mod dto;
pub mod repo;
pub mod state;
