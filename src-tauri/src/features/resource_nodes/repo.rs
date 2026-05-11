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
}
