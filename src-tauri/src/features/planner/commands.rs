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

use super::domain::derive_chain_with_options;
use super::dto::{
    ApplyChainPlanInput, ApplyChainPlanResult, ApplyChainToFactoryInput,
    ApplyChainToFactoryResult, DeriveChainInput, DeriveChainResult,
};

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
}
