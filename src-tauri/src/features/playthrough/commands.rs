use std::path::PathBuf;

use tauri::{AppHandle, State};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::shared::db::app_db::AppDb;
use crate::shared::db::playthrough_db::PlaythroughDb;
use crate::shared::error::{AppError, AppResult};
use crate::shared::paths::{ensure_dir, playthroughs_dir};

use super::dto::{CreatePlaythroughInput, PlaythroughDetail, PlaythroughSummary};
use super::repo;
use super::state::ActivePlaythrough;

const SCHEMA_VERSION: i64 = 1;

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

fn validate_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("playthrough name must not be empty".into()));
    }
    // Count Unicode scalar values, not UTF-8 bytes — the user-visible limit
    // matches characters, so 80 emoji or 80 CJK glyphs are accepted.
    if trimmed.chars().count() > 80 {
        return Err(AppError::Invalid(
            "playthrough name must be 80 characters or fewer".into(),
        ));
    }
    Ok(())
}

fn validate_tier(tier: u8) -> AppResult<i64> {
    if tier > 9 {
        return Err(AppError::Invalid(format!("tier must be 0–9 (got {tier})")));
    }
    Ok(tier as i64)
}

#[tauri::command]
pub fn create_playthrough(
    handle: AppHandle,
    app_db: State<AppDb>,
    active: State<ActivePlaythrough>,
    input: CreatePlaythroughInput,
) -> AppResult<PlaythroughDetail> {
    validate_name(&input.display_name)?;
    let starting_tier = validate_tier(input.starting_tier)?;

    let id = Uuid::new_v4().to_string();
    let dir = playthroughs_dir(&handle).map_err(AppError::from)?;
    ensure_dir(&dir).map_err(AppError::from)?;
    let file_path: PathBuf = dir.join(format!("{id}.specsdb"));
    let file_path_str = file_path.to_string_lossy().to_string();
    let now = now_iso();
    let display_name = input.display_name.trim().to_string();

    // Open the new playthrough DB (creates the file + applies migrations).
    let pt_db = PlaythroughDb::open(&file_path).map_err(AppError::from)?;
    pt_db.with(|c| -> AppResult<()> {
        repo::meta_set(c, "name", &display_name).map_err(AppError::from)?;
        repo::meta_set(c, "game_version", "1.1").map_err(AppError::from)?;
        repo::meta_set(c, "created_at", &now).map_err(AppError::from)?;
        repo::meta_set(c, "schema_version", &SCHEMA_VERSION.to_string())
            .map_err(AppError::from)?;
        repo::progress_init(c, starting_tier).map_err(AppError::from)?;
        Ok(())
    })?;

    // Register in App DB.
    app_db.with(|c| -> AppResult<()> {
        repo::registry_insert(
            c,
            &id,
            &display_name,
            &file_path_str,
            SCHEMA_VERSION,
            &now,
        )
        .map_err(AppError::from)?;
        Ok(())
    })?;

    // Set as active.
    active.set(id.clone(), pt_db.clone());

    Ok(PlaythroughDetail {
        id,
        display_name,
        game_version: "1.1".to_string(),
        created_at: now,
        current_tier: starting_tier,
        current_milestone_progress: 0,
    })
}

#[tauri::command]
pub fn list_playthroughs(app_db: State<AppDb>) -> AppResult<Vec<PlaythroughSummary>> {
    app_db.with(|c| repo::registry_list(c).map_err(AppError::from))
}

#[tauri::command]
pub fn open_playthrough(
    app_db: State<AppDb>,
    active: State<ActivePlaythrough>,
    id: String,
) -> AppResult<PlaythroughDetail> {
    let summary = app_db
        .with(|c| repo::registry_get(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("playthrough {id} not in registry")))?;
    let path_str = app_db
        .with(|c| repo::registry_get_path(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("playthrough {id} has no file path")))?;
    let path = PathBuf::from(&path_str);
    if !path.exists() {
        return Err(AppError::NotFound(format!(
            "playthrough file missing: {path_str}"
        )));
    }
    let pt_db = PlaythroughDb::open(&path).map_err(AppError::from)?;
    let detail = pt_db.with(|c| repo::detail_from(summary, c).map_err(AppError::from))?;
    app_db.with(|c| repo::registry_touch_last_opened(c, &id).map_err(AppError::from))?;
    active.set(id.clone(), pt_db);
    Ok(detail)
}

#[tauri::command]
pub fn close_playthrough(active: State<ActivePlaythrough>) -> AppResult<()> {
    active.clear();
    Ok(())
}

#[tauri::command]
pub fn current_playthrough(
    app_db: State<AppDb>,
    active: State<ActivePlaythrough>,
) -> AppResult<Option<PlaythroughDetail>> {
    // Single snapshot — id + db come from the same lock acquisition so a
    // concurrent open/close can't make us read DB B's progress under id A.
    let Some((id, db)) = active.snapshot() else {
        return Ok(None);
    };
    let Some(summary) = app_db.with(|c| repo::registry_get(c, &id).map_err(AppError::from))? else {
        return Ok(None);
    };
    let detail = db.with(|c| repo::detail_from(summary, c).map_err(AppError::from))?;
    Ok(Some(detail))
}

#[tauri::command]
pub fn set_current_tier(
    app_db: State<AppDb>,
    active: State<ActivePlaythrough>,
    tier: u8,
) -> AppResult<PlaythroughDetail> {
    let tier_i = validate_tier(tier)?;
    let (id, db) = active
        .snapshot()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    db.with(|c| repo::progress_set_tier(c, tier_i).map_err(AppError::from))?;
    let summary = app_db
        .with(|c| repo::registry_get(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("playthrough {id} not in registry")))?;
    let detail = db.with(|c| repo::detail_from(summary, c).map_err(AppError::from))?;
    Ok(detail)
}

#[tauri::command]
pub fn delete_playthrough(
    app_db: State<AppDb>,
    active: State<ActivePlaythrough>,
    id: String,
) -> AppResult<()> {
    if active.id().as_deref() == Some(id.as_str()) {
        active.clear();
    }
    let path_str = app_db
        .with(|c| repo::registry_get_path(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("playthrough {id} not in registry")))?;
    app_db.with(|c| repo::registry_delete(c, &id).map_err(AppError::from))?;
    let _ = std::fs::remove_file(&path_str); // best-effort: registry truth is what matters
    Ok(())
}

/// Copy the active playthrough's `.specsdb` file to a destination
/// path. The user's React side picks the path (file picker integration
/// lands as a follow-up; for now the path is supplied directly so the
/// command stays useful in the absence of a plugin). Returns the
/// destination path on success so the UI can confirm what landed.
#[tauri::command]
pub fn export_playthrough(
    active: State<ActivePlaythrough>,
    app_db: State<AppDb>,
    destination_path: String,
) -> AppResult<String> {
    let id = active
        .id()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    let source = app_db
        .with(|c| repo::registry_get_path(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("playthrough {id} not in registry")))?;
    let dest = PathBuf::from(&destination_path);
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            ensure_dir(parent).map_err(AppError::from)?;
        }
    }
    std::fs::copy(&source, &dest).map_err(|e| {
        AppError::Internal(format!(
            "failed to copy {source} -> {}: {e}",
            destination_path
        ))
    })?;
    Ok(destination_path)
}

/// Import a `.specsdb` from anywhere on disk into the managed
/// playthroughs directory. Adds a new registry row pointing at the
/// imported file (with a fresh uuid for the registry id, distinct
/// from any uuid the file might internally reference). Returns the
/// new registry summary so the React side can switch to it.
#[tauri::command]
pub fn import_playthrough(
    handle: AppHandle,
    app_db: State<AppDb>,
    source_path: String,
    display_name: String,
) -> AppResult<PlaythroughSummary> {
    validate_name(&display_name)?;
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err(AppError::Invalid(format!(
            "source file does not exist: {source_path}"
        )));
    }
    if source.extension().and_then(|s| s.to_str()) != Some("specsdb") {
        return Err(AppError::Invalid(
            "source file must have a .specsdb extension".into(),
        ));
    }
    // Open the file as a playthrough DB to validate it has the
    // expected schema BEFORE we copy it into the managed directory —
    // without this an arbitrary SQLite file (or worse, a non-SQLite
    // file that just ends in .specsdb) would be silently registered
    // and then break the next time the user opened it.
    PlaythroughDb::open(&source).map_err(|e| {
        AppError::Invalid(format!(
            "source file isn't a valid playthrough .specsdb: {e:#}"
        ))
    })?;

    let pt_dir = playthroughs_dir(&handle).map_err(AppError::from)?;
    ensure_dir(&pt_dir).map_err(AppError::from)?;
    let id = Uuid::new_v4().to_string();
    let dest = pt_dir.join(format!("{id}.specsdb"));
    std::fs::copy(&source, &dest).map_err(|e| {
        AppError::Internal(format!(
            "failed to copy {source_path} -> {}: {e}",
            dest.display()
        ))
    })?;
    let now = now_iso();
    app_db.with(|c| {
        repo::registry_insert(
            c,
            &id,
            display_name.trim(),
            &dest.to_string_lossy(),
            SCHEMA_VERSION,
            &now,
        )
        .map_err(AppError::from)
    })?;
    Ok(PlaythroughSummary {
        id,
        display_name: display_name.trim().to_string(),
        created_at: now.clone(),
        last_opened_at: Some(now),
        schema_version: SCHEMA_VERSION,
    })
}

#[cfg(test)]
mod tests {
    //! These tests exercise the validators and the wired-together repo flow
    //! (without Tauri State); the full create→open round-trip in the live app
    //! is covered by the Vitest + MCP verification step.

    use super::*;

    #[test]
    fn validate_name_rejects_empty_and_too_long() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
        assert!(validate_name(&"x".repeat(81)).is_err());
        assert!(validate_name("Iron Run").is_ok());
    }

    #[test]
    fn validate_name_counts_characters_not_bytes() {
        // 80 emoji = 320 UTF-8 bytes — char-counting accepts, byte-counting rejects.
        assert!(validate_name(&"🚂".repeat(80)).is_ok());
        // 81 emoji is rejected.
        assert!(validate_name(&"🚂".repeat(81)).is_err());
        // 80 CJK characters likewise accepted.
        assert!(validate_name(&"鉄".repeat(80)).is_ok());
    }

    #[test]
    fn validate_tier_caps_at_nine() {
        assert_eq!(validate_tier(0).unwrap(), 0);
        assert_eq!(validate_tier(9).unwrap(), 9);
        assert!(validate_tier(10).is_err());
        assert!(validate_tier(255).is_err());
    }

    #[test]
    fn validate_tier_message_is_role_neutral() {
        // The same validator is used for both create-time starting tier and
        // post-create set_current_tier, so the error string must not lock
        // either role into the wording.
        let err = validate_tier(15).unwrap_err();
        let msg = format!("{err:?}");
        assert!(msg.contains("tier must be 0"), "got: {msg}");
        assert!(!msg.contains("starting"), "got: {msg}");
    }
}
