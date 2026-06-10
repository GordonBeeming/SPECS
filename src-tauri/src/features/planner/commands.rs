use std::collections::HashSet;

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::features::alts::repo as alts_repo;
use crate::features::factory::repo as factory_repo;
use crate::features::logistics::repo as logistics_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::features::resource_nodes::domain as nodes_domain;
use crate::features::resource_nodes::repo as nodes_repo;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use crate::shared::db::playthrough_db::PlaythroughDb;

use super::domain::compute_plan_graph;
use super::dto::{
    ComputePlanInput, ComputePlanResult, FactoryPlan, PlanImportRowDto, PlanLayoutEntry,
    PlanNode, SavePlanInput, SavePlanResult,
};
use super::repo as plan_repo;

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

fn require_active(
    active: &ActivePlaythrough,
) -> AppResult<crate::shared::db::playthrough_db::PlaythroughDb> {
    let (_id, db) = active
        .snapshot()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    Ok(db)
}

// ---- Production plan (graph-first designer) ----

/// Unlocked alts + claimed raw supply — the two playthrough-state
/// inputs every plan computation needs.
fn gather_plan_context(
    db: &PlaythroughDb,
    game_data: &GameData,
) -> AppResult<(HashSet<String>, std::collections::HashMap<String, f32>)> {
    let unlocked: HashSet<String> = db.with(|c| {
        alts_repo::alt_list(c)
            .map(|v| v.into_iter().map(|u| u.recipe_id).collect())
            .map_err(AppError::from)
    })?;
    let claims = db.with(|c| nodes_repo::claims_all(c).map_err(AppError::from))?;
    let water_groups = db.with(|c| nodes_repo::water_groups_all(c).map_err(AppError::from))?;
    let supply = nodes_domain::available_supply(&claims, &water_groups, game_data);
    Ok((unlocked, supply))
}

/// Remaining export capacity per (factory, item) from one consumer's
/// point of view: each factory's export slice minus what OTHER
/// factories already draw via logistics links. The consumer's own
/// links are excluded so its existing draw doesn't eat its own
/// headroom when its plan recomputes.
fn gather_export_capacity(
    db: &PlaythroughDb,
    beneficiary_factory_id: &str,
) -> AppResult<std::collections::HashMap<(String, String), f32>> {
    let targets = db.with(|c| plan_repo::plan_targets_all(c).map_err(AppError::from))?;
    let links = db.with(|c| logistics_repo::link_list(c).map_err(AppError::from))?;
    let mut drawn: std::collections::HashMap<(String, String), f32> =
        std::collections::HashMap::new();
    for l in links {
        if l.to_factory_id == beneficiary_factory_id {
            continue;
        }
        *drawn
            .entry((l.from_factory_id, l.item_id))
            .or_insert(0.0) += l.items_per_minute;
    }
    let mut out = std::collections::HashMap::new();
    for (fid, t) in targets {
        let Some(export) = t.export_ipm else { continue };
        if export <= 0.0 {
            continue;
        }
        // An export slice larger than the production rate is a wish,
        // not capacity — the plan only materializes machines for
        // `ipm`, so offers clamp to what actually gets made.
        let export = export.min(t.ipm);
        let d = *drawn.get(&(fid.clone(), t.item_id.clone())).unwrap_or(&0.0);
        out.insert((fid, t.item_id), (export - d).max(0.0));
    }
    Ok(out)
}

fn validate_plan_specs(input_targets: &[super::dto::PlanTargetSpec]) -> AppResult<()> {
    for t in input_targets {
        if !t.ipm.is_finite() || t.ipm <= 0.0 {
            return Err(AppError::Invalid(format!(
                "target rate for {} must be a positive number (got {})",
                t.item_id, t.ipm
            )));
        }
    }
    Ok(())
}

fn plan_get_impl(db: &PlaythroughDb, factory_id: &str) -> AppResult<FactoryPlan> {
    let exists = db.with(|c| factory_repo::factory_get(c, factory_id).map_err(AppError::from))?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("factory {factory_id} not found")));
    }
    let targets = db.with(|c| plan_repo::plan_targets_for_factory(c, factory_id).map_err(AppError::from))?;
    let recipes = db.with(|c| plan_repo::plan_recipes_for_factory(c, factory_id).map_err(AppError::from))?;
    let imports = db.with(|c| plan_repo::plan_imports_for_factory(c, factory_id).map_err(AppError::from))?;
    let layout = db.with(|c| plan_repo::plan_layouts_for_factory(c, factory_id).map_err(AppError::from))?;
    let include_sam =
        db.with(|c| plan_repo::plan_option_include_sam(c, factory_id).map_err(AppError::from))?;
    Ok(FactoryPlan {
        factory_id: factory_id.to_string(),
        include_sam,
        targets: targets
            .into_iter()
            .map(|t| super::dto::PlanTargetSpec {
                item_id: t.item_id,
                ipm: t.ipm,
                export_ipm: t.export_ipm,
            })
            .collect(),
        recipe_overrides: recipes.into_iter().collect(),
        imports: imports
            .into_iter()
            .map(|i| PlanImportRowDto {
                id: i.id,
                item_id: i.item_id,
                source_factory_id: i.source_factory_id,
                ipm_cap: i.ipm_cap,
            })
            .collect(),
        layout: layout
            .into_iter()
            .map(|(node_key, x, y)| PlanLayoutEntry { node_key, x, y })
            .collect(),
    })
}

fn plan_save_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
    input: SavePlanInput,
    now: &str,
) -> AppResult<SavePlanResult> {
    validate_plan_specs(&input.targets)?;
    if input.default_link_distance_m < 1 {
        return Err(AppError::Invalid("link distance must be a positive integer".into()));
    }
    let exists =
        db.with(|c| factory_repo::factory_get(c, &input.factory_id).map_err(AppError::from))?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("factory {} not found", input.factory_id)));
    }

    let (unlocked, supply) = gather_plan_context(db, game_data)?;
    let export_capacity = gather_export_capacity(db, &input.factory_id)?;
    // The graph is recomputed server-side from the submitted inputs —
    // a client-supplied graph is never trusted for materialization.
    let graph = compute_plan_graph(
        &input.factory_id,
        &input.targets,
        &unlocked,
        &supply,
        &input.imports,
        &input.recipe_overrides,
        &export_capacity,
        &input.options,
        game_data,
    )
    .map_err(|e| AppError::Invalid(format!("plan does not compute: {e:?}")))?;

    let mut machine_ids: Vec<String> = Vec::new();
    let mut link_ids: Vec<String> = Vec::new();

    db.with(|c| {
        let tx = c.unchecked_transaction()?;

        // Reconcile logistics links from previous saves: delete and
        // recreate, so removed/re-routed imports never leave orphans.
        for old_link in plan_repo::plan_link_ids_for_factory(&tx, &input.factory_id)? {
            logistics_repo::link_delete(&tx, &old_link)?;
        }

        // Persist the plan inputs.
        let target_rows: Vec<plan_repo::PlanTargetRow> = input
            .targets
            .iter()
            .enumerate()
            .map(|(i, t)| plan_repo::PlanTargetRow {
                item_id: t.item_id.clone(),
                ipm: t.ipm,
                export_ipm: t.export_ipm,
                sort_order: i as i64,
            })
            .collect();
        plan_repo::plan_targets_replace(&tx, &input.factory_id, &target_rows, now)?;

        let mut recipe_rows: Vec<(String, String)> = input
            .recipe_overrides
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        recipe_rows.sort();
        plan_repo::plan_recipes_replace(&tx, &input.factory_id, &recipe_rows, now)?;

        let import_rows: Vec<plan_repo::PlanImportRow> = input
            .imports
            .iter()
            .enumerate()
            .map(|(i, s)| plan_repo::PlanImportRow {
                id: Uuid::new_v4().to_string(),
                item_id: s.item_id.clone(),
                source_factory_id: s.source_factory_id.clone(),
                ipm_cap: s.ipm_cap,
                sort_order: i as i64,
                logistics_link_id: None,
            })
            .collect();
        plan_repo::plan_imports_replace(&tx, &input.factory_id, &import_rows, now)?;
        plan_repo::plan_option_upsert(&tx, &input.factory_id, input.options.include_sam, now)?;

        // Regenerate the plan-managed machines. Manual machines
        // (plan_node_key IS NULL) survive untouched.
        plan_repo::plan_machines_delete(&tx, &input.factory_id)?;
        for node in &graph.nodes {
            let PlanNode::Recipe {
                node_key,
                building_id,
                recipe_id,
                machine_count,
                clock_pct,
                ..
            } = node
            else {
                continue;
            };
            let machine_id = Uuid::new_v4().to_string();
            factory_repo::machine_insert(
                &tx,
                &machine_id,
                &input.factory_id,
                building_id,
                recipe_id,
                *machine_count,
                *clock_pct,
                false,
                0,
                0,
                Some(node_key),
                now,
            )?;
            machine_ids.push(machine_id);
        }

        // Materialize one logistics link per positive allocation.
        // Allocations preserve spec order (unsourced specs skipped),
        // so zipping against this item's sourced rows in declared
        // order pairs each link with its originating import row.
        for node in &graph.nodes {
            let PlanNode::Import { item_id, allocations, .. } = node else {
                continue;
            };
            // Self rows ("build it here") never become logistics links —
            // they're the local production marker, not a route.
            let sourced_rows: Vec<&plan_repo::PlanImportRow> = import_rows
                .iter()
                .filter(|r| {
                    &r.item_id == item_id
                        && r.source_factory_id.is_some()
                        && r.source_factory_id.as_deref() != Some(input.factory_id.as_str())
                })
                .collect();
            for (row, alloc) in sourced_rows.iter().zip(allocations.iter()) {
                if alloc.resolved_ipm <= 1e-3 {
                    continue;
                }
                let link_id = Uuid::new_v4().to_string();
                logistics_repo::link_insert(
                    &tx,
                    &link_id,
                    &alloc.source_factory_id,
                    &input.factory_id,
                    item_id,
                    alloc.resolved_ipm,
                    "belt",
                    "null", // transport_plan_json — picker refines later
                    Some(input.default_link_distance_m),
                    None,
                    now,
                )?;
                plan_repo::plan_import_set_link(&tx, &row.id, Some(&link_id), now)?;
                link_ids.push(link_id);
            }
        }

        // Saved node positions for steps that no longer exist are
        // dropped so the layout table doesn't accrete stale rows.
        let keep_keys: Vec<String> =
            graph.nodes.iter().map(|n| n.node_key().to_string()).collect();
        plan_repo::plan_layout_prune(&tx, &input.factory_id, &keep_keys)?;

        tx.commit()?;
        Ok::<_, anyhow::Error>(())
    })
    .map_err(AppError::from)?;

    Ok(SavePlanResult { graph, machine_ids, link_ids })
}

/// Load a factory's saved plan inputs (targets, recipe choices,
/// imports, node layout) so the designer can restore its state.
#[tauri::command]
pub fn factory_plan_get(
    active: State<ActivePlaythrough>,
    factory_id: String,
) -> AppResult<FactoryPlan> {
    let db = require_active(&active)?;
    plan_get_impl(&db, &factory_id)
}

/// Pure computation for live editing — no writes. The designer calls
/// this (debounced) on every edit and renders the returned graph.
#[tauri::command]
pub fn factory_plan_compute(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: ComputePlanInput,
) -> AppResult<ComputePlanResult> {
    validate_plan_specs(&input.targets)?;
    let db = require_active(&active)?;
    let (unlocked, supply) = gather_plan_context(&db, &game_data)?;
    let export_capacity = gather_export_capacity(&db, &input.factory_id)?;
    match compute_plan_graph(
        &input.factory_id,
        &input.targets,
        &unlocked,
        &supply,
        &input.imports,
        &input.recipe_overrides,
        &export_capacity,
        &input.options,
        &game_data,
    ) {
        Ok(graph) => Ok(ComputePlanResult::Ok { graph }),
        Err(error) => Ok(ComputePlanResult::Err { error }),
    }
}

/// Persist the plan and materialize it: plan-managed machines are
/// regenerated and sourced imports become logistics links — all in one
/// transaction. Saving with warnings is fully supported (warn, don't
/// block); only structurally impossible plans are rejected.
#[tauri::command]
pub fn factory_plan_save(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: SavePlanInput,
) -> AppResult<SavePlanResult> {
    let db = require_active(&active)?;
    plan_save_impl(&db, &game_data, input, &now_iso())
}

/// Every unsourced input in the playthrough, for map badges and the
/// "what's still waiting on a source?" planning view.
#[tauri::command]
pub fn list_unsourced_inputs(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<Vec<super::dto::UnsourcedInput>> {
    let db = require_active(&active)?;
    let rows = db.with(|c| plan_repo::unsourced_inputs_all(c).map_err(AppError::from))?;
    Ok(rows
        .into_iter()
        .map(|r| super::dto::UnsourcedInput {
            item_name: game_data
                .item(&r.item_id)
                .map(|i| i.name.clone())
                .unwrap_or_else(|| r.item_id.clone()),
            import_id: r.import_id,
            factory_id: r.factory_id,
            item_id: r.item_id,
            ipm_cap: r.ipm_cap,
        })
        .collect())
}

/// What every factory offers for export, with how much other
/// factories already draw — feeds the designer's source picker.
fn export_offers_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
) -> AppResult<Vec<super::dto::ExportOffer>> {
    let targets = db.with(|c| plan_repo::plan_targets_all(c).map_err(AppError::from))?;
    let factories = db.with(|c| factory_repo::factory_list(c).map_err(AppError::from))?;
    let links = db.with(|c| logistics_repo::link_list(c).map_err(AppError::from))?;
    let factory_names: std::collections::HashMap<String, String> =
        factories.into_iter().map(|f| (f.id, f.name)).collect();

    // Σ outbound link ipm per (factory, item) — what's already spoken for.
    let mut drawn: std::collections::HashMap<(String, String), f32> =
        std::collections::HashMap::new();
    for l in links {
        *drawn
            .entry((l.from_factory_id, l.item_id))
            .or_insert(0.0) += l.items_per_minute;
    }

    let mut by_factory: std::collections::HashMap<String, Vec<super::dto::ExportOfferProduct>> =
        std::collections::HashMap::new();
    for (fid, t) in targets {
        let Some(export) = t.export_ipm else { continue };
        if export <= 0.0 {
            continue;
        }
        // Same clamp as gather_export_capacity: the offer can't exceed
        // what the plan actually produces.
        let export = export.min(t.ipm);
        let drawn_ipm = *drawn
            .get(&(fid.clone(), t.item_id.clone()))
            .unwrap_or(&0.0);
        by_factory.entry(fid).or_default().push(super::dto::ExportOfferProduct {
            item_name: game_data
                .item(&t.item_id)
                .map(|i| i.name.clone())
                .unwrap_or_else(|| t.item_id.clone()),
            item_id: t.item_id,
            export_ipm: export,
            drawn_ipm,
            remaining_ipm: (export - drawn_ipm).max(0.0),
        });
    }

    let mut out: Vec<super::dto::ExportOffer> = by_factory
        .into_iter()
        .map(|(factory_id, products)| super::dto::ExportOffer {
            factory_name: factory_names
                .get(&factory_id)
                .cloned()
                .unwrap_or_else(|| factory_id.clone()),
            factory_id,
            products,
        })
        .collect();
    out.sort_by_key(|o| o.factory_name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub fn list_export_offers(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<Vec<super::dto::ExportOffer>> {
    let db = require_active(&active)?;
    export_offers_impl(&db, &game_data)
}

fn assign_import_source_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
    import_id: &str,
    source_factory_id: &str,
    now: &str,
) -> AppResult<SavePlanResult> {
    let Some((factory_id, _row)) =
        db.with(|c| plan_repo::plan_import_get(c, import_id).map_err(AppError::from))?
    else {
        return Err(AppError::NotFound(format!("input {import_id} not found")));
    };
    if factory_id == source_factory_id {
        return Err(AppError::Invalid(
            "a factory can't supply its own input — pick another factory".into(),
        ));
    }
    // Re-save the whole plan with just this import's source flipped —
    // the save path owns machine/link reconciliation, so the map
    // gesture can't drift from what the designer would have done.
    let plan = plan_get_impl(db, &factory_id)?;
    let imports: Vec<super::dto::PlanImportSpec> = plan
        .imports
        .iter()
        .map(|i| super::dto::PlanImportSpec {
            item_id: i.item_id.clone(),
            source_factory_id: if i.id == import_id {
                Some(source_factory_id.to_string())
            } else {
                i.source_factory_id.clone()
            },
            ipm_cap: i.ipm_cap,
        })
        .collect();
    plan_save_impl(
        db,
        game_data,
        SavePlanInput {
            factory_id,
            targets: plan.targets,
            imports,
            recipe_overrides: plan.recipe_overrides,
            options: super::dto::PlanComputeOptions {
                include_sam: plan.include_sam,
                ..Default::default()
            },
            default_link_distance_m: 1000,
        },
        now,
    )
}

/// Map gesture: drag an unsourced input onto a factory pin to make
/// that factory the source. Equivalent to opening the plan, picking
/// the source, and saving.
#[tauri::command]
pub fn factory_plan_assign_import_source(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    import_id: String,
    source_factory_id: String,
) -> AppResult<SavePlanResult> {
    let db = require_active(&active)?;
    assign_import_source_impl(&db, &game_data, &import_id, &source_factory_id, &now_iso())
}

/// Persist a designer node position (mirrors `set_machine_layout`).
#[tauri::command]
pub fn factory_plan_layout_set(
    active: State<ActivePlaythrough>,
    factory_id: String,
    node_key: String,
    x: f64,
    y: f64,
) -> AppResult<()> {
    let db = require_active(&active)?;
    db.with(|c| {
        plan_repo::plan_layout_upsert(c, &factory_id, &node_key, x, y, &now_iso())
            .map_err(AppError::from)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn open_test_db() -> PlaythroughDb {
        // Anonymous in-memory DB with refinery migrations applied.
        PlaythroughDb::open_in_memory().expect("open in-memory playthrough db")
    }

    fn insert_test_factory(db: &PlaythroughDb, id: &str, name: &str) {
        db.with(|c| {
            factory_repo::factory_insert(c, id, name, None, None, None, "2026-05-21T00:00:00Z")
        })
        .expect("insert factory");
    }

    // ---------- factory_plan_save / get tests ----------

    use crate::features::planner::dto::{PlanImportSpec, PlanTargetSpec};

    const NOW: &str = "2026-06-10T00:00:00Z";

    fn save_input(factory_id: &str, targets: Vec<PlanTargetSpec>, imports: Vec<PlanImportSpec>) -> SavePlanInput {
        SavePlanInput {
            factory_id: factory_id.to_string(),
            targets,
            imports,
            recipe_overrides: Default::default(),
            options: Default::default(),
            default_link_distance_m: 1000,
        }
    }

    fn cable_target() -> Vec<PlanTargetSpec> {
        vec![PlanTargetSpec { item_id: "Desc_Cable_C".into(), ipm: 60.0, export_ipm: None }]
    }

    #[test]
    fn plan_save_materializes_machines_and_round_trips_inputs() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "Cables v1");

        let result = plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW)
            .expect("save must succeed even with zero claimed supply (warn, don't block)");
        assert!(!result.machine_ids.is_empty());
        assert!(result.link_ids.is_empty(), "no sourced imports → no links");
        assert!(
            result.graph.warnings.iter().any(|w| matches!(
                w,
                crate::features::planner::dto::PlanWarning::RawShort { .. }
            )),
            "zero supply should surface as a warning, not an error"
        );

        // Machines are tagged with their node keys.
        let machines = db
            .with(|c| factory_repo::machines_for_factory(c, "fac-1"))
            .unwrap();
        assert_eq!(machines.len(), result.machine_ids.len());

        // The plan round-trips.
        let plan = plan_get_impl(&db, "fac-1").unwrap();
        assert_eq!(plan.targets.len(), 1);
        assert_eq!(plan.targets[0].item_id, "Desc_Cable_C");
    }

    #[test]
    fn plan_resave_regenerates_plan_machines_but_keeps_manual_ones() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "Cables v1");

        // A manual machine added outside the plan.
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m-manual", "fac-1", "Build_SmelterMk1_C", "Recipe_IngotIron_C",
                1, 100.0, false, 0, 0, None, NOW,
            )
        })
        .unwrap();

        let first = plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW).unwrap();
        let second = plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW).unwrap();

        let machines = db
            .with(|c| factory_repo::machines_for_factory(c, "fac-1"))
            .unwrap();
        // manual + the regenerated plan machines, never the first batch too.
        assert_eq!(machines.len(), 1 + second.machine_ids.len());
        assert!(machines.iter().any(|m| m.id == "m-manual"), "manual machine must survive");
        for id in &first.machine_ids {
            assert!(
                !machines.iter().any(|m| &m.id == id),
                "first-save machines must be regenerated away"
            );
        }
    }

    /// Give a factory a Wire plan that exports 150/min — uncapped
    /// sources only deliver what the supplier actually offers, so
    /// tests that expect a materialized link need a real offer.
    fn plan_wire_exports(db: &PlaythroughDb, gd: &GameData, factory_id: &str) {
        plan_save_impl(
            db,
            gd,
            save_input(
                factory_id,
                vec![PlanTargetSpec {
                    item_id: "Desc_Wire_C".into(),
                    ipm: 150.0,
                    export_ipm: Some(150.0),
                }],
                vec![],
            ),
            NOW,
        )
        .expect("supplier plan saves");
    }

    #[test]
    fn plan_save_creates_links_for_sourced_imports_and_reconciles_on_resave() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-cables", "Cables v1");
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_wire_exports(&db, &gd, "fac-wire");

        let sourced = vec![PlanImportSpec {
            item_id: "Desc_Wire_C".into(),
            source_factory_id: Some("fac-wire".into()),
            ipm_cap: None,
        }];
        let first =
            plan_save_impl(&db, &gd, save_input("fac-cables", cable_target(), sourced.clone()), NOW)
                .unwrap();
        assert_eq!(first.link_ids.len(), 1, "one sourced import → one link");

        let links = db.with(|c| logistics_repo::link_list(c)).unwrap();
        let link = links.iter().find(|l| l.id == first.link_ids[0]).unwrap();
        assert_eq!(link.from_factory_id, "fac-wire");
        assert_eq!(link.to_factory_id, "fac-cables");
        assert_eq!(link.item_id, "Desc_Wire_C");
        assert!((link.items_per_minute - 120.0).abs() < 0.5, "cable @60 needs ~120 wire");

        // Re-save with the import now UNSOURCED: the old link must go.
        let unsourced = vec![PlanImportSpec {
            item_id: "Desc_Wire_C".into(),
            source_factory_id: None,
            ipm_cap: None,
        }];
        let second =
            plan_save_impl(&db, &gd, save_input("fac-cables", cable_target(), unsourced), NOW)
                .unwrap();
        assert!(second.link_ids.is_empty());
        let links_after = db.with(|c| logistics_repo::link_list(c)).unwrap();
        assert!(
            links_after.iter().all(|l| l.id != first.link_ids[0]),
            "previous plan link must be reconciled away"
        );

        // The unsourced import persists as a row with NULL source.
        let plan = plan_get_impl(&db, "fac-cables").unwrap();
        assert_eq!(plan.imports.len(), 1);
        assert_eq!(plan.imports[0].source_factory_id, None);
    }

    #[test]
    fn export_offers_clamp_to_actual_production() {
        // export_ipm > ipm is saveable (warn, don't block) but the
        // offer must not promise more than the plan produces.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-wire",
                vec![PlanTargetSpec {
                    item_id: "Desc_Wire_C".into(),
                    ipm: 100.0,
                    export_ipm: Some(500.0),
                }],
                vec![],
            ),
            NOW,
        )
        .unwrap();

        let offers = export_offers_impl(&db, &gd).unwrap();
        let wire = offers
            .iter()
            .find(|o| o.factory_id == "fac-wire")
            .and_then(|o| o.products.iter().find(|p| p.item_id == "Desc_Wire_C"))
            .expect("wire offer");
        assert!((wire.export_ipm - 100.0).abs() < 1e-3, "offer clamps to production");
        assert!((wire.remaining_ipm - 100.0).abs() < 1e-3);

        let capacity = gather_export_capacity(&db, "fac-consumer").unwrap();
        let cap = capacity
            .get(&("fac-wire".to_string(), "Desc_Wire_C".to_string()))
            .copied()
            .unwrap_or(0.0);
        assert!((cap - 100.0).abs() < 1e-3, "capacity clamps to production, got {cap}");
    }

    #[test]
    fn plan_save_unknown_factory_is_not_found() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        let err = plan_save_impl(&db, &gd, save_input("fac-missing", cable_target(), vec![]), NOW)
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn plan_save_rejects_nonpositive_target_rate() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "X");
        let err = plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-1",
                vec![PlanTargetSpec { item_id: "Desc_Cable_C".into(), ipm: 0.0, export_ipm: None }],
                vec![],
            ),
            NOW,
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn assign_import_source_links_the_unsourced_input() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-cables", "Cables v1");
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_wire_exports(&db, &gd, "fac-wire");

        // Save a plan with an unsourced Wire input.
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-cables",
                cable_target(),
                vec![PlanImportSpec {
                    item_id: "Desc_Wire_C".into(),
                    source_factory_id: None,
                    ipm_cap: None,
                }],
            ),
            NOW,
        )
        .unwrap();

        let unsourced = db.with(|c| plan_repo::unsourced_inputs_all(c)).unwrap();
        assert_eq!(unsourced.len(), 1);
        assert_eq!(unsourced[0].factory_id, "fac-cables");

        // Drag onto the wire factory.
        let result = assign_import_source_impl(
            &db,
            &gd,
            &unsourced[0].import_id,
            "fac-wire",
            NOW,
        )
        .unwrap();
        assert_eq!(result.link_ids.len(), 1, "assigning a source materializes the link");

        let after = db.with(|c| plan_repo::unsourced_inputs_all(c)).unwrap();
        assert!(after.is_empty(), "the input is no longer unsourced");

        let links = db.with(|c| logistics_repo::link_list(c)).unwrap();
        let link = links.iter().find(|l| l.id == result.link_ids[0]).unwrap();
        assert_eq!(link.from_factory_id, "fac-wire");
        assert_eq!(link.to_factory_id, "fac-cables");
    }

    #[test]
    fn assign_import_source_rejects_self_supply() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-cables", "Cables v1");
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-cables",
                cable_target(),
                vec![PlanImportSpec {
                    item_id: "Desc_Wire_C".into(),
                    source_factory_id: None,
                    ipm_cap: None,
                }],
            ),
            NOW,
        )
        .unwrap();
        let unsourced = db.with(|c| plan_repo::unsourced_inputs_all(c)).unwrap();
        let err = assign_import_source_impl(&db, &gd, &unsourced[0].import_id, "fac-cables", NOW)
            .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn plan_layout_survives_save_and_prunes_stale_keys() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "Cables v1");
        plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW).unwrap();

        db.with(|c| {
            plan_repo::plan_layout_upsert(c, "fac-1", "recipe:Desc_Cable_C", 5.0, 6.0, NOW)?;
            plan_repo::plan_layout_upsert(c, "fac-1", "recipe:Desc_GoneItem_C", 1.0, 1.0, NOW)
        })
        .unwrap();

        plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW).unwrap();
        let plan = plan_get_impl(&db, "fac-1").unwrap();
        assert!(
            plan.layout.iter().any(|l| l.node_key == "recipe:Desc_Cable_C"),
            "live node keeps its position"
        );
        assert!(
            plan.layout.iter().all(|l| l.node_key != "recipe:Desc_GoneItem_C"),
            "stale node key must be pruned on save"
        );
    }
}
