use anyhow::Result;
use rusqlite::{Connection, params};

use super::dto::{Factory, FactoryMachine};

fn clock_pct_to_x100(pct: f32) -> i64 {
    (pct * 100.0).round() as i64
}

fn clock_pct_from_x100(v: i64) -> f32 {
    (v as f32) / 100.0
}

// ---- Factory CRUD ----

pub fn factory_insert(
    conn: &Connection,
    id: &str,
    name: &str,
    color: Option<&str>,
    notes: Option<&str>,
    now: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO factory (id, name, color, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![id, name, color, notes, now, now],
    )?;
    Ok(())
}

pub fn factory_rename(conn: &Connection, id: &str, name: &str, now: &str) -> Result<()> {
    conn.execute(
        "UPDATE factory SET name = ?, updated_at = ? WHERE id = ?",
        params![name, now, id],
    )?;
    Ok(())
}

pub fn factory_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM factory WHERE id = ?", [id])?;
    Ok(())
}

pub fn factory_list(conn: &Connection) -> Result<Vec<Factory>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.name, f.world_x, f.world_y, f.color, f.notes,
                f.created_at, f.updated_at,
                (SELECT COUNT(*) FROM factory_machine m WHERE m.factory_id = f.id) AS machine_count
         FROM factory f
         ORDER BY LOWER(f.name)",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Factory {
            id: r.get(0)?,
            name: r.get(1)?,
            world_x: r.get(2)?,
            world_y: r.get(3)?,
            color: r.get(4)?,
            notes: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
            machine_count: r.get(8)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn factory_get(conn: &Connection, id: &str) -> Result<Option<Factory>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.name, f.world_x, f.world_y, f.color, f.notes,
                f.created_at, f.updated_at,
                (SELECT COUNT(*) FROM factory_machine m WHERE m.factory_id = f.id) AS machine_count
         FROM factory f WHERE f.id = ?",
    )?;
    let mut rows = stmt.query_map([id], |r| {
        Ok(Factory {
            id: r.get(0)?,
            name: r.get(1)?,
            world_x: r.get(2)?,
            world_y: r.get(3)?,
            color: r.get(4)?,
            notes: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
            machine_count: r.get(8)?,
        })
    })?;
    Ok(rows.next().transpose()?)
}

// ---- Machine CRUD ----

#[allow(clippy::too_many_arguments)]
pub fn machine_insert(
    conn: &Connection,
    id: &str,
    factory_id: &str,
    building_id: &str,
    recipe_id: &str,
    count: i64,
    clock_pct: f32,
    use_somersloop: bool,
    somersloop_slots_filled: i64,
    power_shard_count: i64,
    now: &str,
) -> Result<()> {
    let clock_x100 = clock_pct_to_x100(clock_pct);
    conn.execute(
        "INSERT INTO factory_machine
            (id, factory_id, building_id, recipe_id, count, clock_pct_x100,
             use_somersloop, somersloop_slots_filled, power_shard_count,
             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id, factory_id, building_id, recipe_id, count, clock_x100,
            if use_somersloop { 1 } else { 0 },
            somersloop_slots_filled,
            power_shard_count,
            now, now,
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn machine_update(
    conn: &Connection,
    id: &str,
    count: i64,
    clock_pct: f32,
    use_somersloop: bool,
    somersloop_slots_filled: i64,
    power_shard_count: i64,
    now: &str,
) -> Result<usize> {
    let clock_x100 = clock_pct_to_x100(clock_pct);
    let affected = conn.execute(
        "UPDATE factory_machine
         SET count = ?, clock_pct_x100 = ?,
             use_somersloop = ?, somersloop_slots_filled = ?,
             power_shard_count = ?, updated_at = ?
         WHERE id = ?",
        params![
            count, clock_x100,
            if use_somersloop { 1 } else { 0 },
            somersloop_slots_filled,
            power_shard_count,
            now, id,
        ],
    )?;
    Ok(affected)
}

pub fn machine_delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM factory_machine WHERE id = ?", [id])?;
    Ok(())
}

pub fn machines_for_factory(conn: &Connection, factory_id: &str) -> Result<Vec<FactoryMachine>> {
    let mut stmt = conn.prepare(
        "SELECT id, factory_id, building_id, recipe_id, count, clock_pct_x100,
                use_somersloop, somersloop_slots_filled, power_shard_count,
                created_at, updated_at
         FROM factory_machine
         WHERE factory_id = ?
         ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([factory_id], |r| {
        let clock_x100: i64 = r.get(5)?;
        let use_som: i64 = r.get(6)?;
        Ok(FactoryMachine {
            id: r.get(0)?,
            factory_id: r.get(1)?,
            building_id: r.get(2)?,
            recipe_id: r.get(3)?,
            count: r.get(4)?,
            clock_pct: clock_pct_from_x100(clock_x100),
            use_somersloop: use_som != 0,
            somersloop_slots_filled: r.get(7)?,
            power_shard_count: r.get(8)?,
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

    #[test]
    fn factory_insert_and_list_and_count_machines() {
        let pt = db();
        pt.with(|c| {
            factory_insert(c, "f1", "Iron Plant", None, None, "2026-05-10T00:00:00Z").unwrap();
            factory_insert(c, "f2", "Copper Plant", None, None, "2026-05-10T00:00:01Z").unwrap();
            machine_insert(c, "m1", "f1", "Build_SmelterMk1_C", "Recipe_IronIngot_C",
                           4, 100.0, false, 0, 0, "2026-05-10T00:00:02Z").unwrap();
            let factories = factory_list(c).unwrap();
            assert_eq!(factories.len(), 2);
            // Sorted by lower(name): "Copper Plant" < "Iron Plant".
            assert_eq!(factories[0].name, "Copper Plant");
            assert_eq!(factories[0].machine_count, 0);
            assert_eq!(factories[1].name, "Iron Plant");
            assert_eq!(factories[1].machine_count, 1);
        });
    }

    #[test]
    fn factory_rename_updates_name_and_timestamp() {
        let pt = db();
        pt.with(|c| {
            factory_insert(c, "f1", "Old", None, None, "2026-05-10T00:00:00Z").unwrap();
            factory_rename(c, "f1", "New", "2026-05-10T01:00:00Z").unwrap();
            let f = factory_get(c, "f1").unwrap().unwrap();
            assert_eq!(f.name, "New");
            assert_eq!(f.updated_at, "2026-05-10T01:00:00Z");
        });
    }

    #[test]
    fn factory_delete_cascades_to_machines() {
        let pt = db();
        pt.with(|c| {
            factory_insert(c, "f1", "X", None, None, "2026-05-10T00:00:00Z").unwrap();
            machine_insert(c, "m1", "f1", "Build_SmelterMk1_C", "Recipe_IronIngot_C",
                           1, 100.0, false, 0, 0, "2026-05-10T00:00:00Z").unwrap();
            factory_delete(c, "f1").unwrap();
            let machines = machines_for_factory(c, "f1").unwrap();
            assert!(machines.is_empty(), "ON DELETE CASCADE should drop machines");
        });
    }

    #[test]
    fn machine_update_round_trips_clock_with_two_decimal_precision() {
        let pt = db();
        pt.with(|c| {
            factory_insert(c, "f1", "X", None, None, "2026-05-10T00:00:00Z").unwrap();
            machine_insert(c, "m1", "f1", "Build_SmelterMk1_C", "Recipe_IronIngot_C",
                           1, 100.0, false, 0, 0, "2026-05-10T00:00:00Z").unwrap();
            machine_update(c, "m1", 3, 247.5, false, 0, 0, "2026-05-10T00:01:00Z").unwrap();
            let machines = machines_for_factory(c, "f1").unwrap();
            assert_eq!(machines.len(), 1);
            assert_eq!(machines[0].count, 3);
            // 247.5% should round-trip exactly through the x100 storage.
            assert!((machines[0].clock_pct - 247.5).abs() < 0.001);
        });
    }

    #[test]
    fn machine_check_constraint_rejects_clock_outside_1_to_250() {
        let pt = db();
        pt.with(|c| {
            factory_insert(c, "f1", "X", None, None, "2026-05-10T00:00:00Z").unwrap();
            // 0% is out of range (CHECK is BETWEEN 100 AND 25000 on x100).
            let too_low = machine_insert(c, "m1", "f1", "B", "R", 1, 0.0, false, 0, 0, "n");
            assert!(too_low.is_err(), "0% clock should be rejected by CHECK");
            // 251% likewise.
            let too_high = machine_insert(c, "m2", "f1", "B", "R", 1, 251.0, false, 0, 0, "n");
            assert!(too_high.is_err(), "251% clock should be rejected by CHECK");
        });
    }
}
