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
    ApplyChainPlanInput, ApplyChainPlanResult, DeriveChainInput, DeriveChainResult,
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
