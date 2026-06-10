use std::path::PathBuf;

use tauri::{AppHandle, State};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::shared::db::app_db::AppDb;
use crate::shared::db::playthrough_db::PlaythroughDb;
use crate::shared::error::{AppError, AppResult};
use crate::shared::paths::{ensure_dir, playthroughs_dir};

use super::dto::{
    AmplifierInventory, CreatePlaythroughInput, PlaythroughDetail, PlaythroughSummary,
    SetAmplifierInventoryInput,
};
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
pub fn get_amplifier_inventory(active: State<ActivePlaythrough>) -> AppResult<AmplifierInventory> {
    let (_, db) = active
        .snapshot()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    let (s, p) = db.with(|c| repo::amplifier_inventory_get(c).map_err(AppError::from))?;
    Ok(AmplifierInventory {
        somersloop_quantity: s,
        power_shard_quantity: p,
    })
}

#[tauri::command]
pub fn set_amplifier_inventory(
    active: State<ActivePlaythrough>,
    input: SetAmplifierInventoryInput,
) -> AppResult<AmplifierInventory> {
    if input.somersloop_quantity < 0 || input.power_shard_quantity < 0 {
        return Err(AppError::Invalid("inventory cannot be negative".into()));
    }
    let (_, db) = active
        .snapshot()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    db.with(|c| {
        repo::amplifier_inventory_set(c, input.somersloop_quantity, input.power_shard_quantity)
            .map_err(AppError::from)
    })?;
    Ok(AmplifierInventory {
        somersloop_quantity: input.somersloop_quantity,
        power_shard_quantity: input.power_shard_quantity,
    })
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

fn require_absolute_path(path: &std::path::Path, label: &str) -> AppResult<()> {
    if !path.is_absolute() {
        return Err(AppError::Invalid(format!(
            "{label} must be an absolute path (got {})",
            path.display()
        )));
    }
    Ok(())
}

/// Verify a freshly-opened playthrough DB has the singleton
/// `progress.id = 1` row that every real playthrough seeds during
/// `create_playthrough`. Without this an arbitrary SQLite file (or
/// even an empty file with the migrations re-applied via
/// `CREATE TABLE IF NOT EXISTS`) would pass validation and then
/// blow up at first open with a "no progress row" error.
fn verify_playthrough_seeded(db: &PlaythroughDb) -> AppResult<()> {
    db.with(|c| {
        let count: i64 = c
            .query_row("SELECT COUNT(*) FROM progress WHERE id = 1", [], |r| r.get(0))
            .map_err(|e| AppError::from(anyhow::Error::from(e)))?;
        if count == 0 {
            return Err(AppError::Invalid(
                "source file has the playthrough schema but is missing the seeded progress row"
                    .into(),
            ));
        }
        Ok(())
    })
}

/// Copy the active playthrough's `.specsdb` file to a destination
/// path. Uses SQLite's `VACUUM INTO` so the destination is a full,
/// WAL-checkpointed snapshot — `std::fs::copy` would silently miss
/// committed transactions still in the `-wal` sidecar when the DB is
/// open. The React side supplies an absolute path; relative paths are
/// rejected because they'd resolve against the Tauri working
/// directory which the user doesn't control.
#[tauri::command]
pub fn export_playthrough(
    active: State<ActivePlaythrough>,
    app_db: State<AppDb>,
    destination_path: String,
) -> AppResult<String> {
    let dest = PathBuf::from(&destination_path);
    require_absolute_path(&dest, "destination_path")?;
    let id = active
        .id()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    let source_str = app_db
        .with(|c| repo::registry_get_path(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("playthrough {id} not in registry")))?;
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            ensure_dir(parent).map_err(AppError::from)?;
        }
    }
    if dest.exists() {
        // VACUUM INTO refuses to overwrite — surface a friendly error
        // before SQLite returns the "output file already exists" code.
        return Err(AppError::Invalid(format!(
            "destination file already exists: {}",
            dest.display()
        )));
    }
    let source_path = PathBuf::from(&source_str);
    let conn = rusqlite::Connection::open(&source_path).map_err(|e| {
        AppError::Internal(format!(
            "failed to open source DB {}: {e}",
            source_path.display()
        ))
    })?;
    let dest_str = dest.to_string_lossy().to_string();
    conn.execute("VACUUM INTO ?1", rusqlite::params![dest_str])
        .map_err(|e| {
            AppError::Internal(format!(
                "VACUUM INTO {} failed: {e}",
                dest.display()
            ))
        })?;
    Ok(destination_path)
}

/// Import a `.specsdb` from anywhere on disk into the managed
/// playthroughs directory. Validates by copying to the final
/// destination first and opening the *copy* — `PlaythroughDb::open`
/// runs migrations and sets WAL pragmas, both of which would mutate
/// the source if used for in-place validation. The validation also
/// checks the seeded `progress.id = 1` row so an arbitrary SQLite
/// file can't pass `CREATE TABLE IF NOT EXISTS` and end up registered.
#[tauri::command]
pub fn import_playthrough(
    handle: AppHandle,
    app_db: State<AppDb>,
    source_path: String,
    display_name: String,
) -> AppResult<PlaythroughSummary> {
    validate_name(&display_name)?;
    let source = PathBuf::from(&source_path);
    require_absolute_path(&source, "source_path")?;
    if !source.exists() {
        return Err(AppError::Invalid(format!(
            "source file does not exist: {}",
            source.display()
        )));
    }
    if source.extension().and_then(|s| s.to_str()) != Some("specsdb") {
        return Err(AppError::Invalid(
            "source file must have a .specsdb extension".into(),
        ));
    }

    let pt_dir = playthroughs_dir(&handle).map_err(AppError::from)?;
    ensure_dir(&pt_dir).map_err(AppError::from)?;
    let id = Uuid::new_v4().to_string();
    let dest = pt_dir.join(format!("{id}.specsdb"));

    // Copy first so any mutation from migrations or WAL pragmas hits
    // the managed copy, not the user's original file. If validation
    // fails we delete the copy (best-effort) before bailing.
    std::fs::copy(&source, &dest).map_err(|e| {
        AppError::Internal(format!(
            "failed to copy {} -> {}: {e}",
            source.display(),
            dest.display()
        ))
    })?;

    let validation = PlaythroughDb::open(&dest)
        .map_err(|e| {
            AppError::Invalid(format!(
                "source file isn't a valid playthrough .specsdb: {e:#}"
            ))
        })
        .and_then(|db| verify_playthrough_seeded(&db));
    if let Err(err) = validation {
        let _ = std::fs::remove_file(&dest);
        return Err(err);
    }

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
