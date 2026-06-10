//! Persistence for production-plan inputs (targets, recipe choices,
//! import cuts, designer layout). The graph itself is never stored —
//! `domain::compute_plan_graph` rebuilds it from these rows plus the
//! bundled game data on every load.

use anyhow::Result;
use rusqlite::{Connection, params};

fn ipm_to_x100(ipm: f32) -> i64 {
    (ipm * 100.0).round() as i64
}

fn ipm_from_x100(v: i64) -> f32 {
    (v as f32) / 100.0
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanTargetRow {
    pub item_id: String,
    pub ipm: f32,
    /// Slice of `ipm` offered to other factories. `None` = not exported.
    pub export_ipm: Option<f32>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanImportRow {
    pub id: String,
    pub item_id: String,
    /// `None` = unsourced input — a future factory will supply this.
    pub source_factory_id: Option<String>,
    pub ipm_cap: Option<f32>,
    pub sort_order: i64,
    /// Logistics link materialized for this import on the last save.
    pub logistics_link_id: Option<String>,
}

// ---- Targets ----

pub fn plan_targets_for_factory(
    conn: &Connection,
    factory_id: &str,
) -> Result<Vec<PlanTargetRow>> {
    let mut stmt = conn.prepare(
        "SELECT item_id, ipm_x100, export_ipm_x100, sort_order
         FROM factory_plan_target
         WHERE factory_id = ?
         ORDER BY sort_order, item_id",
    )?;
    let rows = stmt.query_map([factory_id], |r| {
        Ok(PlanTargetRow {
            item_id: r.get(0)?,
            ipm: ipm_from_x100(r.get(1)?),
            export_ipm: r.get::<_, Option<i64>>(2)?.map(ipm_from_x100),
            sort_order: r.get(3)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Delete-and-reinsert is the upsert here: a plan save always carries
/// the full target list, so partial updates have nothing to preserve.
pub fn plan_targets_replace(
    conn: &Connection,
    factory_id: &str,
    targets: &[PlanTargetRow],
    now: &str,
) -> Result<()> {
    conn.execute(
        "DELETE FROM factory_plan_target WHERE factory_id = ?",
        [factory_id],
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO factory_plan_target
            (id, factory_id, item_id, ipm_x100, export_ipm_x100, sort_order,
             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )?;
    for t in targets {
        stmt.execute(params![
            uuid::Uuid::new_v4().to_string(),
            factory_id,
            t.item_id,
            ipm_to_x100(t.ipm),
            t.export_ipm.map(ipm_to_x100),
            t.sort_order,
            now,
            now,
        ])?;
    }
    Ok(())
}

// ---- Recipe overrides ----

pub fn plan_recipes_for_factory(
    conn: &Connection,
    factory_id: &str,
) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT item_id, recipe_id
         FROM factory_plan_recipe
         WHERE factory_id = ?
         ORDER BY item_id",
    )?;
    let rows = stmt.query_map([factory_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn plan_recipes_replace(
    conn: &Connection,
    factory_id: &str,
    recipes: &[(String, String)],
    now: &str,
) -> Result<()> {
    conn.execute(
        "DELETE FROM factory_plan_recipe WHERE factory_id = ?",
        [factory_id],
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO factory_plan_recipe (factory_id, item_id, recipe_id, updated_at)
         VALUES (?, ?, ?, ?)",
    )?;
    for (item_id, recipe_id) in recipes {
        stmt.execute(params![factory_id, item_id, recipe_id, now])?;
    }
    Ok(())
}

// ---- Imports ----

pub fn plan_imports_for_factory(
    conn: &Connection,
    factory_id: &str,
) -> Result<Vec<PlanImportRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, item_id, source_factory_id, ipm_cap_x100, sort_order, logistics_link_id
         FROM factory_plan_import
         WHERE factory_id = ?
         ORDER BY sort_order, item_id",
    )?;
    let rows = stmt.query_map([factory_id], |r| {
        Ok(PlanImportRow {
            id: r.get(0)?,
            item_id: r.get(1)?,
            source_factory_id: r.get(2)?,
            ipm_cap: r.get::<_, Option<i64>>(3)?.map(ipm_from_x100),
            sort_order: r.get(4)?,
            logistics_link_id: r.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Replace a factory's imports. Caller supplies row ids (uuid) so the
/// save step can attach materialized logistics links to specific rows
/// afterwards via `plan_import_set_link`.
pub fn plan_imports_replace(
    conn: &Connection,
    factory_id: &str,
    imports: &[PlanImportRow],
    now: &str,
) -> Result<()> {
    conn.execute(
        "DELETE FROM factory_plan_import WHERE factory_id = ?",
        [factory_id],
    )?;
    let mut stmt = conn.prepare(
        "INSERT INTO factory_plan_import
            (id, factory_id, item_id, source_factory_id, ipm_cap_x100, sort_order,
             logistics_link_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )?;
    for imp in imports {
        stmt.execute(params![
            imp.id,
            factory_id,
            imp.item_id,
            imp.source_factory_id,
            imp.ipm_cap.map(ipm_to_x100),
            imp.sort_order,
            imp.logistics_link_id,
            now,
            now,
        ])?;
    }
    Ok(())
}

pub fn plan_import_set_link(
    conn: &Connection,
    import_id: &str,
    link_id: Option<&str>,
    now: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE factory_plan_import SET logistics_link_id = ?, updated_at = ? WHERE id = ?",
        params![link_id, now, import_id],
    )?;
    Ok(())
}

/// Logistics links materialized by previous saves of this factory's
/// plan — collected so a re-save can delete and recreate them.
pub fn plan_link_ids_for_factory(conn: &Connection, factory_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT logistics_link_id FROM factory_plan_import
         WHERE factory_id = ? AND logistics_link_id IS NOT NULL",
    )?;
    let rows = stmt.query_map([factory_id], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq)]
pub struct UnsourcedInputRow {
    pub import_id: String,
    pub factory_id: String,
    pub item_id: String,
    pub ipm_cap: Option<f32>,
}

/// `(factory_id, target)` for every factory with a plan — feeds the
/// export-offer listing.
pub fn plan_targets_all(conn: &Connection) -> Result<Vec<(String, PlanTargetRow)>> {
    let mut stmt = conn.prepare(
        "SELECT factory_id, item_id, ipm_x100, export_ipm_x100, sort_order
         FROM factory_plan_target
         ORDER BY factory_id, sort_order",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            PlanTargetRow {
                item_id: r.get(1)?,
                ipm: ipm_from_x100(r.get(2)?),
                export_ipm: r.get::<_, Option<i64>>(3)?.map(ipm_from_x100),
                sort_order: r.get(4)?,
            },
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Every import across the playthrough still waiting for a source
/// factory — the map renders these as pin badges and drag handles.
pub fn unsourced_inputs_all(conn: &Connection) -> Result<Vec<UnsourcedInputRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, factory_id, item_id, ipm_cap_x100
         FROM factory_plan_import
         WHERE source_factory_id IS NULL
         ORDER BY factory_id, sort_order",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(UnsourcedInputRow {
            import_id: r.get(0)?,
            factory_id: r.get(1)?,
            item_id: r.get(2)?,
            ipm_cap: r.get::<_, Option<i64>>(3)?.map(ipm_from_x100),
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Resolve an import row back to its owning factory. Used by the
/// assign-source command to load the right plan.
pub fn plan_import_get(
    conn: &Connection,
    import_id: &str,
) -> Result<Option<(String, PlanImportRow)>> {
    let mut stmt = conn.prepare(
        "SELECT factory_id, id, item_id, source_factory_id, ipm_cap_x100, sort_order,
                logistics_link_id
         FROM factory_plan_import WHERE id = ?",
    )?;
    let mut rows = stmt.query_map([import_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            PlanImportRow {
                id: r.get(1)?,
                item_id: r.get(2)?,
                source_factory_id: r.get(3)?,
                ipm_cap: r.get::<_, Option<i64>>(4)?.map(ipm_from_x100),
                sort_order: r.get(5)?,
                logistics_link_id: r.get(6)?,
            },
        ))
    })?;
    Ok(rows.next().transpose()?)
}

// ---- Layout ----

/// Per-plan solver options (just the SAM gate today).
pub fn plan_option_include_sam(conn: &Connection, factory_id: &str) -> Result<bool> {
    let mut stmt = conn
        .prepare("SELECT include_sam FROM factory_plan_option WHERE factory_id = ?")?;
    let mut rows = stmt.query_map([factory_id], |r| r.get::<_, i64>(0))?;
    match rows.next() {
        Some(v) => Ok(v? != 0),
        None => Ok(false),
    }
}

pub fn plan_option_upsert(
    conn: &Connection,
    factory_id: &str,
    include_sam: bool,
    now: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO factory_plan_option (factory_id, include_sam, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(factory_id) DO UPDATE SET
            include_sam = excluded.include_sam, updated_at = excluded.updated_at",
        params![factory_id, include_sam as i64, now],
    )?;
    Ok(())
}

pub fn plan_layout_upsert(
    conn: &Connection,
    factory_id: &str,
    node_key: &str,
    x: f64,
    y: f64,
    now: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO factory_plan_layout (factory_id, node_key, x, y, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(factory_id, node_key) DO UPDATE SET
            x = excluded.x, y = excluded.y, updated_at = excluded.updated_at",
        params![factory_id, node_key, x, y, now],
    )?;
    Ok(())
}

pub fn plan_layouts_for_factory(
    conn: &Connection,
    factory_id: &str,
) -> Result<Vec<(String, f64, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT node_key, x, y FROM factory_plan_layout WHERE factory_id = ?",
    )?;
    let rows = stmt.query_map([factory_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Drop saved positions for node keys that no longer exist in the
/// recomputed graph, so renamed/removed steps don't leak stale rows.
pub fn plan_layout_prune(
    conn: &Connection,
    factory_id: &str,
    keep_keys: &[String],
) -> Result<()> {
    if keep_keys.is_empty() {
        conn.execute(
            "DELETE FROM factory_plan_layout WHERE factory_id = ?",
            [factory_id],
        )?;
        return Ok(());
    }
    let placeholders = vec!["?"; keep_keys.len()].join(", ");
    let sql = format!(
        "DELETE FROM factory_plan_layout
         WHERE factory_id = ? AND node_key NOT IN ({placeholders})"
    );
    let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(keep_keys.len() + 1);
    p.push(&factory_id);
    for k in keep_keys {
        p.push(k);
    }
    conn.execute(&sql, p.as_slice())?;
    Ok(())
}

// ---- Plan-managed machines ----

/// Remove the machines a previous save materialized from the plan.
/// Manual machines (plan_node_key IS NULL) are deliberately untouched.
pub fn plan_machines_delete(conn: &Connection, factory_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM factory_machine WHERE factory_id = ? AND plan_node_key IS NOT NULL",
        [factory_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::factory::repo as factory_repo;
    use crate::shared::db::playthrough_db::PlaythroughDb;

    const NOW: &str = "2026-06-10T00:00:00Z";

    fn open_db_with_factory(id: &str) -> PlaythroughDb {
        let db = PlaythroughDb::open_in_memory().expect("open in-memory playthrough db");
        db.with(|c| factory_repo::factory_insert(c, id, "Test Factory", None, None, None, NOW))
            .expect("insert factory");
        db
    }

    fn import(id: &str, item: &str, source: Option<&str>) -> PlanImportRow {
        PlanImportRow {
            id: id.to_string(),
            item_id: item.to_string(),
            source_factory_id: source.map(str::to_string),
            ipm_cap: None,
            sort_order: 0,
            logistics_link_id: None,
        }
    }

    #[test]
    fn plan_inputs_round_trip() {
        let db = open_db_with_factory("fac-1");
        db.with(|c| {
            plan_targets_replace(
                c,
                "fac-1",
                &[
                    PlanTargetRow { item_id: "Desc_Cable_C".into(), ipm: 60.0, export_ipm: Some(30.0), sort_order: 0 },
                    PlanTargetRow { item_id: "Desc_Wire_C".into(), ipm: 12.5, export_ipm: None, sort_order: 1 },
                ],
                NOW,
            )?;
            plan_recipes_replace(
                c,
                "fac-1",
                &[("Desc_IronIngot_C".into(), "Recipe_PureIronIngot_C".into())],
                NOW,
            )?;
            plan_imports_replace(
                c,
                "fac-1",
                &[import("imp-1", "Desc_CopperIngot_C", None)],
                NOW,
            )
        })
        .unwrap();

        let targets = db.with(|c| plan_targets_for_factory(c, "fac-1")).unwrap();
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].item_id, "Desc_Cable_C");
        assert!((targets[0].ipm - 60.0).abs() < 1e-3);
        assert!((targets[1].ipm - 12.5).abs() < 1e-3, "x100 storage must keep 12.5 exact");
        assert!((targets[0].export_ipm.unwrap() - 30.0).abs() < 1e-3, "export slice round-trips");
        assert_eq!(targets[1].export_ipm, None);

        let recipes = db.with(|c| plan_recipes_for_factory(c, "fac-1")).unwrap();
        assert_eq!(recipes, vec![("Desc_IronIngot_C".into(), "Recipe_PureIronIngot_C".into())]);

        let imports = db.with(|c| plan_imports_for_factory(c, "fac-1")).unwrap();
        assert_eq!(imports.len(), 1);
        assert_eq!(imports[0].source_factory_id, None, "unsourced import persists as NULL");
    }

    #[test]
    fn replace_overwrites_previous_rows() {
        let db = open_db_with_factory("fac-1");
        db.with(|c| {
            plan_targets_replace(
                c,
                "fac-1",
                &[PlanTargetRow { item_id: "Desc_Cable_C".into(), ipm: 60.0, export_ipm: Some(30.0), sort_order: 0 }],
                NOW,
            )?;
            plan_targets_replace(
                c,
                "fac-1",
                &[PlanTargetRow { item_id: "Desc_Rotor_C".into(), ipm: 10.0, export_ipm: None, sort_order: 0 }],
                NOW,
            )
        })
        .unwrap();
        let targets = db.with(|c| plan_targets_for_factory(c, "fac-1")).unwrap();
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].item_id, "Desc_Rotor_C");
    }

    #[test]
    fn factory_delete_cascades_plan_rows() {
        let db = open_db_with_factory("fac-1");
        db.with(|c| {
            plan_targets_replace(
                c,
                "fac-1",
                &[PlanTargetRow { item_id: "Desc_Cable_C".into(), ipm: 60.0, export_ipm: Some(30.0), sort_order: 0 }],
                NOW,
            )?;
            plan_imports_replace(c, "fac-1", &[import("imp-1", "Desc_Wire_C", None)], NOW)?;
            plan_layout_upsert(c, "fac-1", "recipe:Desc_Cable_C", 10.0, 20.0, NOW)?;
            factory_repo::factory_delete(c, "fac-1")
        })
        .unwrap();
        let targets = db.with(|c| plan_targets_for_factory(c, "fac-1")).unwrap();
        let imports = db.with(|c| plan_imports_for_factory(c, "fac-1")).unwrap();
        let layout = db.with(|c| plan_layouts_for_factory(c, "fac-1")).unwrap();
        assert!(targets.is_empty() && imports.is_empty() && layout.is_empty());
    }

    #[test]
    fn deleting_source_factory_nulls_import_but_keeps_row() {
        let db = open_db_with_factory("fac-consumer");
        db.with(|c| {
            factory_repo::factory_insert(c, "fac-source", "Source", None, None, None, NOW)?;
            plan_imports_replace(
                c,
                "fac-consumer",
                &[import("imp-1", "Desc_IronPlate_C", Some("fac-source"))],
                NOW,
            )?;
            factory_repo::factory_delete(c, "fac-source")
        })
        .unwrap();
        let imports = db.with(|c| plan_imports_for_factory(c, "fac-consumer")).unwrap();
        assert_eq!(imports.len(), 1, "import row must survive source deletion");
        assert_eq!(
            imports[0].source_factory_id, None,
            "source deletion turns the import back into an unsourced input"
        );
    }

    #[test]
    fn layout_prune_keeps_only_listed_keys() {
        let db = open_db_with_factory("fac-1");
        db.with(|c| {
            plan_layout_upsert(c, "fac-1", "recipe:Desc_Cable_C", 1.0, 1.0, NOW)?;
            plan_layout_upsert(c, "fac-1", "recipe:Desc_Wire_C", 2.0, 2.0, NOW)?;
            plan_layout_upsert(c, "fac-1", "raw:Desc_OreCopper_C", 3.0, 3.0, NOW)?;
            plan_layout_prune(c, "fac-1", &["recipe:Desc_Cable_C".to_string()])
        })
        .unwrap();
        let layout = db.with(|c| plan_layouts_for_factory(c, "fac-1")).unwrap();
        assert_eq!(layout.len(), 1);
        assert_eq!(layout[0].0, "recipe:Desc_Cable_C");
    }

    #[test]
    fn plan_machines_delete_spares_manual_machines() {
        let db = open_db_with_factory("fac-1");
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m-manual", "fac-1", "Build_SmelterMk1_C", "Recipe_IngotIron_C",
                1, 100.0, false, 0, 0, None, NOW,
            )?;
            factory_repo::machine_insert(
                c, "m-planned", "fac-1", "Build_ConstructorMk1_C", "Recipe_Cable_C",
                2, 100.0, false, 0, 0, Some("recipe:Desc_Cable_C"), NOW,
            )?;
            plan_machines_delete(c, "fac-1")
        })
        .unwrap();
        let machines = db
            .with(|c| factory_repo::machines_for_factory(c, "fac-1"))
            .unwrap();
        assert_eq!(machines.len(), 1);
        assert_eq!(machines[0].id, "m-manual");
    }
}
