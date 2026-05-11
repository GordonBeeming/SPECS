use anyhow::Result;
use rusqlite::{Connection, params};

use super::dto::PowerGen;

fn clock_pct_to_x100(pct: f32) -> i64 { (pct * 100.0).round() as i64 }
fn clock_pct_from_x100(v: i64) -> f32 { (v as f32) / 100.0 }

#[allow(clippy::too_many_arguments)]
pub fn power_gen_insert(
    conn: &Connection,
    id: &str,
    factory_id: &str,
    generator_id: &str,
    fuel_item_id: &str,
    count: i64,
    clock_pct: f32,
    notes: Option<&str>,
    now: &str,
) -> Result<()> {
    let clock_x100 = clock_pct_to_x100(clock_pct);
    conn.execute(
        "INSERT INTO power_gen
            (id, factory_id, generator_id, fuel_item_id, count,
             clock_pct_x100, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![id, factory_id, generator_id, fuel_item_id, count,
                clock_x100, notes, now, now],
    )?;
    Ok(())
}

pub fn power_gen_update(
    conn: &Connection,
    id: &str,
    count: i64,
    clock_pct: f32,
    fuel_item_id: &str,
    notes: Option<&str>,
    now: &str,
) -> Result<usize> {
    let clock_x100 = clock_pct_to_x100(clock_pct);
    let affected = conn.execute(
        "UPDATE power_gen
         SET count = ?, clock_pct_x100 = ?, fuel_item_id = ?, notes = ?, updated_at = ?
         WHERE id = ?",
        params![count, clock_x100, fuel_item_id, notes, now, id],
    )?;
    Ok(affected)
}

pub fn power_gen_delete(conn: &Connection, id: &str) -> Result<usize> {
    Ok(conn.execute("DELETE FROM power_gen WHERE id = ?", [id])?)
}

pub fn power_gens_for_factory(conn: &Connection, factory_id: &str) -> Result<Vec<PowerGen>> {
    let mut stmt = conn.prepare(
        "SELECT id, factory_id, generator_id, fuel_item_id, count,
                clock_pct_x100, notes, world_x, world_y,
                created_at, updated_at
         FROM power_gen
         WHERE factory_id = ?
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map([factory_id], |r| {
        let clock_x100: i64 = r.get(5)?;
        Ok(PowerGen {
            id: r.get(0)?,
            factory_id: r.get(1)?,
            generator_id: r.get(2)?,
            fuel_item_id: r.get(3)?,
            count: r.get(4)?,
            clock_pct: clock_pct_from_x100(clock_x100),
            notes: r.get(6)?,
            world_x: r.get(7)?,
            world_y: r.get(8)?,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn power_gens_all(conn: &Connection) -> Result<Vec<PowerGen>> {
    let mut stmt = conn.prepare(
        "SELECT id, factory_id, generator_id, fuel_item_id, count,
                clock_pct_x100, notes, world_x, world_y,
                created_at, updated_at
         FROM power_gen
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        let clock_x100: i64 = r.get(5)?;
        Ok(PowerGen {
            id: r.get(0)?,
            factory_id: r.get(1)?,
            generator_id: r.get(2)?,
            fuel_item_id: r.get(3)?,
            count: r.get(4)?,
            clock_pct: clock_pct_from_x100(clock_x100),
            notes: r.get(6)?,
            world_x: r.get(7)?,
            world_y: r.get(8)?,
            created_at: r.get(9)?,
            updated_at: r.get(10)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows { out.push(r?); }
    Ok(out)
}

pub fn power_gen_set_position(
    conn: &Connection,
    id: &str,
    world_x: f64,
    world_y: f64,
    now: &str,
) -> Result<usize> {
    Ok(conn.execute(
        "UPDATE power_gen SET world_x = ?, world_y = ?, updated_at = ? WHERE id = ?",
        params![world_x, world_y, now, id],
    )?)
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
             VALUES ('f1', 'A', '2026-05-11', '2026-05-11')",
            [],
        ).unwrap();
    }

    #[test]
    fn insert_list_round_trip_round_trips_clock_with_two_decimal_precision() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            power_gen_insert(c, "g1", "f1", "Build_GeneratorCoal_C",
                "Desc_Coal_C", 4, 247.5, None, "2026-05-11").unwrap();
            let rows = power_gens_for_factory(c, "f1").unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].count, 4);
            assert!((rows[0].clock_pct - 247.5).abs() < 0.001);
        });
    }

    #[test]
    fn factory_delete_cascades_to_power_gens() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            power_gen_insert(c, "g1", "f1", "Build_GeneratorCoal_C",
                "Desc_Coal_C", 1, 100.0, None, "2026-05-11").unwrap();
            c.execute("DELETE FROM factory WHERE id = 'f1'", []).unwrap();
            assert!(power_gens_for_factory(c, "f1").unwrap().is_empty());
        });
    }

    #[test]
    fn update_returns_zero_when_missing_one_when_present() {
        let pt = db();
        pt.with(|c| {
            seed(c);
            power_gen_insert(c, "g1", "f1", "Build_GeneratorCoal_C",
                "Desc_Coal_C", 1, 100.0, None, "2026-05-11").unwrap();
            assert_eq!(
                power_gen_update(c, "ghost", 2, 50.0, "Desc_Coal_C", None, "n").unwrap(),
                0,
            );
            assert_eq!(
                power_gen_update(c, "g1", 2, 50.0, "Desc_Coal_C", None, "n").unwrap(),
                1,
            );
        });
    }
}
