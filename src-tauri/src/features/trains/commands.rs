//! Tauri command surface for the trains slice.

use std::collections::HashSet;

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::features::playthrough::state::ActivePlaythrough;
use crate::shared::error::{AppError, AppResult};

use super::domain::estimate_cycle_seconds_default;
use super::dto::{
    AttachLinkToRouteInput, CreateTrainRouteInput, TrainRoute, TrainRouteDetail,
    UpdateTrainRouteInput,
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

fn validate_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("route name must not be empty".into()));
    }
    if trimmed.chars().count() > 80 {
        return Err(AppError::Invalid(
            "route name must be 80 characters or fewer".into(),
        ));
    }
    Ok(())
}

fn validate_cars(freight: i64, fluid: i64) -> AppResult<()> {
    if freight < 0 || fluid < 0 {
        return Err(AppError::Invalid("car counts must be 0 or more".into()));
    }
    if freight + fluid < 1 {
        return Err(AppError::Invalid(
            "route must carry at least one car (freight or fluid)".into(),
        ));
    }
    if freight + fluid > 32 {
        return Err(AppError::Invalid(
            "more than 32 cars on a single train is almost certainly a typo".into(),
        ));
    }
    Ok(())
}

fn validate_distance(distance_m: Option<i64>) -> AppResult<()> {
    if let Some(d) = distance_m {
        if d < 0 {
            return Err(AppError::Invalid(format!(
                "total_distance_m must be >= 0 (got {d})"
            )));
        }
    }
    Ok(())
}

fn validate_stops(stops: &[String]) -> AppResult<()> {
    if stops.len() < 2 {
        return Err(AppError::Invalid(
            "route must have at least 2 stops".into(),
        ));
    }
    // Same factory can repeat (back-and-forth shuttle), but never two in a
    // row at the same position — that's a duplicate, not a route.
    for window in stops.windows(2) {
        if window[0] == window[1] {
            return Err(AppError::Invalid(format!(
                "consecutive stops must not be the same factory (got {} twice)",
                window[0]
            )));
        }
    }
    let unique: HashSet<&String> = stops.iter().collect();
    if unique.len() < 2 {
        return Err(AppError::Invalid(
            "route must visit at least 2 distinct factories".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn list_train_routes(active: State<ActivePlaythrough>) -> AppResult<Vec<TrainRoute>> {
    let db = require_active(&active)?;
    db.with(|c| repo::route_list(c).map_err(AppError::from))
}

#[tauri::command]
pub fn get_train_route(
    active: State<ActivePlaythrough>,
    id: String,
) -> AppResult<TrainRouteDetail> {
    let db = require_active(&active)?;
    let route = db
        .with(|c| repo::route_get(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("train route {id} not found")))?;
    let stops = db.with(|c| repo::stops_for_route(c, &id).map_err(AppError::from))?;
    let attached_link_ids =
        db.with(|c| repo::link_ids_for_route(c, &id).map_err(AppError::from))?;
    Ok(TrainRouteDetail {
        route,
        stops,
        attached_link_ids,
    })
}

#[tauri::command]
pub fn create_train_route(
    active: State<ActivePlaythrough>,
    input: CreateTrainRouteInput,
) -> AppResult<TrainRouteDetail> {
    validate_name(&input.name)?;
    validate_cars(input.freight_cars, input.fluid_cars)?;
    validate_distance(input.total_distance_m)?;
    validate_stops(&input.stops)?;

    let db = require_active(&active)?;
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let trimmed_name = input.name.trim().to_string();
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    let est = input
        .total_distance_m
        .and_then(|d| estimate_cycle_seconds_default(d, input.stops.len()));

    db.with(|c| {
        repo::route_insert(
            c,
            &id,
            &trimmed_name,
            input.freight_cars,
            input.fluid_cars,
            input.total_distance_m,
            est,
            trimmed_notes.as_deref(),
            &now,
        )
        .map_err(AppError::from)
    })?;
    db.with(|c| repo::stops_replace(c, &id, &input.stops).map_err(AppError::from))?;

    get_train_route(active, id)
}

#[tauri::command]
pub fn update_train_route(
    active: State<ActivePlaythrough>,
    input: UpdateTrainRouteInput,
) -> AppResult<TrainRouteDetail> {
    validate_name(&input.name)?;
    validate_cars(input.freight_cars, input.fluid_cars)?;
    validate_distance(input.total_distance_m)?;
    validate_stops(&input.stops)?;

    let db = require_active(&active)?;
    let now = now_iso();
    let trimmed_name = input.name.trim().to_string();
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    let est = input
        .total_distance_m
        .and_then(|d| estimate_cycle_seconds_default(d, input.stops.len()));

    let affected = db.with(|c| {
        repo::route_update(
            c,
            &input.id,
            &trimmed_name,
            input.freight_cars,
            input.fluid_cars,
            input.total_distance_m,
            est,
            trimmed_notes.as_deref(),
            &now,
        )
        .map_err(AppError::from)
    })?;
    if affected == 0 {
        return Err(AppError::NotFound(format!(
            "train route {} not found",
            input.id
        )));
    }
    db.with(|c| repo::stops_replace(c, &input.id, &input.stops).map_err(AppError::from))?;

    get_train_route(active, input.id)
}

#[tauri::command]
pub fn delete_train_route(active: State<ActivePlaythrough>, id: String) -> AppResult<()> {
    let db = require_active(&active)?;
    let affected = db.with(|c| repo::route_delete(c, &id).map_err(AppError::from))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("train route {id} not found")));
    }
    Ok(())
}

#[tauri::command]
pub fn attach_link_to_route(
    active: State<ActivePlaythrough>,
    input: AttachLinkToRouteInput,
) -> AppResult<()> {
    let db = require_active(&active)?;
    db.with(|c| repo::link_attach(c, &input.link_id, &input.route_id).map_err(AppError::from))
}

#[tauri::command]
pub fn detach_link_from_route(
    active: State<ActivePlaythrough>,
    link_id: String,
) -> AppResult<()> {
    let db = require_active(&active)?;
    db.with(|c| repo::link_detach(c, &link_id).map_err(AppError::from))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_cars_rejects_negative_zero_total_and_huge_totals() {
        assert!(validate_cars(-1, 0).is_err());
        assert!(validate_cars(0, -1).is_err());
        assert!(validate_cars(0, 0).is_err());
        assert!(validate_cars(33, 0).is_err());
        assert!(validate_cars(2, 1).is_ok());
    }

    #[test]
    fn validate_stops_requires_two_distinct_with_no_consecutive_dupes() {
        assert!(validate_stops(&[]).is_err());
        assert!(validate_stops(&["a".into()]).is_err());
        assert!(validate_stops(&["a".into(), "a".into()]).is_err());
        assert!(validate_stops(&["a".into(), "b".into(), "b".into()]).is_err());
        assert!(validate_stops(&["a".into(), "b".into()]).is_ok());
        // Same factory at non-adjacent positions is fine (shuttle pattern).
        assert!(validate_stops(&["a".into(), "b".into(), "a".into()]).is_ok());
    }

    #[test]
    fn validate_name_rejects_empty_and_overlong() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
        assert!(validate_name("Ore Loop").is_ok());
        let too_long: String = std::iter::repeat('x').take(81).collect();
        assert!(validate_name(&too_long).is_err());
    }
}
