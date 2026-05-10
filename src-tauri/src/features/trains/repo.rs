//! Train-route CRUD against the active playthrough DB.

use anyhow::Result;
use rusqlite::{Connection, params};

use super::dto::{TrainRoute, TrainRouteStop};

pub fn route_insert(
    conn: &Connection,
    id: &str,
    name: &str,
    freight_cars: i64,
    fluid_cars: i64,
    total_distance_m: Option<i64>,
    est_cycle_seconds: Option<f64>,
    notes: Option<&str>,
    now: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO train_route
            (id, name, freight_cars, fluid_cars, total_distance_m,
             est_cycle_seconds, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, name, freight_cars, fluid_cars, total_distance_m,
                est_cycle_seconds, notes, now, now],
    )?;
    Ok(())
}

pub fn route_update(
    conn: &Connection,
    id: &str,
    name: &str,
    freight_cars: i64,
    fluid_cars: i64,
    total_distance_m: Option<i64>,
    est_cycle_seconds: Option<f64>,
    notes: Option<&str>,
    now: &str,
) -> Result<usize> {
    let affected = conn.execute(
        "UPDATE train_route
         SET name = ?, freight_cars = ?, fluid_cars = ?,
             total_distance_m = ?, est_cycle_seconds = ?, notes = ?,
             updated_at = ?
         WHERE id = ?",
        params![name, freight_cars, fluid_cars, total_distance_m,
                est_cycle_seconds, notes, now, id],
    )?;
    Ok(affected)
}

pub fn route_delete(conn: &Connection, id: &str) -> Result<usize> {
    let affected = conn.execute("DELETE FROM train_route WHERE id = ?", [id])?;
    Ok(affected)
}

pub fn route_get(conn: &Connection, id: &str) -> Result<Option<TrainRoute>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, freight_cars, fluid_cars, total_distance_m,
                est_cycle_seconds, notes, created_at, updated_at
         FROM train_route WHERE id = ?",
    )?;
    let mut rows = stmt.query_map([id], row_to_route)?;
    Ok(rows.next().transpose()?)
}

pub fn route_list(conn: &Connection) -> Result<Vec<TrainRoute>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, freight_cars, fluid_cars, total_distance_m,
                est_cycle_seconds, notes, created_at, updated_at
         FROM train_route
         -- Stable ordering across runs even when names collide.
         ORDER BY LOWER(name), id",
    )?;
    let rows = stmt.query_map([], row_to_route)?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

fn row_to_route(r: &rusqlite::Row) -> rusqlite::Result<TrainRoute> {
    Ok(TrainRoute {
        id: r.get(0)?,
        name: r.get(1)?,
        freight_cars: r.get(2)?,
        fluid_cars: r.get(3)?,
        total_distance_m: r.get(4)?,
        est_cycle_seconds: r.get(5)?,
        notes: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

// ---- Stops ----

pub fn stops_replace(
    conn: &Connection,
    route_id: &str,
    stops: &[String],
) -> Result<()> {
    conn.execute("DELETE FROM train_route_stop WHERE route_id = ?", [route_id])?;
    for (i, factory_id) in stops.iter().enumerate() {
        conn.execute(
            "INSERT INTO train_route_stop (route_id, factory_id, ordinal)
             VALUES (?, ?, ?)",
            params![route_id, factory_id, i as i64],
        )?;
    }
    Ok(())
}

pub fn stops_for_route(conn: &Connection, route_id: &str) -> Result<Vec<TrainRouteStop>> {
    let mut stmt = conn.prepare(
        "SELECT route_id, factory_id, ordinal
         FROM train_route_stop
         WHERE route_id = ?
         ORDER BY ordinal ASC",
    )?;
    let rows = stmt.query_map([route_id], |r| {
        Ok(TrainRouteStop {
            route_id: r.get(0)?,
            factory_id: r.get(1)?,
            ordinal: r.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

// ---- Link attachment ----

/// Cleanup pass: deletes any `train_route` whose stop count fell below
/// 2 (the slice invariant). Called by the factory-delete command after
/// it cascades stops, so a deleted factory can't strand a 1-stop route.
/// Implemented as an explicit pass rather than a trigger so it doesn't
/// fire mid-`stops_replace` (which DELETEs all stops then INSERTs new
/// ones — a trigger would tear the route down between those steps).
pub fn routes_drop_below_two_stops(conn: &Connection) -> Result<usize> {
    let affected = conn.execute(
        "DELETE FROM train_route
         WHERE id IN (
             SELECT r.id FROM train_route r
             LEFT JOIN train_route_stop s ON s.route_id = r.id
             GROUP BY r.id
             HAVING COUNT(s.route_id) < 2
         )",
        [],
    )?;
    Ok(affected)
}

pub fn link_attach(conn: &Connection, link_id: &str, route_id: &str) -> Result<()> {
    // ON CONFLICT(link_id) DO UPDATE keeps the at-most-one-route
    // invariant on link_id. Deliberately not `INSERT OR REPLACE` —
    // that variant deletes the conflicting row first, which would fire
    // any DELETE triggers / FK cascades on `train_route_link`. Upsert
    // via DO UPDATE is in-place and safer for future trigger work.
    conn.execute(
        "INSERT INTO train_route_link (link_id, route_id)
         VALUES (?, ?)
         ON CONFLICT(link_id) DO UPDATE SET route_id = excluded.route_id",
        params![link_id, route_id],
    )?;
    Ok(())
}

pub fn link_detach(conn: &Connection, link_id: &str) -> Result<usize> {
    let affected = conn.execute(
        "DELETE FROM train_route_link WHERE link_id = ?",
        [link_id],
    )?;
    Ok(affected)
}

pub fn link_ids_for_route(conn: &Connection, route_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT link_id FROM train_route_link WHERE route_id = ? ORDER BY link_id",
    )?;
    let rows = stmt.query_map([route_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::playthrough_db::PlaythroughDb;

    fn db() -> PlaythroughDb {
        PlaythroughDb::open_in_memory().unwrap()
    }

    fn seed(c: &Connection) {
        c.execute(
            "INSERT INTO factory (id, name, created_at, updated_at)
             VALUES ('a', 'A', '2026-05-10', '2026-05-10'),
                    ('b', 'B', '2026-05-10', '2026-05-10'),
                    ('c', 'C', '2026-05-10', '2026-05-10')",
            [],
        ).unwrap();
    }

    #[test]
    fn insert_and_list_route_round_trips() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            route_insert(c, "r1", "Ore Loop", 4, 0, Some(1500), Some(140.0),
                         Some("first try"), "2026-05-10T00:00:00Z").unwrap();
            let routes = route_list(c).unwrap();
            assert_eq!(routes.len(), 1);
            assert_eq!(routes[0].name, "Ore Loop");
            assert_eq!(routes[0].freight_cars, 4);
            assert_eq!(routes[0].total_distance_m, Some(1500));
            assert!((routes[0].est_cycle_seconds.unwrap() - 140.0).abs() < 0.001);
        });
    }

    #[test]
    fn route_check_constraint_rejects_zero_total_cars() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            let err = route_insert(c, "r1", "Empty Train", 0, 0, None, None, None, "n");
            assert!(err.is_err(), "0 freight + 0 fluid cars must be rejected");
        });
    }

    #[test]
    fn stops_replace_clears_then_inserts_in_order() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            route_insert(c, "r1", "X", 2, 0, None, None, None, "n").unwrap();
            stops_replace(c, "r1", &["a".into(), "b".into(), "c".into()]).unwrap();
            let stops = stops_for_route(c, "r1").unwrap();
            assert_eq!(stops.len(), 3);
            assert_eq!(stops[0].ordinal, 0);
            assert_eq!(stops[0].factory_id, "a");
            assert_eq!(stops[2].factory_id, "c");

            // Replace with a different shape — old rows are gone.
            stops_replace(c, "r1", &["b".into(), "a".into()]).unwrap();
            let stops = stops_for_route(c, "r1").unwrap();
            assert_eq!(stops.len(), 2);
            assert_eq!(stops[0].factory_id, "b");
        });
    }

    #[test]
    fn route_delete_cascades_to_stops_and_links() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            route_insert(c, "r1", "X", 2, 0, None, None, None, "n").unwrap();
            stops_replace(c, "r1", &["a".into(), "b".into()]).unwrap();
            // Seed a link so we can test link cascade too.
            c.execute(
                "INSERT INTO logistics_link
                    (id, from_factory_id, to_factory_id, item_id,
                     items_per_minute_x100, transport_kind, transport_plan_json,
                     created_at, updated_at)
                 VALUES ('l1', 'a', 'b', 'Desc_IronOre_C', 6000, 'train', '{}',
                         '2026-05-10', '2026-05-10')",
                [],
            ).unwrap();
            link_attach(c, "l1", "r1").unwrap();

            route_delete(c, "r1").unwrap();
            assert!(stops_for_route(c, "r1").unwrap().is_empty());
            assert!(link_ids_for_route(c, "r1").unwrap().is_empty());
        });
    }

    #[test]
    fn link_attach_replaces_previous_route_for_same_link() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            route_insert(c, "r1", "X", 2, 0, None, None, None, "n").unwrap();
            route_insert(c, "r2", "Y", 2, 0, None, None, None, "n").unwrap();
            c.execute(
                "INSERT INTO logistics_link
                    (id, from_factory_id, to_factory_id, item_id,
                     items_per_minute_x100, transport_kind, transport_plan_json,
                     created_at, updated_at)
                 VALUES ('l1', 'a', 'b', 'Desc_IronOre_C', 6000, 'train', '{}',
                         '2026-05-10', '2026-05-10')",
                [],
            ).unwrap();

            link_attach(c, "l1", "r1").unwrap();
            assert_eq!(link_ids_for_route(c, "r1").unwrap(), vec!["l1"]);

            // Re-attach to r2 — r1 should no longer claim it.
            link_attach(c, "l1", "r2").unwrap();
            assert!(link_ids_for_route(c, "r1").unwrap().is_empty());
            assert_eq!(link_ids_for_route(c, "r2").unwrap(), vec!["l1"]);
        });
    }

    #[test]
    fn routes_drop_below_two_stops_kills_underfilled_routes() {
        // Codex P1 scenario: factory delete cascades a stop, leaving a
        // 1-stop route. The cleanup pass is called explicitly by
        // `delete_factory` (see factory/commands.rs) and removes the
        // stranded route.
        let pt = db();
        pt.with(|c| {
            seed(c);
            route_insert(c, "r1", "X", 2, 0, None, None, None, "n").unwrap();
            stops_replace(c, "r1", &["a".into(), "b".into()]).unwrap();
            route_insert(c, "r2", "Y", 2, 0, None, None, None, "n").unwrap();
            stops_replace(c, "r2", &["a".into(), "b".into(), "c".into()]).unwrap();

            // Drop factory `b` — cascades remove one stop from each route.
            c.execute("DELETE FROM factory WHERE id = 'b'", []).unwrap();
            let dropped = routes_drop_below_two_stops(c).unwrap();
            assert_eq!(dropped, 1, "only the 1-stop r1 should have been deleted");
            assert!(route_get(c, "r1").unwrap().is_none());
            // r2 still has 2 stops left (a + c) — survives.
            assert!(route_get(c, "r2").unwrap().is_some());
        });
    }

    #[test]
    fn routes_drop_below_two_stops_is_a_no_op_when_everything_is_healthy() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            route_insert(c, "r1", "X", 2, 0, None, None, None, "n").unwrap();
            stops_replace(c, "r1", &["a".into(), "b".into()]).unwrap();
            let dropped = routes_drop_below_two_stops(c).unwrap();
            assert_eq!(dropped, 0);
            assert!(route_get(c, "r1").unwrap().is_some());
        });
    }

    #[test]
    fn link_detach_returns_zero_when_missing_one_when_present() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            route_insert(c, "r1", "X", 2, 0, None, None, None, "n").unwrap();
            c.execute(
                "INSERT INTO logistics_link
                    (id, from_factory_id, to_factory_id, item_id,
                     items_per_minute_x100, transport_kind, transport_plan_json,
                     created_at, updated_at)
                 VALUES ('l1', 'a', 'b', 'Desc_IronOre_C', 6000, 'train', '{}',
                         '2026-05-10', '2026-05-10')",
                [],
            ).unwrap();
            link_attach(c, "l1", "r1").unwrap();
            assert_eq!(link_detach(c, "ghost").unwrap(), 0);
            assert_eq!(link_detach(c, "l1").unwrap(), 1);
        });
    }
}
