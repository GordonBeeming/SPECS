//! Logistics-link CRUD against the active playthrough DB.
//!
//! Mirrors the factory slice's `repo.rs` patterns: store percentages /
//! ipm as `i64 × 100` to dodge f32 drift, surface affected-row counts so
//! the command layer can map zero-row updates to `AppError::NotFound`,
//! and order list results deterministically (newest first — players think
//! about logistics in terms of "what did I just add").

use anyhow::Result;
use rusqlite::{Connection, params};

use super::dto::LogisticsLink;

fn ipm_to_x100(ipm: f32) -> i64 {
    (ipm * 100.0).round() as i64
}

fn ipm_from_x100(v: i64) -> f32 {
    (v as f32) / 100.0
}

#[allow(clippy::too_many_arguments)]
pub fn link_insert(
    conn: &Connection,
    id: &str,
    from_factory_id: &str,
    to_factory_id: &str,
    item_id: &str,
    items_per_minute: f32,
    transport_kind: &str,
    transport_plan_json: &str,
    distance_m: Option<i64>,
    notes: Option<&str>,
    now: &str,
) -> Result<()> {
    let ipm_x100 = ipm_to_x100(items_per_minute);
    conn.execute(
        "INSERT INTO logistics_link
            (id, from_factory_id, to_factory_id, item_id,
             items_per_minute_x100, transport_kind, transport_plan_json,
             distance_m, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            from_factory_id,
            to_factory_id,
            item_id,
            ipm_x100,
            transport_kind,
            transport_plan_json,
            distance_m,
            notes,
            now,
            now,
        ],
    )?;
    Ok(())
}

pub fn link_update(
    conn: &Connection,
    id: &str,
    items_per_minute: f32,
    transport_kind: &str,
    transport_plan_json: &str,
    distance_m: Option<i64>,
    notes: Option<&str>,
    now: &str,
) -> Result<usize> {
    let ipm_x100 = ipm_to_x100(items_per_minute);
    let affected = conn.execute(
        "UPDATE logistics_link
         SET items_per_minute_x100 = ?,
             transport_kind = ?,
             transport_plan_json = ?,
             distance_m = ?,
             notes = ?,
             updated_at = ?
         WHERE id = ?",
        params![ipm_x100, transport_kind, transport_plan_json, distance_m, notes, now, id],
    )?;
    Ok(affected)
}

pub fn link_delete(conn: &Connection, id: &str) -> Result<usize> {
    let affected = conn.execute("DELETE FROM logistics_link WHERE id = ?", [id])?;
    Ok(affected)
}

pub fn link_get(conn: &Connection, id: &str) -> Result<Option<LogisticsLink>> {
    let mut stmt = conn.prepare(
        "SELECT id, from_factory_id, to_factory_id, item_id,
                items_per_minute_x100, transport_kind, transport_plan_json,
                distance_m, notes, created_at, updated_at
         FROM logistics_link WHERE id = ?",
    )?;
    let mut rows = stmt.query_map([id], row_to_link)?;
    Ok(rows.next().transpose()?)
}

pub fn link_list(conn: &Connection) -> Result<Vec<LogisticsLink>> {
    let mut stmt = conn.prepare(
        "SELECT id, from_factory_id, to_factory_id, item_id,
                items_per_minute_x100, transport_kind, transport_plan_json,
                distance_m, notes, created_at, updated_at
         FROM logistics_link
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_link)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn row_to_link(r: &rusqlite::Row) -> rusqlite::Result<LogisticsLink> {
    let ipm_x100: i64 = r.get(4)?;
    Ok(LogisticsLink {
        id: r.get(0)?,
        from_factory_id: r.get(1)?,
        to_factory_id: r.get(2)?,
        item_id: r.get(3)?,
        items_per_minute: ipm_from_x100(ipm_x100),
        transport_kind: r.get(5)?,
        transport_plan_json: r.get(6)?,
        distance_m: r.get(7)?,
        notes: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::playthrough_db::PlaythroughDb;

    fn db() -> PlaythroughDb {
        PlaythroughDb::open_in_memory().unwrap()
    }

    fn seed_factories(conn: &Connection) {
        conn.execute(
            "INSERT INTO factory (id, name, created_at, updated_at)
             VALUES ('a', 'A', '2026-05-10', '2026-05-10'),
                    ('b', 'B', '2026-05-10', '2026-05-10')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn insert_and_list_round_trips_ipm_with_two_decimal_precision() {
        let pt = db();
        pt.with(|c| {
            seed_factories(c);
            link_insert(
                c, "l1", "a", "b", "Desc_IronPlate_C", 247.5, "belt",
                r#"{"belts":[{"mark":6,"count":1}]}"#, Some(120), None,
                "2026-05-10T00:00:00Z",
            )
            .unwrap();
            let links = link_list(c).unwrap();
            assert_eq!(links.len(), 1);
            assert_eq!(links[0].id, "l1");
            // 247.5 ipm round-trips precisely through the x100 storage.
            assert!((links[0].items_per_minute - 247.5).abs() < 0.001);
            assert_eq!(links[0].distance_m, Some(120));
        });
    }

    #[test]
    fn update_replaces_chosen_plan_and_returns_one_affected_row() {
        let pt = db();
        pt.with(|c| {
            seed_factories(c);
            link_insert(
                c, "l1", "a", "b", "Desc_IronPlate_C", 60.0, "belt",
                r#"{"belts":[{"mark":1,"count":1}]}"#, None, None,
                "2026-05-10T00:00:00Z",
            )
            .unwrap();
            let affected = link_update(
                c, "l1", 120.0, "belt",
                r#"{"belts":[{"mark":2,"count":1}]}"#, Some(50), Some("upgrade"),
                "2026-05-10T01:00:00Z",
            )
            .unwrap();
            assert_eq!(affected, 1);
            let l = link_get(c, "l1").unwrap().unwrap();
            assert!((l.items_per_minute - 120.0).abs() < 0.001);
            assert_eq!(l.distance_m, Some(50));
            assert_eq!(l.notes.as_deref(), Some("upgrade"));
            assert_eq!(l.updated_at, "2026-05-10T01:00:00Z");
        });
    }

    #[test]
    fn update_on_missing_id_returns_zero_affected() {
        let pt = db();
        pt.with(|c| {
            seed_factories(c);
            let affected = link_update(
                c, "ghost", 60.0, "belt", "{}", None, None, "n",
            )
            .unwrap();
            assert_eq!(affected, 0);
        });
    }

    #[test]
    fn delete_returns_zero_when_missing_one_when_present() {
        let pt = db();
        pt.with(|c| {
            seed_factories(c);
            link_insert(
                c, "l1", "a", "b", "Desc_IronPlate_C", 60.0, "belt",
                "{}", None, None, "2026-05-10",
            )
            .unwrap();
            assert_eq!(link_delete(c, "ghost").unwrap(), 0);
            assert_eq!(link_delete(c, "l1").unwrap(), 1);
            assert!(link_get(c, "l1").unwrap().is_none());
        });
    }

    #[test]
    fn factory_delete_cascades_to_links() {
        let pt = db();
        pt.with(|c| {
            seed_factories(c);
            link_insert(
                c, "l1", "a", "b", "Desc_IronPlate_C", 60.0, "belt",
                "{}", None, None, "2026-05-10",
            )
            .unwrap();
            c.execute("DELETE FROM factory WHERE id = 'a'", []).unwrap();
            assert!(link_get(c, "l1").unwrap().is_none());
        });
    }

    #[test]
    fn self_loop_links_are_rejected_by_check_constraint() {
        let pt = db();
        pt.with(|c| {
            seed_factories(c);
            let err = link_insert(
                c, "l1", "a", "a", "Desc_IronPlate_C", 60.0, "belt",
                "{}", None, None, "2026-05-10",
            );
            assert!(err.is_err(), "self-loop A->A must be rejected");
        });
    }

    #[test]
    fn invalid_transport_kind_is_rejected_by_check_constraint() {
        let pt = db();
        pt.with(|c| {
            seed_factories(c);
            let err = link_insert(
                c, "l1", "a", "b", "Desc_IronPlate_C", 60.0, "submarine",
                "{}", None, None, "2026-05-10",
            );
            assert!(err.is_err(), "transport_kind = 'submarine' must be rejected");
        });
    }

    #[test]
    fn list_orders_newest_first() {
        let pt = db();
        pt.with(|c| {
            seed_factories(c);
            link_insert(
                c, "old", "a", "b", "Desc_IronPlate_C", 60.0, "belt",
                "{}", None, None, "2026-05-09T00:00:00Z",
            )
            .unwrap();
            link_insert(
                c, "new", "a", "b", "Desc_IronPlate_C", 60.0, "belt",
                "{}", None, None, "2026-05-10T00:00:00Z",
            )
            .unwrap();
            let links = link_list(c).unwrap();
            assert_eq!(links[0].id, "new", "newest link must come first");
            assert_eq!(links[1].id, "old");
        });
    }
}
