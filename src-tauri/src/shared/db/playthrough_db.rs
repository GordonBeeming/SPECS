//! Playthrough DB connection pool.
//!
//! Same shape as [`AppDb`] but pointed at the per-playthrough `.specsdb` file
//! that the user is currently editing. Phase 3 wires this in (open on
//! "switch playthrough", close when switching to another). The wrapper exists
//! now so Phase 2 can verify the migration runner against an empty
//! playthrough schema and so the `lib.rs` typing settles before the first
//! persistent slice lands.
//!
//! Like the App DB it's a single-connection pool — SQLite serialises writes
//! and a planning app does not generate enough traffic to justify a real
//! connection pool.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::Connection;

use super::migrations::run_playthrough_migrations;

#[derive(Clone)]
pub struct PlaythroughDb {
    inner: Arc<Mutex<Connection>>,
}

impl PlaythroughDb {
    /// Open (or create) the playthrough DB at `path`, run migrations.
    pub fn open(path: &PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        let mut conn =
            Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        run_playthrough_migrations(&mut conn)
            .context("running Playthrough DB migrations")?;
        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let mut conn = Connection::open_in_memory()?;
        run_playthrough_migrations(&mut conn)?;
        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn with<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&mut Connection) -> R,
    {
        let mut guard = self.inner.lock();
        f(&mut guard)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_runs_migrations() {
        let _db = PlaythroughDb::open_in_memory().expect("open");
        // No tables in the playthrough schema yet (Phase 3+ adds them) — the
        // test just verifies the runner accepts an empty migration set.
    }

    #[test]
    fn idempotent_open() {
        let temp = std::env::temp_dir().join(format!("specs-pt-db-{}.specsdb", uuid::Uuid::new_v4()));
        {
            let _db = PlaythroughDb::open(&temp).expect("open 1");
        }
        {
            let _db = PlaythroughDb::open(&temp).expect("open 2 — re-running migrations is fine");
        }
        std::fs::remove_file(&temp).ok();
    }
}
