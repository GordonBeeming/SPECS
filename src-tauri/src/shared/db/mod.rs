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
//! Each DB has its own migration set. Migration `.sql` files live at the
//! crate root under `migrations/<db>/` and are embedded at compile time via
//! `refinery::embed_migrations!` (see `migrations.rs`). The slice-namespace
//! convention lives in the **filename**: `V<NNNN>__<slice>__<description>.sql`
//! makes the owning slice obvious without forcing per-slice subfolders the
//! refinery macro can't traverse.

pub mod app_db;
pub mod migrations;
pub mod playthrough_db;
