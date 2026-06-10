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

use super::domain::{compute_plan_graph, derive_chain_with_options};
use super::dto::{
    ApplyChainPlanInput, ApplyChainPlanResult, ApplyChainToFactoryInput,
    ApplyChainToFactoryResult, ComputePlanInput, ComputePlanResult, DeriveChainInput,
    DeriveChainResult, FactoryPlan, PlanImportRowDto, PlanLayoutEntry, PlanNode,
    SavePlanInput, SavePlanResult,
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

#[tauri::command]
pub fn planner_derive_chain(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: DeriveChainInput,
) -> AppResult<DeriveChainResult> {
    if !input.target_ipm.is_finite() || input.target_ipm <= 0.0 {
        return Err(AppError::Invalid(format!(
            "target ipm must be a positive number (got {})",
            input.target_ipm
        )));
    }
    let db = require_active(&active)?;
    // Unlocked alts (so the planner can use them) come from the alts
    // slice; the available supply pool comes from the resource_nodes
    // slice. The planner stays pure — both inputs are gathered here
    // and handed in.
    let unlocked: HashSet<String> = db.with(|c| {
        alts_repo::alt_list(c)
            .map(|v| v.into_iter().map(|u| u.recipe_id).collect())
            .map_err(AppError::from)
    })?;
    let claims = db.with(|c| nodes_repo::claims_all(c).map_err(AppError::from))?;
    let supply = nodes_domain::available_supply(&claims, &game_data);

    match derive_chain_with_options(
        &input.target_item_id,
        input.target_ipm,
        &unlocked,
        &supply,
        &input.sources,
        &input.recipes,
        &game_data,
        input.bypass_supply,
    ) {
        Ok(plan) => Ok(DeriveChainResult::Ok { plan }),
        Err(error) => Ok(DeriveChainResult::Err { error }),
    }
}

/// Materialise a chain plan into the playthrough — one factory per
/// stage, one machine per factory, logistics links between consecutive
/// stages. All inside a single SQLite transaction so a mid-way failure
/// rolls back cleanly (no half-built playthrough state).
///
/// Returns the created factory + link ids in stage order so the React
/// side can push them through the undo store as a single grouped
/// action (one ⌘Z reverses the whole materialization).
#[tauri::command]
pub fn apply_chain_plan(
    active: State<ActivePlaythrough>,
    input: ApplyChainPlanInput,
) -> AppResult<ApplyChainPlanResult> {
    let db = require_active(&active)?;
    if input.default_link_distance_m < 1 {
        return Err(AppError::Invalid(
            "link distance must be a positive integer".into(),
        ));
    }
    let prefix = if input.naming_prefix.trim().is_empty() {
        input.plan.target_item_name.clone()
    } else {
        input.naming_prefix.trim().to_string()
    };

    let mut factory_ids: Vec<String> = Vec::with_capacity(input.plan.stages.len());
    let mut link_ids: Vec<String> = Vec::new();

    db.with(|c| {
        let tx = c.unchecked_transaction()?;
        let now = now_iso();

        // Pre-allocate factory ids so the inter-stage links can
        // reference upstream factories before they're inserted (we
        // still insert in stage order — leaves first — so the FK
        // resolves at link-insert time).
        for _ in &input.plan.stages {
            factory_ids.push(Uuid::new_v4().to_string());
        }

        for (idx, stage) in input.plan.stages.iter().enumerate() {
            let factory_id = &factory_ids[idx];
            let name = format!("{} — {}", prefix, stage.recipe_name);
            factory_repo::factory_insert(
                &tx, factory_id, &name, None, None, None, &now,
            )?;
            let machine_id = Uuid::new_v4().to_string();
            factory_repo::machine_insert(
                &tx,
                &machine_id,
                factory_id,
                &stage.building_id,
                &stage.recipe_id,
                stage.machine_count,
                stage.clock_pct,
                false,
                0,
                0,
                None,
                &now,
            )?;

            // Wire each input back to the upstream stage that
            // produces it. Inputs that come from raw resources have
            // no upstream stage — they need a node binding (future
            // commit) or a manual import; skip them here.
            for input_flow in &stage.inputs {
                let upstream_idx = input
                    .plan
                    .stages
                    .iter()
                    .position(|s| s.output_item_id == input_flow.item_id);
                let Some(up_idx) = upstream_idx else {
                    continue;
                };
                let upstream_id = &factory_ids[up_idx];
                let link_id = Uuid::new_v4().to_string();
                logistics_repo::link_insert(
                    &tx,
                    &link_id,
                    upstream_id,
                    factory_id,
                    &input_flow.item_id,
                    input_flow.per_minute,
                    "belt",
                    "null", // transport_plan_json — picker will refine
                    Some(input.default_link_distance_m),
                    None,
                    &now,
                )?;
                link_ids.push(link_id);
            }
        }

        tx.commit()?;
        Ok::<_, anyhow::Error>(())
    })
    .map_err(AppError::from)?;

    Ok(ApplyChainPlanResult { factory_ids, link_ids })
}

/// Materialise a chain plan into an existing factory — one machine
/// per stage, plus one logistics link per `ResolvedImport` from the
/// declared source factory into this one. No new factories are created
/// here; intra-factory item flow shows up via the recipe-edge heuristic
/// in `FactoryGraphView`. One SQLite transaction so a poison rolls
/// everything back.
#[tauri::command]
pub fn apply_chain_to_factory(
    active: State<ActivePlaythrough>,
    input: ApplyChainToFactoryInput,
) -> AppResult<ApplyChainToFactoryResult> {
    let db = require_active(&active)?;
    if input.default_link_distance_m < 1 {
        return Err(AppError::Invalid(
            "link distance must be a positive integer".into(),
        ));
    }
    // Friendly error if the factory id is stale (e.g. the user deleted
    // the factory in another window between derive and apply). Without
    // this the SQLite FK check still fails the tx, but the user-facing
    // message is opaque.
    let exists = db
        .with(|c| factory_repo::factory_get(c, &input.factory_id).map_err(AppError::from))?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!(
            "factory {} not found",
            input.factory_id
        )));
    }

    let mut machine_ids: Vec<String> = Vec::with_capacity(input.plan.stages.len());
    let mut link_ids: Vec<String> = Vec::with_capacity(input.plan.imports.len());

    db.with(|c| {
        let tx = c.unchecked_transaction()?;
        let now = now_iso();

        for stage in &input.plan.stages {
            let machine_id = Uuid::new_v4().to_string();
            factory_repo::machine_insert(
                &tx,
                &machine_id,
                &input.factory_id,
                &stage.building_id,
                &stage.recipe_id,
                stage.machine_count,
                stage.clock_pct,
                false,
                0,
                0,
                None,
                &now,
            )?;
            machine_ids.push(machine_id);
        }

        for import in &input.plan.imports {
            let link_id = Uuid::new_v4().to_string();
            logistics_repo::link_insert(
                &tx,
                &link_id,
                &import.source_factory_id,
                &input.factory_id,
                &import.item_id,
                import.resolved_ipm,
                "belt",
                "null",
                Some(input.default_link_distance_m),
                None,
                &now,
            )?;
            link_ids.push(link_id);
        }

        tx.commit()?;
        Ok::<_, anyhow::Error>(())
    })
    .map_err(AppError::from)?;

    Ok(ApplyChainToFactoryResult {
        machine_ids,
        link_ids,
    })
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
    let supply = nodes_domain::available_supply(&claims, game_data);
    Ok((unlocked, supply))
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
    Ok(FactoryPlan {
        factory_id: factory_id.to_string(),
        targets: targets
            .into_iter()
            .map(|t| super::dto::PlanTargetSpec { item_id: t.item_id, ipm: t.ipm })
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
    // The graph is recomputed server-side from the submitted inputs —
    // a client-supplied graph is never trusted for materialization.
    let graph = compute_plan_graph(
        &input.targets,
        &unlocked,
        &supply,
        &input.imports,
        &input.recipe_overrides,
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
            let sourced_rows: Vec<&plan_repo::PlanImportRow> = import_rows
                .iter()
                .filter(|r| &r.item_id == item_id && r.source_factory_id.is_some())
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
    match compute_plan_graph(
        &input.targets,
        &unlocked,
        &supply,
        &input.imports,
        &input.recipe_overrides,
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
    use crate::features::planner::dto::{
        ChainPlan, ChainStage, RecipeFlow, ResolvedImport,
    };
    use crate::shared::db::playthrough_db::PlaythroughDb;
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

    fn synthetic_plan(stage_recipes: &[(&str, &str, &str)]) -> ChainPlan {
        // Each (recipe_id, building_id, output_item_id) tuple becomes
        // one synthetic ChainStage. Pure DTO — no derive_chain needed.
        let stages = stage_recipes
            .iter()
            .map(|(recipe_id, building_id, output_item_id)| ChainStage {
                recipe_id: (*recipe_id).to_string(),
                recipe_name: (*recipe_id).to_string(),
                building_id: (*building_id).to_string(),
                building_name: (*building_id).to_string(),
                output_item_id: (*output_item_id).to_string(),
                output_ipm: 60.0,
                machine_count: 1,
                clock_pct: 100.0,
                inputs: vec![],
                outputs: vec![RecipeFlow {
                    item_id: (*output_item_id).to_string(),
                    item_name: (*output_item_id).to_string(),
                    per_minute: 60.0,
                }],
                is_alt: false,
                power_mw: 4.0,
            })
            .collect();
        ChainPlan {
            target_item_id: stage_recipes
                .last()
                .map(|(_, _, o)| (*o).to_string())
                .unwrap_or_default(),
            target_item_name: "target".into(),
            target_ipm: 60.0,
            stages,
            total_machines: stage_recipes.len() as i64,
            total_power_mw: 4.0 * stage_recipes.len() as f32,
            raw_demand: Default::default(),
            imports: vec![],
            pinned_demand: Default::default(),
        }
    }

    fn apply_helper(
        db: Arc<PlaythroughDb>,
        factory_id: &str,
        plan: ChainPlan,
    ) -> AppResult<ApplyChainToFactoryResult> {
        // Re-implementation of apply_chain_to_factory without the
        // Tauri State wrapper so it can be unit-tested directly.
        if plan.imports.is_empty() && plan.stages.is_empty() {
            return Ok(ApplyChainToFactoryResult {
                machine_ids: vec![],
                link_ids: vec![],
            });
        }
        let exists = db
            .with(|c| factory_repo::factory_get(c, factory_id).map_err(AppError::from))?;
        if exists.is_none() {
            return Err(AppError::NotFound(format!("factory {factory_id} not found")));
        }
        let mut machine_ids: Vec<String> = Vec::with_capacity(plan.stages.len());
        let mut link_ids: Vec<String> = Vec::with_capacity(plan.imports.len());
        db.with(|c| {
            let tx = c.unchecked_transaction()?;
            let now = "2026-05-21T00:00:00Z";
            for stage in &plan.stages {
                let mid = Uuid::new_v4().to_string();
                factory_repo::machine_insert(
                    &tx,
                    &mid,
                    factory_id,
                    &stage.building_id,
                    &stage.recipe_id,
                    stage.machine_count,
                    stage.clock_pct,
                    false,
                    0,
                    0,
                    None,
                    now,
                )?;
                machine_ids.push(mid);
            }
            for import in &plan.imports {
                let lid = Uuid::new_v4().to_string();
                logistics_repo::link_insert(
                    &tx,
                    &lid,
                    &import.source_factory_id,
                    factory_id,
                    &import.item_id,
                    import.resolved_ipm,
                    "belt",
                    "null",
                    Some(1000),
                    None,
                    now,
                )?;
                link_ids.push(lid);
            }
            tx.commit()?;
            Ok::<_, anyhow::Error>(())
        })
        .map_err(AppError::from)?;
        Ok(ApplyChainToFactoryResult { machine_ids, link_ids })
    }

    #[test]
    fn apply_into_existing_factory_inserts_one_machine_per_stage() {
        let db = Arc::new(open_test_db());
        insert_test_factory(&db, "fac-target", "Frames v1");
        let plan = synthetic_plan(&[
            ("Recipe_IngotIron_C", "Desc_SmelterMk1_C", "Desc_IronIngot_C"),
            ("Recipe_IronPlate_C", "Desc_ConstructorMk1_C", "Desc_IronPlate_C"),
        ]);
        let result = apply_helper(db.clone(), "fac-target", plan).unwrap();
        assert_eq!(result.machine_ids.len(), 2);
        assert!(result.link_ids.is_empty(), "no imports → no links");

        // Verify all machines belong to the target factory.
        let machines = db
            .with(|c| crate::features::factory::repo::machines_for_factory(c, "fac-target"))
            .unwrap();
        assert_eq!(machines.len(), 2);
    }

    #[test]
    fn apply_creates_one_logistics_link_per_resolved_import() {
        let db = Arc::new(open_test_db());
        insert_test_factory(&db, "fac-plates", "Plates v1");
        insert_test_factory(&db, "fac-frames", "Frames v1");
        let mut plan = synthetic_plan(&[(
            "Recipe_ModularFrame_C",
            "Desc_AssemblerMk1_C",
            "Desc_ModularFrame_C",
        )]);
        plan.imports = vec![ResolvedImport {
            item_id: "Desc_IronPlate_C".into(),
            item_name: "Iron Plate".into(),
            source_factory_id: "fac-plates".into(),
            resolved_ipm: 30.0,
        }];
        let result = apply_helper(db.clone(), "fac-frames", plan).unwrap();
        assert_eq!(result.link_ids.len(), 1);

        let links = db
            .with(|c| crate::features::logistics::repo::link_list(c))
            .unwrap();
        let link = links.iter().find(|l| l.id == result.link_ids[0]).unwrap();
        assert_eq!(link.from_factory_id, "fac-plates");
        assert_eq!(link.to_factory_id, "fac-frames");
        assert_eq!(link.item_id, "Desc_IronPlate_C");
        assert!((link.items_per_minute - 30.0).abs() < 0.05);
    }

    #[test]
    fn apply_with_unknown_factory_id_returns_not_found() {
        let db = Arc::new(open_test_db());
        let plan = synthetic_plan(&[(
            "Recipe_IngotIron_C",
            "Desc_SmelterMk1_C",
            "Desc_IronIngot_C",
        )]);
        let err = apply_helper(db.clone(), "fac-missing", plan).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn apply_rolls_back_on_partial_failure() {
        // Trigger a tx failure by handing in an import whose
        // source factory FK doesn't exist; the link insert fails,
        // and the whole tx rolls back — including the machine inserts.
        let db = Arc::new(open_test_db());
        insert_test_factory(&db, "fac-frames", "Frames v1");
        let mut plan = synthetic_plan(&[(
            "Recipe_ModularFrame_C",
            "Desc_AssemblerMk1_C",
            "Desc_ModularFrame_C",
        )]);
        plan.imports = vec![ResolvedImport {
            item_id: "Desc_IronPlate_C".into(),
            item_name: "Iron Plate".into(),
            source_factory_id: "fac-does-not-exist".into(),
            resolved_ipm: 30.0,
        }];
        let res = apply_helper(db.clone(), "fac-frames", plan);
        assert!(res.is_err(), "FK violation should fail the apply");
        let machines = db
            .with(|c| crate::features::factory::repo::machines_for_factory(c, "fac-frames"))
            .unwrap();
        assert!(
            machines.is_empty(),
            "machines should be rolled back when the link insert fails"
        );
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
            default_link_distance_m: 1000,
        }
    }

    fn cable_target() -> Vec<PlanTargetSpec> {
        vec![PlanTargetSpec { item_id: "Desc_Cable_C".into(), ipm: 60.0 }]
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

    #[test]
    fn plan_save_creates_links_for_sourced_imports_and_reconciles_on_resave() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-cables", "Cables v1");
        insert_test_factory(&db, "fac-wire", "Wire farm");

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
                vec![PlanTargetSpec { item_id: "Desc_Cable_C".into(), ipm: 0.0 }],
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
