use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::features::playthrough::state::ActivePlaythrough;
use crate::shared::db::playthrough_db::PlaythroughDb;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::domain::{
    BudgetAssumption, allowed_extractors, extractor_output_ipm, resource_budget,
    tier_eligible_extractors, water_group_output_ipm,
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
    list_resource_nodes_impl(&db, &game_data)
}

fn list_resource_nodes_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
) -> AppResult<Vec<ResourceNodeRow>> {
    let claims = db.with(|c| repo::claims_all(c).map_err(AppError::from))?;
    let (current_tier, _progress) = db.with(|c| {
        crate::features::playthrough::repo::progress_get(c).map_err(AppError::from)
    })?;
    let tier: u8 = current_tier.clamp(0, u8::MAX as i64) as u8;
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
            .map(|c| extractor_output_ipm(node, c.miner_id.as_deref(), c.clock_pct, game_data))
            .unwrap_or(0.0);
        // Family truth, unfiltered — `claim_invalid_extractor` must stay
        // about "wrong building for this node", not "not unlocked yet",
        // so a legacy above-tier claim keeps reading as tier-gated
        // (validation's `ClaimExtractorAboveTier`) rather than invalid.
        let allowed = allowed_extractors(node, game_data);
        let claim_invalid_extractor = claim_row
            .and_then(|c| c.miner_id.as_deref())
            .is_some_and(|id| !allowed.iter().any(|e| e.id == id));
        // Picker options narrow to what's actually buildable right now,
        // every family alike — oil and well extractors used to be
        // exempted here (they were the only families with no in-game
        // tiers to reach when the exemption was written), which is how a
        // Tier 6 well satellite ended up offering its Tier 8 extractor
        // unchallenged. `tier_eligible_extractors` never returns empty
        // even for a single-option family, so this still leaves an
        // already-claimed or fresh node with its one extractor pickable
        // — the tier just shows through in the option's own
        // `unlock_tier` instead of being silently absorbed.
        let mut picker_extractors = tier_eligible_extractors(&allowed, tier);
        // A claim is allowed to carry an extractor above the picker's
        // tier cap on purpose — retaining an above-tier claim and
        // reporting it separately (`ClaimExtractorAboveTier`) is
        // deliberate, not a bug to hide by narrowing the list. Both
        // claim editors default through `claimDefaultExtractor`, which
        // falls back to the first option whenever the stored value
        // isn't present in it — so dropping a stored Mk2-at-T0 claim
        // from this list silently downgraded it to Mk1 the moment its
        // clock or factory got edited, since only the family (not the
        // exact extractor) round-trips separately from this option list.
        if let Some(stored_id) = claim_row.and_then(|c| c.miner_id.as_deref()) {
            if !picker_extractors.iter().any(|e| e.id == stored_id) {
                if let Some(stored_option) = allowed.iter().find(|e| e.id == stored_id) {
                    picker_extractors.push(stored_option.clone());
                }
            }
        }
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
            allowed_extractors: picker_extractors,
            claim_invalid_extractor,
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
        // The picker options and this check come from the same function,
        // so a wrong-picker bug surfaces as an error here instead of
        // producing a silently wrong rate later.
        let allowed = allowed_extractors(node, &game_data);
        if allowed.is_empty() {
            return Err(AppError::Invalid(
                "geysers feed geothermal generators — track them in the power slice".into(),
            ));
        }
        if !allowed.iter().any(|e| e.id == miner_id) {
            let names: Vec<&str> = allowed.iter().map(|e| e.id.as_str()).collect();
            return Err(AppError::Invalid(format!(
                "this node only accepts {} (got {miner_id})",
                names.join(", ")
            )));
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
    use crate::shared::gamedata::types::NodeKind;

    #[test]
    fn validate_clock_matches_other_slices_clamps() {
        assert!(validate_clock(0.0).is_err());
        assert!(validate_clock(250.01).is_err());
        assert!(validate_clock(f32::NAN).is_err());
        assert!(validate_clock(100.0).is_ok());
        assert!(validate_clock(250.0).is_ok());
    }

    fn open_test_db(tier: i64) -> PlaythroughDb {
        let db = PlaythroughDb::open_in_memory().expect("open in-memory playthrough db");
        db.with(|c| crate::features::playthrough::repo::progress_init(c, tier))
            .expect("seed progress");
        db
    }

    #[test]
    fn list_resource_nodes_hides_above_tier_miner_marks_but_keeps_single_option_families() {
        let gd = GameData::from_bundled().unwrap();
        let db = open_test_db(0);
        let rows = list_resource_nodes_impl(&db, &gd).unwrap();

        let iron = rows
            .iter()
            .find(|r| r.resource_item_id == "Desc_OreIron_C")
            .expect("iron row");
        assert_eq!(
            iron.allowed_extractors.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["Build_MinerMk1_C"],
            "a fresh Tier 0 game must default the picker to Mk1 only"
        );

        // Oil is a single-option family (Oil Extractor, T5) — it must
        // still offer its one extractor at Tier 0, not go empty. Crude
        // oil also has fracking-well satellites with the same resource
        // id, so pick the miner_node (seep) row specifically.
        let oil = rows
            .iter()
            .find(|r| r.resource_item_id == "Desc_LiquidOil_C" && r.kind == NodeKind::MinerNode)
            .expect("oil seep row");
        assert_eq!(oil.allowed_extractors.len(), 1);
        assert_eq!(oil.allowed_extractors[0].id, "Build_OilPump_C");
    }

    #[test]
    fn list_resource_nodes_widens_miner_options_as_tier_rises() {
        let gd = GameData::from_bundled().unwrap();
        let db = open_test_db(4);
        let rows = list_resource_nodes_impl(&db, &gd).unwrap();
        let iron = rows
            .iter()
            .find(|r| r.resource_item_id == "Desc_OreIron_C")
            .expect("iron row");
        assert_eq!(
            iron.allowed_extractors.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["Build_MinerMk1_C", "Build_MinerMk2_C"],
            "Mk2 unlocks at T4 — it should now appear alongside Mk1"
        );
    }

    #[test]
    fn list_resource_nodes_keeps_claim_invalid_extractor_about_family_not_tier() {
        // A Mk2 claim on an iron node at Tier 0 is the right building
        // family, just not yet unlocked — that's `ClaimExtractorAboveTier`
        // territory in validation, not `claim_invalid_extractor` (which
        // means "wrong building for this node entirely", e.g. a miner
        // mark stuck on an oil seep). Narrowing the *picker* to Mk1 must
        // not also flip this flag for an existing claim.
        let gd = GameData::from_bundled().unwrap();
        let db = open_test_db(0);
        let iron = gd
            .nodes()
            .iter()
            .find(|n| {
                n.resource_item_id == "Desc_OreIron_C"
                    && n.purity == crate::shared::gamedata::types::NodePurity::Normal
            })
            .unwrap();
        db.with(|c| {
            repo::claim_upsert(c, &iron.id, Some("Build_MinerMk2_C"), 100.0, None, None, "n")
        })
        .unwrap();
        let rows = list_resource_nodes_impl(&db, &gd).unwrap();
        let row = rows.iter().find(|r| r.id == iron.id).unwrap();
        assert!(
            !row.claim_invalid_extractor,
            "an above-tier but same-family claim isn't an invalid extractor"
        );
        // The stored claim's real rate still shows (Mk2 @ Normal = 120
        // ipm) — the picker's narrowed options don't retroactively
        // change what's already built.
        assert!((row.items_per_minute - 120.0).abs() < 0.01);
    }

    #[test]
    fn list_resource_nodes_keeps_the_stored_extractor_in_the_picker_even_above_tier() {
        // Codex P2: both claim editors default through
        // `claimDefaultExtractor`, which falls back to the picker's
        // first option whenever the stored value isn't present in it.
        // Before this, an above-tier stored extractor was dropped from
        // `allowedExtractors` entirely, so editing only the clock or
        // factory on a stored Mk2-at-T0 claim would silently rewrite it
        // to Mk1 the moment the form re-derived a default — changing its
        // supply and power figures behind the player's back. Retaining
        // and separately reporting an above-tier claim is deliberate; the
        // picker options have to agree with that.
        let gd = GameData::from_bundled().unwrap();
        let db = open_test_db(0);
        let iron = gd
            .nodes()
            .iter()
            .find(|n| {
                n.resource_item_id == "Desc_OreIron_C"
                    && n.purity == crate::shared::gamedata::types::NodePurity::Normal
            })
            .unwrap();
        db.with(|c| {
            repo::claim_upsert(c, &iron.id, Some("Build_MinerMk2_C"), 100.0, None, None, "n")
        })
        .unwrap();
        let rows = list_resource_nodes_impl(&db, &gd).unwrap();
        let row = rows.iter().find(|r| r.id == iron.id).unwrap();
        assert!(
            row.allowed_extractors.iter().any(|e| e.id == "Build_MinerMk2_C"),
            "the stored Mk2 must survive in the picker options even though only Mk1 is tier-eligible \
             at T0: {:?}",
            row.allowed_extractors
        );
        // Mk1 is still there too — a fresh pick at this node's tier
        // still wants its normal option, the stored extractor is an
        // addition, not a replacement of the tier-eligible set.
        assert!(row.allowed_extractors.iter().any(|e| e.id == "Build_MinerMk1_C"));
    }

    #[test]
    fn list_resource_nodes_does_not_duplicate_a_stored_extractor_already_tier_eligible() {
        // The merge only needs to add the stored extractor when it's
        // missing — a claim whose stored building is already within
        // tier must not show up twice in the picker.
        let gd = GameData::from_bundled().unwrap();
        let db = open_test_db(0);
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .unwrap();
        db.with(|c| {
            repo::claim_upsert(c, &iron.id, Some("Build_MinerMk1_C"), 100.0, None, None, "n")
        })
        .unwrap();
        let rows = list_resource_nodes_impl(&db, &gd).unwrap();
        let row = rows.iter().find(|r| r.id == iron.id).unwrap();
        assert_eq!(
            row.allowed_extractors.iter().filter(|e| e.id == "Build_MinerMk1_C").count(),
            1,
            "a tier-eligible stored extractor must not be duplicated: {:?}",
            row.allowed_extractors
        );
    }
}
