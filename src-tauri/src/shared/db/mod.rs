// PlaythroughDb + AppDb::with are used by tests and by Phase 3 slices that
// land in the next PR. Suppressed warning until then so dev builds stay clean.
#![allow(dead_code)]

//! Database infrastructure shared across slices.
//!
//! SPECS has two independent SQLite databases:
//!
//! - **App DB** — long-lived, app-wide metadata (playthrough registry,
//!   user settings, last-opened state). One file per install.
//! - **Playthrough DB** — one `.specsdb` file per playthrough. The unit of
//!   sharing: send a friend the file and they import it. Wired in Phase 3.
//!
//! Each DB has its own migration set. Slices that own tables put their
//! migrations in `features/<slice>/migrations/`; the runner here applies them
//! in version order against the right DB.

pub mod app_db;
pub mod migrations;
pub mod playthrough_db;
