//! App DB connection pool.
//!
//! Single connection guarded by a `parking_lot::Mutex`. SQLite serialises
//! writes anyway and the App DB sees very little traffic (settings, registry
//! lookups, the occasional INSERT when a playthrough is registered), so a
//! single-connection pool is plenty.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::Connection;

use super::migrations::run_app_migrations;

/// Thread-safe handle on the App DB. Cheap to clone.
#[derive(Clone)]
pub struct AppDb {
    inner: Arc<Mutex<Connection>>,
}

impl AppDb {
    /// Open the App DB at `path`, run migrations, return a ready-to-use handle.
    /// Creates the parent directory if missing.
    pub fn open(path: &PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
        let mut conn =
            Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        // Pragmatic durability + concurrency defaults.
        conn.pragma_update(None, "journal_mode", "WAL")
            .context("setting WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .context("setting synchronous=NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .context("enabling foreign keys")?;
        run_app_migrations(&mut conn).context("running App DB migrations")?;
        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    /// Open a transient in-memory App DB for tests.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let mut conn = Connection::open_in_memory().context("in-memory connection")?;
        run_app_migrations(&mut conn).context("running migrations on in-memory DB")?;
        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    /// Acquire the connection for a synchronous block of work.
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
    fn open_in_memory_runs_migrations_and_exposes_settings_table() {
        let db = AppDb::open_in_memory().expect("open");
        let count: i64 = db.with(|c| {
            c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='app_settings'",
                [],
                |r| r.get(0),
            )
            .expect("query")
        });
        assert_eq!(count, 1);
    }

    #[test]
    fn settings_round_trip() {
        let db = AppDb::open_in_memory().expect("open");
        db.with(|c| {
            c.execute(
                "INSERT INTO app_settings(key, value) VALUES (?, ?)",
                ["theme", "dark"],
            )
            .unwrap();
        });
        let value: String = db.with(|c| {
            c.query_row(
                "SELECT value FROM app_settings WHERE key = ?",
                ["theme"],
                |r| r.get(0),
            )
            .unwrap()
        });
        assert_eq!(value, "dark");
    }

    #[test]
    fn open_creates_parent_directory_if_missing() {
        let temp = std::env::temp_dir().join(format!("specs-app-db-test-{}", uuid::Uuid::new_v4()));
        let db_path = temp.join("nested").join("app.db");
        let db = AppDb::open(&db_path).expect("open");
        // sanity — schema is in place
        db.with(|c| {
            c.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='app_settings'",
                [],
                |r| -> rusqlite::Result<i64> { r.get(0) },
            )
            .expect("settings table exists");
        });
        std::fs::remove_dir_all(temp).ok();
    }
}
