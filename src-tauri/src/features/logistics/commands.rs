//! Tauri command surface for the logistics slice.
//!
//! Six commands, all per-playthrough (each takes `State<ActivePlaythrough>`):
//! - `list_logistics_links` / `get_logistics_link`
//! - `create_logistics_link` / `update_logistics_link` / `delete_logistics_link`
//! - `plan_logistics` — pure planner, returns ranked plans for the UI's
//!   `<TransportPlanPicker />`. Pulls belt/pipe tier rows from the bundled
//!   game data and the playthrough's current tier from the active state.

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::features::playthrough::state::ActivePlaythrough;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::domain::{plan_belts, plan_pipes};
use super::dto::{
    CreateLogisticsLinkInput, LogisticsLink, PlanInput, TransportKind, TransportPlan,
    UpdateLogisticsLinkInput,
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

/// Minimum representable items-per-minute. The repo stores ipm as
/// `i64 × 100`, so anything below 0.005 rounds to zero and would then
/// violate the `items_per_minute_x100 > 0` SQL CHECK with a cryptic
/// SQLite error. We reject below 0.01 here so the user always gets a
/// deterministic `AppError::Invalid` instead.
const MIN_IPM: f32 = 0.01;

fn validate_ipm(ipm: f32) -> AppResult<()> {
    if !ipm.is_finite() || ipm <= 0.0 {
        return Err(AppError::Invalid(format!(
            "items_per_minute must be > 0 (got {ipm})"
        )));
    }
    if ipm < MIN_IPM {
        return Err(AppError::Invalid(format!(
            "items_per_minute must be at least {MIN_IPM} (storage rounds to 0 below this)"
        )));
    }
    if ipm > 100_000.0 {
        return Err(AppError::Invalid(
            "items_per_minute above 100,000 is almost certainly a typo".into(),
        ));
    }
    Ok(())
}

/// Parse `transport_plan_json` and confirm its `kind` matches the
/// caller-supplied `transport_kind`. Without this, malformed JSON or a
/// kind/plan mismatch would persist quietly and break the React side
/// when the link is later edited or the plan picker is re-opened. The
/// plan body (segments, capacity numbers, etc.) is trusted — it came
/// from `plan_logistics`, which is pure-Rust and produced this exact
/// shape — so this is a structural check rather than a deep validation.
fn validate_plan_json(json: &str, expected_kind: TransportKind) -> AppResult<()> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| {
        AppError::Invalid(format!("transport_plan_json is not valid JSON: {e}"))
    })?;
    let kind_str = value
        .get("kind")
        .and_then(|k| k.as_str())
        .ok_or_else(|| {
            AppError::Invalid("transport_plan_json must have a string `kind` field".into())
        })?;
    if kind_str != expected_kind.as_db_str() {
        return Err(AppError::Invalid(format!(
            "transport_plan_json.kind = {kind_str:?} doesn't match transport_kind = {:?}",
            expected_kind.as_db_str()
        )));
    }
    Ok(())
}

fn validate_distance(distance_m: Option<i64>) -> AppResult<()> {
    if let Some(d) = distance_m {
        if d < 0 {
            return Err(AppError::Invalid(format!(
                "distance_m must be >= 0 (got {d})"
            )));
        }
    }
    Ok(())
}

fn validate_endpoints(from: &str, to: &str) -> AppResult<()> {
    if from == to {
        return Err(AppError::Invalid(
            "logistics link must connect two different factories".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn list_logistics_links(
    active: State<ActivePlaythrough>,
) -> AppResult<Vec<LogisticsLink>> {
    let db = require_active(&active)?;
    db.with(|c| repo::link_list(c).map_err(AppError::from))
}

#[tauri::command]
pub fn get_logistics_link(
    active: State<ActivePlaythrough>,
    id: String,
) -> AppResult<LogisticsLink> {
    let db = require_active(&active)?;
    db.with(|c| repo::link_get(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("logistics link {id} not found")))
}

#[tauri::command]
pub fn create_logistics_link(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: CreateLogisticsLinkInput,
) -> AppResult<LogisticsLink> {
    validate_ipm(input.items_per_minute)?;
    validate_distance(input.distance_m)?;
    validate_endpoints(&input.from_factory_id, &input.to_factory_id)?;
    if game_data.item(&input.item_id).is_none() {
        return Err(AppError::Invalid(format!(
            "unknown item id: {}",
            input.item_id
        )));
    }
    validate_plan_json(&input.transport_plan_json, input.transport_kind)?;
    let db = require_active(&active)?;
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    db.with(|c| {
        repo::link_insert(
            c,
            &id,
            &input.from_factory_id,
            &input.to_factory_id,
            &input.item_id,
            input.items_per_minute,
            input.transport_kind.as_db_str(),
            &input.transport_plan_json,
            input.distance_m,
            trimmed_notes.as_deref(),
            &now,
        )
        .map_err(AppError::from)
    })?;
    db.with(|c| repo::link_get(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::Internal("logistics link disappeared after insert".into()))
}

#[tauri::command]
pub fn update_logistics_link(
    active: State<ActivePlaythrough>,
    input: UpdateLogisticsLinkInput,
) -> AppResult<LogisticsLink> {
    validate_ipm(input.items_per_minute)?;
    validate_distance(input.distance_m)?;
    validate_plan_json(&input.transport_plan_json, input.transport_kind)?;
    let db = require_active(&active)?;
    let now = now_iso();
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    let affected = db.with(|c| {
        repo::link_update(
            c,
            &input.id,
            input.items_per_minute,
            input.transport_kind.as_db_str(),
            &input.transport_plan_json,
            input.distance_m,
            trimmed_notes.as_deref(),
            &now,
        )
        .map_err(AppError::from)
    })?;
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "logistics link {} not found",
            input.id
        )));
    }
    db.with(|c| repo::link_get(c, &input.id).map_err(AppError::from))?
        .ok_or_else(|| AppError::Internal("logistics link disappeared after update".into()))
}

#[tauri::command]
pub fn delete_logistics_link(
    active: State<ActivePlaythrough>,
    id: String,
) -> AppResult<()> {
    let db = require_active(&active)?;
    let affected = db.with(|c| repo::link_delete(c, &id).map_err(AppError::from))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("logistics link {id} not found")));
    }
    Ok(())
}

/// Pure planner — no DB writes, no playthrough state mutation. The UI
/// calls this to populate `<TransportPlanPicker />` before the user picks
/// one, so it must be cheap to call repeatedly as inputs change.
///
/// `is_fluid` and `unlocked_tier` are deliberately *not* on `PlanInput` —
/// the planner reads `is_fluid` from the bundled game data row for
/// `item_id` and `unlocked_tier` from the active playthrough's
/// `progress.current_tier`. Trusting client-supplied values for those
/// would let a stale UI request belts for a fluid (impossible plan) or
/// see Mk6 plans as unlocked at tier 0 (misleading lock flags).
#[tauri::command]
pub fn plan_logistics(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: PlanInput,
) -> AppResult<Vec<TransportPlan>> {
    validate_ipm(input.items_per_minute)?;
    validate_distance(input.distance_m)?;
    let item = game_data
        .item(&input.item_id)
        .ok_or_else(|| AppError::Invalid(format!("unknown item id: {}", input.item_id)))?;
    let db = require_active(&active)?;
    let (current_tier, _progress) = db.with(|c| {
        crate::features::playthrough::repo::progress_get(c).map_err(AppError::from)
    })?;
    let unlocked_tier: u8 = current_tier.clamp(0, u8::MAX as i64) as u8;

    let plans = if item.is_fluid {
        plan_pipes(
            input.items_per_minute,
            game_data.pipe_tiers(),
            unlocked_tier,
        )
    } else {
        plan_belts(
            input.items_per_minute,
            game_data.belt_tiers(),
            unlocked_tier,
        )
    };
    Ok(plans)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_ipm_rejects_zero_negative_nan_and_huge_values() {
        assert!(validate_ipm(0.0).is_err());
        assert!(validate_ipm(-1.0).is_err());
        assert!(validate_ipm(f32::NAN).is_err());
        assert!(validate_ipm(200_000.0).is_err());
        assert!(validate_ipm(60.0).is_ok());
    }

    #[test]
    fn validate_ipm_rejects_values_below_storage_precision() {
        // Codex P2: anything below 0.005 ipm rounds to 0 in the x100
        // storage and would then violate the SQL CHECK with a cryptic
        // error. We reject below 0.01 so `AppError::Invalid` always wins.
        assert!(validate_ipm(0.001).is_err());
        assert!(validate_ipm(0.005).is_err());
        assert!(validate_ipm(0.009).is_err());
        // 0.01 round-trips precisely to 1 in x100 — the lowest valid value.
        assert!(validate_ipm(0.01).is_ok());
        assert!(validate_ipm(0.5).is_ok());
    }

    #[test]
    fn validate_plan_json_rejects_invalid_json() {
        let err = validate_plan_json("not json", TransportKind::Belt);
        assert!(err.is_err());
    }

    #[test]
    fn validate_plan_json_rejects_missing_kind_field() {
        let err = validate_plan_json(r#"{"segments":[]}"#, TransportKind::Belt);
        assert!(err.is_err());
    }

    #[test]
    fn validate_plan_json_rejects_kind_mismatch() {
        // User said the link is a belt link but the persisted plan claims
        // pipe — that's a UI bug or a stale request; reject both ways.
        let err = validate_plan_json(r#"{"kind":"pipe"}"#, TransportKind::Belt);
        assert!(err.is_err());
        let err2 = validate_plan_json(r#"{"kind":"belt"}"#, TransportKind::Pipe);
        assert!(err2.is_err());
    }

    #[test]
    fn validate_plan_json_accepts_matching_kind() {
        assert!(validate_plan_json(r#"{"kind":"belt","segments":[]}"#, TransportKind::Belt).is_ok());
        assert!(validate_plan_json(r#"{"kind":"pipe","segments":[]}"#, TransportKind::Pipe).is_ok());
    }

    #[test]
    fn validate_distance_rejects_negative() {
        assert!(validate_distance(Some(-1)).is_err());
        assert!(validate_distance(Some(0)).is_ok());
        assert!(validate_distance(Some(1000)).is_ok());
        assert!(validate_distance(None).is_ok());
    }

    #[test]
    fn validate_endpoints_rejects_self_loops() {
        assert!(validate_endpoints("a", "a").is_err());
        assert!(validate_endpoints("a", "b").is_ok());
    }

    #[test]
    fn transport_kind_round_trips_through_db_str() {
        assert_eq!(TransportKind::Belt.as_db_str(), "belt");
        assert_eq!(TransportKind::Pipe.as_db_str(), "pipe");
        assert_eq!(TransportKind::Truck.as_db_str(), "truck");
        assert_eq!(TransportKind::Tractor.as_db_str(), "tractor");
        assert_eq!(TransportKind::Train.as_db_str(), "train");
        assert_eq!(TransportKind::Drone.as_db_str(), "drone");
    }
}
