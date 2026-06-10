use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::features::playthrough::state::ActivePlaythrough;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::domain::{
    BudgetAssumption, extractor_output_ipm, resource_budget, water_group_output_ipm,
};
use super::dto::{
    ResourceBudget, ResourceNodeClaim, ResourceNodeRow, SetNodeClaimInput,
    SetWaterExtractorGroupInput, WaterExtractorGroup,
};
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

fn validate_clock(clock_pct: f32) -> AppResult<()> {
    // Mirror the factory_machine / power_gen clamps so the same validator
    // text shows up everywhere a clock can be edited.
    if !clock_pct.is_finite() || !(1.0..=250.0).contains(&clock_pct) {
        return Err(AppError::Invalid(format!(
            "clock must be between 1% and 250% (got {clock_pct})"
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn list_resource_nodes(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<Vec<ResourceNodeRow>> {
    let db = require_active(&active)?;
    let claims = db.with(|c| repo::claims_all(c).map_err(AppError::from))?;
    let mut out = Vec::with_capacity(game_data.nodes().len());
    for node in game_data.nodes() {
        let claim_row = claims.get(&node.id);
        let item_name = game_data
            .item(&node.resource_item_id)
            .map(|i| i.name.clone())
            // Geysers carry the synthetic `Desc_Geyser_C` id that isn't
            // in the item dataset; fall back to a friendly label rather
            // than `None`.
            .unwrap_or_else(|| match node.resource_item_id.as_str() {
                "Desc_Geyser_C" => "Geothermal Vent".to_string(),
                other => other.to_string(),
            });
        let ipm = claim_row
            .map(|c| extractor_output_ipm(node, c.miner_id.as_deref(), c.clock_pct, &game_data))
            .unwrap_or(0.0);
        out.push(ResourceNodeRow {
            id: node.id.clone(),
            resource_item_id: node.resource_item_id.clone(),
            resource_item_name: item_name,
            purity: node.purity,
            kind: node.kind,
            x: node.x,
            y: node.y,
            z: node.z,
            core_id: node.core_id.clone(),
            claim: claim_row.map(|r| ResourceNodeClaim {
                miner_id: r.miner_id.clone(),
                clock_pct: r.clock_pct,
                factory_id: r.factory_id.clone(),
                notes: r.notes.clone(),
                created_at: r.created_at.clone(),
                updated_at: r.updated_at.clone(),
            }),
            items_per_minute: ipm,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn set_node_claim(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: SetNodeClaimInput,
) -> AppResult<()> {
    validate_clock(input.clock_pct)?;
    // Validate node id against the catalog so a typo doesn't silently
    // create an orphan row.
    let Some(node) = game_data.node(&input.node_id) else {
        return Err(AppError::Invalid(format!(
            "unknown node id: {}",
            input.node_id
        )));
    };
    if let Some(miner_id) = input.miner_id.as_deref() {
        match node.kind {
            crate::shared::gamedata::types::NodeKind::MinerNode => {
                if !game_data.miners().iter().any(|m| m.id == miner_id) {
                    return Err(AppError::Invalid(format!(
                        "unknown miner building: {miner_id}"
                    )));
                }
            }
            crate::shared::gamedata::types::NodeKind::FrackingWell => {
                // Resource Well Extractor — single accepted id. Reject
                // miners on wells so the UI's wrong-picker bugs surface
                // as errors instead of producing zero ipm later.
                if miner_id != "Build_FrackingSmasher_C" {
                    return Err(AppError::Invalid(format!(
                        "fracking wells only accept Build_FrackingSmasher_C (got {miner_id})"
                    )));
                }
            }
            crate::shared::gamedata::types::NodeKind::Geyser => {
                return Err(AppError::Invalid(
                    "geysers feed geothermal generators — track them in the power slice".into(),
                ));
            }
        }
    }
    let db = require_active(&active)?;
    let now = now_iso();
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    let trimmed_factory = input.factory_id.as_deref().map(str::trim).map(str::to_string);
    db.with(|c| {
        repo::claim_upsert(
            c,
            &input.node_id,
            input.miner_id.as_deref(),
            input.clock_pct,
            trimmed_factory.as_deref(),
            trimmed_notes.as_deref(),
            &now,
        )
        .map_err(AppError::from)
    })
}

/// Whole-map resource budget: per resource, what the world could still
/// yield at the stated assumption vs what's claimed/bound already.
/// Defaults to "best miner at the current tier @ 100%".
#[tauri::command]
pub fn get_resource_budget(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    assumption: Option<BudgetAssumption>,
) -> AppResult<ResourceBudget> {
    let db = require_active(&active)?;
    let claims = db.with(|c| repo::claims_all(c).map_err(AppError::from))?;
    let (current_tier, _progress) = db.with(|c| {
        crate::features::playthrough::repo::progress_get(c).map_err(AppError::from)
    })?;
    let tier: u8 = current_tier.clamp(0, u8::MAX as i64) as u8;
    Ok(resource_budget(
        &claims,
        &game_data,
        tier,
        assumption.unwrap_or(BudgetAssumption::CurrentTierBest),
    ))
}

#[tauri::command]
pub fn clear_node_claim(active: State<ActivePlaythrough>, node_id: String) -> AppResult<()> {
    let db = require_active(&active)?;
    let affected = db.with(|c| repo::claim_clear(c, &node_id).map_err(AppError::from))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("no claim on node {node_id}")));
    }
    Ok(())
}

// ---- Water extractor groups ----

fn group_to_dto(row: repo::WaterGroupRow) -> WaterExtractorGroup {
    let output_ipm = water_group_output_ipm(&row);
    WaterExtractorGroup {
        id: row.id,
        world_x: row.world_x,
        world_y: row.world_y,
        count: row.count,
        clock_pct: row.clock_pct,
        count2: row.count2,
        clock2_pct: row.clock2_pct,
        factory_id: row.factory_id,
        notes: row.notes,
        locked: row.locked,
        output_ipm,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[tauri::command]
pub fn list_water_extractor_groups(
    active: State<ActivePlaythrough>,
) -> AppResult<Vec<WaterExtractorGroup>> {
    let db = require_active(&active)?;
    let rows = db.with(|c| repo::water_groups_all(c).map_err(AppError::from))?;
    Ok(rows.into_iter().map(group_to_dto).collect())
}

/// Create (no id) or update (with id) a water extractor group. Returns
/// the stored row with its computed output so the UI never re-derives
/// the math.
#[tauri::command]
pub fn set_water_extractor_group(
    active: State<ActivePlaythrough>,
    input: SetWaterExtractorGroupInput,
) -> AppResult<WaterExtractorGroup> {
    validate_clock(input.clock_pct)?;
    if input.count < 1 {
        return Err(AppError::Invalid(format!(
            "extractor count must be at least 1 (got {})",
            input.count
        )));
    }
    // Bank 2 travels as a pair — mirror the DB CHECK with a friendly
    // message instead of a constraint error.
    match (input.count2, input.clock2_pct) {
        (None, None) => {}
        (Some(c), Some(p)) => {
            validate_clock(p)?;
            if c < 1 {
                return Err(AppError::Invalid(format!(
                    "second bank count must be at least 1 (got {c})"
                )));
            }
        }
        _ => {
            return Err(AppError::Invalid(
                "second bank needs both a count and a clock".into(),
            ));
        }
    }
    let db = require_active(&active)?;
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = now_iso();
    let trimmed_factory = input.factory_id.as_deref().map(str::trim).map(str::to_string);
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    db.with(|c| {
        repo::water_group_upsert(
            c,
            &id,
            input.world_x,
            input.world_y,
            input.count,
            input.clock_pct,
            input.count2,
            input.clock2_pct,
            trimmed_factory.as_deref(),
            trimmed_notes.as_deref(),
            input.locked,
            &now,
        )
        .map_err(AppError::from)
    })?;
    let rows = db.with(|c| repo::water_groups_all(c).map_err(AppError::from))?;
    rows.into_iter()
        .find(|r| r.id == id)
        .map(group_to_dto)
        .ok_or_else(|| AppError::Internal("water group disappeared after upsert".into()))
}

#[tauri::command]
pub fn delete_water_extractor_group(
    active: State<ActivePlaythrough>,
    id: String,
) -> AppResult<()> {
    let db = require_active(&active)?;
    let affected = db.with(|c| repo::water_group_delete(c, &id).map_err(AppError::from))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("no water group {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_clock_matches_other_slices_clamps() {
        assert!(validate_clock(0.0).is_err());
        assert!(validate_clock(250.01).is_err());
        assert!(validate_clock(f32::NAN).is_err());
        assert!(validate_clock(100.0).is_ok());
        assert!(validate_clock(250.0).is_ok());
    }
}
