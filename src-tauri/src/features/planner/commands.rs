use std::collections::HashSet;

use tauri::State;

use crate::features::alts::repo as alts_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::features::resource_nodes::domain as nodes_domain;
use crate::features::resource_nodes::repo as nodes_repo;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::domain::derive_chain;
use super::dto::{DeriveChainInput, DeriveChainResult};

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

    match derive_chain(
        &input.target_item_id,
        input.target_ipm,
        &unlocked,
        &supply,
        &game_data,
    ) {
        Ok(plan) => Ok(DeriveChainResult::Ok { plan }),
        Err(error) => Ok(DeriveChainResult::Err { error }),
    }
}
