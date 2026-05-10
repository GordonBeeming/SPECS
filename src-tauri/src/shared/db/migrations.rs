//! SQL migration definitions and runner.
//!
//! Migrations are embedded at compile time via `refinery::embed_migrations!`
//! against per-DB folders. Each slice that owns tables drops its `.sql` files
//! into the appropriate folder and they get picked up automatically.
//!
//! Filename convention: `V<NNNN>__<slice>__<description>.sql` so the order
//! is unambiguous and the owning slice is visible at a glance.

use anyhow::{Context, Result};
use rusqlite::Connection;

/// App DB migrations (app-wide metadata: playthrough registry, settings).
pub mod app {
    refinery::embed_migrations!("./migrations/app");
}

/// Playthrough DB migrations (per-playthrough state: factories, links, …).
/// Wired up in Phase 3; the folder is empty at Phase 2 but the runner is
/// already wired so adding the first slice is a one-line change.
pub mod playthrough {
    refinery::embed_migrations!("./migrations/playthrough");
}

/// Apply all App DB migrations to the given connection.
pub fn run_app_migrations(conn: &mut Connection) -> Result<()> {
    app::migrations::runner()
        .run(conn)
        .context("running app DB migrations")?;
    Ok(())
}

/// Apply all Playthrough DB migrations to the given connection.
pub fn run_playthrough_migrations(conn: &mut Connection) -> Result<()> {
    playthrough::migrations::runner()
        .run(conn)
        .context("running playthrough DB migrations")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory() -> Connection {
        Connection::open_in_memory().expect("in-memory connection")
    }

    #[test]
    fn app_migrations_apply_cleanly_on_empty_db() {
        let mut conn = in_memory();
        run_app_migrations(&mut conn).expect("app migrations succeed");
        // refinery_schema_history exists once migrations ran.
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='refinery_schema_history'",
                [],
                |r| r.get(0),
            )
            .expect("query schema history");
        assert_eq!(count, 1, "refinery should track applied migrations");
    }

    #[test]
    fn app_migrations_are_idempotent() {
        let mut conn = in_memory();
        run_app_migrations(&mut conn).expect("first run");
        run_app_migrations(&mut conn).expect("second run is a no-op");
    }

    #[test]
    fn playthrough_migrations_apply_cleanly_on_empty_db() {
        let mut conn = in_memory();
        run_playthrough_migrations(&mut conn).expect("playthrough migrations succeed");
    }

    #[test]
    fn playthrough_migrations_are_idempotent() {
        let mut conn = in_memory();
        run_playthrough_migrations(&mut conn).expect("first run");
        run_playthrough_migrations(&mut conn).expect("second run is a no-op");
    }

    #[test]
    fn app_db_creates_settings_table() {
        let mut conn = in_memory();
        run_app_migrations(&mut conn).expect("migrations");
        let exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='app_settings'",
                [],
                |r| r.get(0),
            )
            .expect("query settings table");
        assert_eq!(exists, 1, "app_settings table should exist after migrations");
    }

    #[test]
    fn app_db_creates_playthrough_registry_table() {
        let mut conn = in_memory();
        run_app_migrations(&mut conn).expect("migrations");
        let exists: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='playthrough_registry'",
                [],
                |r| r.get(0),
            )
            .expect("query registry table");
        assert_eq!(exists, 1, "playthrough_registry table should exist");
    }
}
