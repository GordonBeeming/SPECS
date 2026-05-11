//! Repository layer for the playthrough slice.
//!
//! Splits cleanly into two collections of queries:
//! - **App DB** — playthrough_registry CRUD.
//! - **Playthrough DB** — meta + progress reads/writes inside an opened
//!   `.specsdb` file.

use anyhow::Result;
use rusqlite::{Connection, params};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::dto::{PlaythroughDetail, PlaythroughSummary};

// ---------- App DB (registry) ----------

pub fn registry_insert(
    conn: &Connection,
    id: &str,
    display_name: &str,
    file_path: &str,
    schema_version: i64,
    created_at: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO playthrough_registry
            (id, display_name, file_path, schema_version, created_at, last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![id, display_name, file_path, schema_version, created_at, created_at],
    )?;
    Ok(())
}

pub fn registry_list(conn: &Connection) -> Result<Vec<PlaythroughSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, display_name, created_at, last_opened_at, schema_version
         FROM playthrough_registry
         ORDER BY COALESCE(last_opened_at, created_at) DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(PlaythroughSummary {
            id: r.get(0)?,
            display_name: r.get(1)?,
            created_at: r.get(2)?,
            last_opened_at: r.get(3)?,
            schema_version: r.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn registry_get(conn: &Connection, id: &str) -> Result<Option<PlaythroughSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, display_name, created_at, last_opened_at, schema_version
         FROM playthrough_registry WHERE id = ?",
    )?;
    let mut rows = stmt.query_map([id], |r| {
        Ok(PlaythroughSummary {
            id: r.get(0)?,
            display_name: r.get(1)?,
            created_at: r.get(2)?,
            last_opened_at: r.get(3)?,
            schema_version: r.get(4)?,
        })
    })?;
    Ok(rows.next().transpose()?)
}

pub fn registry_get_path(conn: &Connection, id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT file_path FROM playthrough_registry WHERE id = ?")?;
    let mut rows = stmt.query_map([id], |r| r.get::<_, String>(0))?;
    Ok(rows.next().transpose()?)
}

pub fn registry_touch_last_opened(conn: &Connection, id: &str) -> Result<()> {
    let now = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string());
    conn.execute(
        "UPDATE playthrough_registry SET last_opened_at = ? WHERE id = ?",
        params![now, id],
    )?;
    Ok(())
}

pub fn registry_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM playthrough_registry WHERE id = ?", [id])?;
    Ok(())
}

// ---------- Playthrough DB (inside the .specsdb) ----------

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM meta WHERE key = ?")?;
    let mut rows = stmt.query_map([key], |r| r.get::<_, String>(0))?;
    Ok(rows.next().transpose()?)
}

pub fn progress_init(conn: &Connection, current_tier: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO progress (id, current_tier, current_milestone_progress)
         VALUES (1, ?, 0)
         ON CONFLICT(id) DO UPDATE SET current_tier = excluded.current_tier",
        params![current_tier],
    )?;
    Ok(())
}

pub fn progress_get(conn: &Connection) -> Result<(i64, i64)> {
    let row = conn.query_row(
        "SELECT current_tier, current_milestone_progress FROM progress WHERE id = 1",
        [],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
    )?;
    Ok(row)
}

pub fn progress_set_tier(conn: &Connection, tier: i64) -> Result<()> {
    conn.execute(
        "UPDATE progress SET current_tier = ? WHERE id = 1",
        params![tier],
    )?;
    Ok(())
}

pub fn amplifier_inventory_get(conn: &Connection) -> Result<(i64, i64)> {
    // V0005 seeds the singleton row with `INSERT OR IGNORE`, so this
    // always finds a row; the COALESCE guard is belt-and-braces in
    // case a future migration ever drops + recreates the table.
    let row = conn.query_row(
        "SELECT COALESCE(somersloop_quantity, 0), COALESCE(power_shard_quantity, 0)
         FROM inventory_amplifier WHERE id = 1",
        [],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
    )?;
    Ok(row)
}

pub fn amplifier_inventory_set(
    conn: &Connection,
    somersloop: i64,
    power_shard: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO inventory_amplifier (id, somersloop_quantity, power_shard_quantity)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
             somersloop_quantity = excluded.somersloop_quantity,
             power_shard_quantity = excluded.power_shard_quantity",
        params![somersloop, power_shard],
    )?;
    Ok(())
}

/// Read the full playthrough detail by joining App DB summary with
/// Playthrough DB meta + progress.
pub fn detail_from(
    summary: PlaythroughSummary,
    pt_conn: &Connection,
) -> Result<PlaythroughDetail> {
    let game_version = meta_get(pt_conn, "game_version")?.unwrap_or_default();
    let (current_tier, current_milestone_progress) = progress_get(pt_conn)?;
    Ok(PlaythroughDetail {
        id: summary.id,
        display_name: summary.display_name,
        game_version,
        created_at: summary.created_at,
        current_tier,
        current_milestone_progress,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::app_db::AppDb;
    use crate::shared::db::playthrough_db::PlaythroughDb;

    #[test]
    fn registry_insert_and_list_round_trip() {
        let app = AppDb::open_in_memory().unwrap();
        app.with(|c| {
            registry_insert(c, "abc", "Default Run", "/tmp/x.specsdb", 1, "2026-05-10T00:00:00Z").unwrap();
            registry_insert(c, "def", "Speedrun", "/tmp/y.specsdb", 1, "2026-05-10T01:00:00Z").unwrap();
        });
        let list = app.with(|c| registry_list(c).unwrap());
        assert_eq!(list.len(), 2);
        // Most-recently-opened (== created here) first.
        assert_eq!(list[0].id, "def");
        assert_eq!(list[1].id, "abc");
    }

    #[test]
    fn registry_touch_updates_last_opened() {
        let app = AppDb::open_in_memory().unwrap();
        app.with(|c| {
            registry_insert(c, "abc", "Default", "/tmp/x.specsdb", 1, "2026-05-10T00:00:00Z").unwrap();
            registry_touch_last_opened(c, "abc").unwrap();
            let row = registry_get(c, "abc").unwrap().unwrap();
            assert!(row.last_opened_at.is_some());
        });
    }

    #[test]
    fn amplifier_inventory_seed_and_round_trip() {
        let pt = PlaythroughDb::open_in_memory().unwrap();
        pt.with(|c| {
            // Seeded by V0005 — both fields should be 0 by default.
            assert_eq!(amplifier_inventory_get(c).unwrap(), (0, 0));
            amplifier_inventory_set(c, 12, 5).unwrap();
            assert_eq!(amplifier_inventory_get(c).unwrap(), (12, 5));
            // Updating again replaces the existing row (no duplicate rows).
            amplifier_inventory_set(c, 0, 3).unwrap();
            assert_eq!(amplifier_inventory_get(c).unwrap(), (0, 3));
        });
    }

    #[test]
    fn registry_delete_removes_row() {
        let app = AppDb::open_in_memory().unwrap();
        app.with(|c| {
            registry_insert(c, "abc", "Default", "/tmp/x.specsdb", 1, "2026-05-10T00:00:00Z").unwrap();
            registry_delete(c, "abc").unwrap();
            assert!(registry_get(c, "abc").unwrap().is_none());
        });
    }

    #[test]
    fn meta_round_trip_with_upsert() {
        let pt = PlaythroughDb::open_in_memory().unwrap();
        pt.with(|c| {
            meta_set(c, "name", "Run 1").unwrap();
            meta_set(c, "name", "Run 1 (renamed)").unwrap();
            assert_eq!(meta_get(c, "name").unwrap().as_deref(), Some("Run 1 (renamed)"));
            assert!(meta_get(c, "missing").unwrap().is_none());
        });
    }

    #[test]
    fn progress_init_then_get_returns_starting_tier() {
        let pt = PlaythroughDb::open_in_memory().unwrap();
        pt.with(|c| {
            progress_init(c, 3).unwrap();
            let (tier, progress) = progress_get(c).unwrap();
            assert_eq!(tier, 3);
            assert_eq!(progress, 0);
        });
    }

    #[test]
    fn progress_init_is_idempotent_and_overwrites_tier() {
        let pt = PlaythroughDb::open_in_memory().unwrap();
        pt.with(|c| {
            progress_init(c, 0).unwrap();
            progress_init(c, 4).unwrap();
            let (tier, _) = progress_get(c).unwrap();
            assert_eq!(tier, 4);
        });
    }

    #[test]
    fn progress_set_tier_updates_value() {
        let pt = PlaythroughDb::open_in_memory().unwrap();
        pt.with(|c| {
            progress_init(c, 0).unwrap();
            progress_set_tier(c, 7).unwrap();
            let (tier, _) = progress_get(c).unwrap();
            assert_eq!(tier, 7);
        });
    }
}
