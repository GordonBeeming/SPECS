use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::features::playthrough::state::ActivePlaythrough;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::dto::{ToggleAltRecipeInput, UnlockedAltRecipe};
use super::repo;

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
pub fn list_unlocked_alt_recipes(
    active: State<ActivePlaythrough>,
) -> AppResult<Vec<UnlockedAltRecipe>> {
    let db = require_active(&active)?;
    db.with(|c| repo::alt_list(c).map_err(AppError::from))
}

#[tauri::command]
pub fn toggle_alt_recipe(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: ToggleAltRecipeInput,
) -> AppResult<()> {
    // Confirm the recipe exists AND is actually an alt — toggling a
    // non-alt is a no-op masquerading as a meaningful action and would
    // confuse the alts checklist UI.
    let recipe = game_data
        .recipe(&input.recipe_id)
        .ok_or_else(|| AppError::Invalid(format!("unknown recipe id: {}", input.recipe_id)))?;
    if !recipe.is_alt {
        return Err(AppError::Invalid(format!(
            "recipe {} is not an alt recipe",
            input.recipe_id
        )));
    }
    let db = require_active(&active)?;
    let now = now_iso();
    db.with(|c| {
        if input.unlocked {
            repo::alt_unlock(c, &input.recipe_id, &now).map_err(AppError::from)?;
        } else {
            repo::alt_lock(c, &input.recipe_id).map_err(AppError::from)?;
        }
        Ok(())
    })
}
