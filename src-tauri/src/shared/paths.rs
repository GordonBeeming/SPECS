//! OS-specific paths for SPECS application data.
//!
//! The bundle identifier determines the per-OS app data directory, so the
//! production build (`com.gordonbeeming.specs`) and the dev build
//! (`com.gordonbeeming.specs.dev`) get fully isolated storage and can run
//! side by side without stepping on each other.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

/// Root data directory for the running app.
///
/// macOS: `~/Library/Application Support/<bundle-id>/`
/// Linux: `$XDG_DATA_HOME/<bundle-id>/` (or `~/.local/share/<bundle-id>/`)
/// Windows: `%APPDATA%\<bundle-id>\`
pub fn app_data_dir(handle: &AppHandle) -> Result<PathBuf> {
    handle
        .path()
        .app_data_dir()
        .context("resolving app data dir")
}

/// Path to the App DB (long-lived, app-wide metadata — registry, settings).
pub fn app_db_path(handle: &AppHandle) -> Result<PathBuf> {
    Ok(app_data_dir(handle)?.join("app.db"))
}

/// Directory holding `.specsdb` per-playthrough files.
pub fn playthroughs_dir(handle: &AppHandle) -> Result<PathBuf> {
    Ok(app_data_dir(handle)?.join("playthroughs"))
}

/// Ensure a directory exists. Idempotent.
pub fn ensure_dir(path: impl AsRef<Path>) -> Result<()> {
    let path = path.as_ref();
    std::fs::create_dir_all(path)
        .with_context(|| format!("creating directory {}", path.display()))
}
