use std::collections::HashMap;

use anyhow::Result;
use rusqlite::{Connection, params};

fn clock_pct_to_x100(pct: f32) -> i64 {
    (pct * 100.0).round() as i64
}
fn clock_pct_from_x100(v: i64) -> f32 {
    (v as f32) / 100.0
}

/// Sparse — one row per claimed node. Unclaimed = absent.
#[derive(Debug, Clone, PartialEq)]
pub struct ClaimRow {
    pub node_id: String,
    pub miner_id: Option<String>,
    pub clock_pct: f32,
    pub factory_id: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Upsert: if a claim already exists for `node_id`, update its fields;
/// otherwise insert. `created_at` is preserved across updates so the
/// "when did I first stake this node" timeline stays honest.
#[allow(clippy::too_many_arguments)]
pub fn claim_upsert(
    conn: &Connection,
    node_id: &str,
    miner_id: Option<&str>,
    clock_pct: f32,
    factory_id: Option<&str>,
    notes: Option<&str>,
    now: &str,
) -> Result<()> {
    let clock_x100 = clock_pct_to_x100(clock_pct);
    conn.execute(
        "INSERT INTO resource_node_claim
            (node_id, miner_id, clock_pct_x100, factory_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET
            miner_id = excluded.miner_id,
            clock_pct_x100 = excluded.clock_pct_x100,
            factory_id = excluded.factory_id,
            notes = excluded.notes,
            updated_at = excluded.updated_at",
        params![node_id, miner_id, clock_x100, factory_id, notes, now, now],
    )?;
    Ok(())
}

pub fn claim_clear(conn: &Connection, node_id: &str) -> Result<usize> {
    Ok(conn.execute("DELETE FROM resource_node_claim WHERE node_id = ?", [node_id])?)
}

pub fn claims_all(conn: &Connection) -> Result<HashMap<String, ClaimRow>> {
    let mut stmt = conn.prepare(
        "SELECT node_id, miner_id, clock_pct_x100, factory_id, notes,
                created_at, updated_at
         FROM resource_node_claim",
    )?;
    let rows = stmt.query_map([], |r| {
        let clock_x100: i64 = r.get(2)?;
        Ok(ClaimRow {
            node_id: r.get(0)?,
            miner_id: r.get(1)?,
            clock_pct: clock_pct_from_x100(clock_x100),
            factory_id: r.get(3)?,
            notes: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
        })
    })?;
    let mut out = HashMap::new();
    for row in rows {
        let row = row?;
        out.insert(row.node_id.clone(), row);
    }
    Ok(out)
}

#[allow(dead_code)]
pub fn claims_for_factory(conn: &Connection, factory_id: &str) -> Result<Vec<ClaimRow>> {
    let mut stmt = conn.prepare(
        "SELECT node_id, miner_id, clock_pct_x100, factory_id, notes,
                created_at, updated_at
         FROM resource_node_claim
         WHERE factory_id = ?
         ORDER BY node_id",
    )?;
    let rows = stmt.query_map([factory_id], |r| {
        let clock_x100: i64 = r.get(2)?;
        Ok(ClaimRow {
            node_id: r.get(0)?,
            miner_id: r.get(1)?,
            clock_pct: clock_pct_from_x100(clock_x100),
            factory_id: r.get(3)?,
            notes: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// ---- Water extractor groups ----

/// One map marker representing a bank (or two) of free-placed water
/// extractors. Bank 2 is optional — `count2`/`clock2_pct` travel
/// together (DB CHECK enforces it).
#[derive(Debug, Clone, PartialEq)]
pub struct WaterGroupRow {
    pub id: String,
    pub world_x: f64,
    pub world_y: f64,
    pub count: i64,
    pub clock_pct: f32,
    pub count2: Option<i64>,
    pub clock2_pct: Option<f32>,
    pub factory_id: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Upsert by id — `created_at` survives updates, same contract as
/// `claim_upsert`.
#[allow(clippy::too_many_arguments)]
pub fn water_group_upsert(
    conn: &Connection,
    id: &str,
    world_x: f64,
    world_y: f64,
    count: i64,
    clock_pct: f32,
    count2: Option<i64>,
    clock2_pct: Option<f32>,
    factory_id: Option<&str>,
    notes: Option<&str>,
    now: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO water_extractor_group
            (id, world_x, world_y, count, clock_pct_x100, count2, clock2_pct_x100,
             factory_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            world_x = excluded.world_x,
            world_y = excluded.world_y,
            count = excluded.count,
            clock_pct_x100 = excluded.clock_pct_x100,
            count2 = excluded.count2,
            clock2_pct_x100 = excluded.clock2_pct_x100,
            factory_id = excluded.factory_id,
            notes = excluded.notes,
            updated_at = excluded.updated_at",
        params![
            id,
            world_x,
            world_y,
            count,
            clock_pct_to_x100(clock_pct),
            count2,
            clock2_pct.map(clock_pct_to_x100),
            factory_id,
            notes,
            now,
            now,
        ],
    )?;
    Ok(())
}

pub fn water_group_delete(conn: &Connection, id: &str) -> Result<usize> {
    Ok(conn.execute("DELETE FROM water_extractor_group WHERE id = ?", [id])?)
}

pub fn water_groups_all(conn: &Connection) -> Result<Vec<WaterGroupRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, world_x, world_y, count, clock_pct_x100, count2, clock2_pct_x100,
                factory_id, notes, created_at, updated_at
         FROM water_extractor_group
         ORDER BY created_at",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(WaterGroupRow {
            id: r.get(0)?,
            world_x: r.get(1)?,
            world_y: r.get(2)?,
            count: r.get(3)?,
            clock_pct: clock_pct_from_x100(r.get(4)?),
            count2: r.get(5)?,
            clock2_pct: r.get::<_, Option<i64>>(6)?.map(clock_pct_from_x100),
            factory_id: r.get(7)?,
            notes: r.get(8)?,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::playthrough_db::PlaythroughDb;

    fn db() -> PlaythroughDb {
        PlaythroughDb::open_in_memory().unwrap()
    }

    fn seed_factory(c: &Connection, id: &str) {
        c.execute(
            "INSERT INTO factory (id, name, created_at, updated_at)
             VALUES (?, 'F', '2026-05-11', '2026-05-11')",
            [id],
        )
        .unwrap();
    }

    #[test]
    fn upsert_inserts_then_updates_preserving_created_at() {
        let pt = db();
        pt.with(|c| {
            seed_factory(c, "F1");
            claim_upsert(c, "BP_Iron1", Some("Build_MinerMk1_C"), 100.0, None, None, "2026-05-11T00:00:00Z").unwrap();
            let first = claims_all(c).unwrap();
            assert_eq!(first.len(), 1);
            let row = &first["BP_Iron1"];
            assert_eq!(row.miner_id.as_deref(), Some("Build_MinerMk1_C"));
            assert!((row.clock_pct - 100.0).abs() < 0.001);

            claim_upsert(c, "BP_Iron1", Some("Build_MinerMk2_C"), 150.0, Some("F1"), None, "2026-05-11T01:00:00Z").unwrap();
            let after = claims_all(c).unwrap();
            assert_eq!(after.len(), 1);
            let row = &after["BP_Iron1"];
            assert_eq!(row.miner_id.as_deref(), Some("Build_MinerMk2_C"));
            assert!((row.clock_pct - 150.0).abs() < 0.001);
            assert_eq!(row.created_at, "2026-05-11T00:00:00Z");
            assert_eq!(row.updated_at, "2026-05-11T01:00:00Z");
        });
    }

    #[test]
    fn clear_removes_the_row() {
        let pt = db();
        pt.with(|c| {
            claim_upsert(c, "BP_Iron1", None, 100.0, None, None, "n").unwrap();
            assert_eq!(claims_all(c).unwrap().len(), 1);
            assert_eq!(claim_clear(c, "BP_Iron1").unwrap(), 1);
            assert_eq!(claims_all(c).unwrap().len(), 0);
        });
    }

    #[test]
    fn factory_delete_nulls_factory_id_but_keeps_the_claim() {
        let pt = db();
        pt.with(|c| {
            seed_factory(c, "F1");
            claim_upsert(c, "BP_Iron1", Some("Build_MinerMk1_C"), 100.0, Some("F1"), None, "n").unwrap();
            c.execute("DELETE FROM factory WHERE id = 'F1'", []).unwrap();
            // Claim stays — the user still owns this node, it's just not
            // wired into a factory anymore.
            let after = claims_all(c).unwrap();
            assert_eq!(after.len(), 1);
            assert!(after["BP_Iron1"].factory_id.is_none());
        });
    }

    // ---- water extractor groups ----

    #[test]
    fn water_group_round_trips_decimal_clocks_and_second_bank() {
        let pt = db();
        pt.with(|c| {
            seed_factory(c, "F1");
            water_group_upsert(
                c, "wg-1", 1000.0, -2000.0, 40, 150.5, Some(2), Some(45.25), Some("F1"),
                None, "2026-06-10T00:00:00Z",
            )
            .unwrap();
            let groups = water_groups_all(c).unwrap();
            assert_eq!(groups.len(), 1);
            let g = &groups[0];
            assert_eq!(g.count, 40);
            // Two-decimal clocks must survive the x100 storage exactly.
            assert!((g.clock_pct - 150.5).abs() < 0.001, "got {}", g.clock_pct);
            assert_eq!(g.count2, Some(2));
            assert!((g.clock2_pct.unwrap() - 45.25).abs() < 0.001);
            assert_eq!(g.factory_id.as_deref(), Some("F1"));

            // Update drops bank 2 and rebinds; created_at survives.
            water_group_upsert(
                c, "wg-1", 1000.0, -2000.0, 38, 100.0, None, None, None, None,
                "2026-06-10T01:00:00Z",
            )
            .unwrap();
            let g = &water_groups_all(c).unwrap()[0];
            assert_eq!(g.count, 38);
            assert_eq!(g.count2, None);
            assert_eq!(g.clock2_pct, None);
            assert_eq!(g.factory_id, None);
            assert_eq!(g.created_at, "2026-06-10T00:00:00Z");
        });
    }

    #[test]
    fn water_group_half_filled_second_bank_is_rejected_by_check() {
        let pt = db();
        pt.with(|c| {
            let res = water_group_upsert(
                c, "wg-1", 0.0, 0.0, 1, 100.0, Some(2), None, None, None, "n",
            );
            assert!(res.is_err(), "count2 without clock2 must violate the CHECK");
        });
    }

    #[test]
    fn factory_delete_nulls_water_group_binding_but_keeps_the_group() {
        let pt = db();
        pt.with(|c| {
            seed_factory(c, "F1");
            water_group_upsert(c, "wg-1", 0.0, 0.0, 4, 100.0, None, None, Some("F1"), None, "n")
                .unwrap();
            c.execute("DELETE FROM factory WHERE id = 'F1'", []).unwrap();
            let groups = water_groups_all(c).unwrap();
            assert_eq!(groups.len(), 1);
            assert!(groups[0].factory_id.is_none());
        });
    }

    #[test]
    fn water_group_delete_removes_the_row() {
        let pt = db();
        pt.with(|c| {
            water_group_upsert(c, "wg-1", 0.0, 0.0, 4, 100.0, None, None, None, None, "n").unwrap();
            assert_eq!(water_group_delete(c, "wg-1").unwrap(), 1);
            assert!(water_groups_all(c).unwrap().is_empty());
        });
    }
}
