use std::collections::BTreeMap;

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::dto::{
    AddMachineInput, CreateFactoryInput, Factory, FactoryDetail, FactoryLedger, FactoryMachine,
    ItemFlow, RenameFactoryInput, UpdateMachineInput,
};
use super::domain::{machine_power_mw, recipe_io_flows};
use super::repo;
use crate::features::playthrough::state::ActivePlaythrough;

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

fn require_active(active: &ActivePlaythrough) -> AppResult<crate::shared::db::playthrough_db::PlaythroughDb> {
    let (_id, db) = active
        .snapshot()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    Ok(db)
}

fn validate_factory_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("factory name must not be empty".into()));
    }
    if trimmed.chars().count() > 80 {
        return Err(AppError::Invalid(
            "factory name must be 80 characters or fewer".into(),
        ));
    }
    Ok(())
}

fn validate_count(count: i64) -> AppResult<()> {
    if count < 1 {
        return Err(AppError::Invalid("machine count must be 1 or more".into()));
    }
    if count > 10_000 {
        return Err(AppError::Invalid(
            "machine count above 10,000 is almost certainly a typo".into(),
        ));
    }
    Ok(())
}

fn validate_clock(clock_pct: f32) -> AppResult<()> {
    if clock_pct < 1.0 || clock_pct > 250.0 {
        return Err(AppError::Invalid(format!(
            "clock must be between 1% and 250% (got {clock_pct})"
        )));
    }
    Ok(())
}

#[tauri::command]
pub fn list_factories(active: State<ActivePlaythrough>) -> AppResult<Vec<Factory>> {
    let db = require_active(&active)?;
    db.with(|c| repo::factory_list(c).map_err(AppError::from))
}

#[tauri::command]
pub fn create_factory(
    active: State<ActivePlaythrough>,
    input: CreateFactoryInput,
) -> AppResult<Factory> {
    validate_factory_name(&input.name)?;
    let db = require_active(&active)?;
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let trimmed_name = input.name.trim().to_string();
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    let trimmed_color = input.color.as_deref().map(str::trim).map(str::to_string);
    db.with(|c| {
        repo::factory_insert(
            c,
            &id,
            &trimmed_name,
            trimmed_color.as_deref(),
            trimmed_notes.as_deref(),
            &now,
        )
        .map_err(AppError::from)
    })?;
    let factory = db
        .with(|c| repo::factory_get(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::Internal("factory disappeared after insert".into()))?;
    Ok(factory)
}

#[tauri::command]
pub fn rename_factory(
    active: State<ActivePlaythrough>,
    input: RenameFactoryInput,
) -> AppResult<Factory> {
    validate_factory_name(&input.name)?;
    let db = require_active(&active)?;
    let now = now_iso();
    let trimmed = input.name.trim().to_string();
    db.with(|c| repo::factory_rename(c, &input.id, &trimmed, &now).map_err(AppError::from))?;
    db.with(|c| repo::factory_get(c, &input.id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("factory {} not found", input.id)))
}

#[tauri::command]
pub fn delete_factory(active: State<ActivePlaythrough>, id: String) -> AppResult<()> {
    let db = require_active(&active)?;
    db.with(|c| repo::factory_delete(c, &id).map_err(AppError::from))
}

#[tauri::command]
pub fn add_factory_machine(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: AddMachineInput,
) -> AppResult<FactoryMachine> {
    validate_count(input.count)?;
    validate_clock(input.clock_pct)?;
    if game_data.building(&input.building_id).is_none() {
        return Err(AppError::Invalid(format!(
            "unknown building id: {}",
            input.building_id
        )));
    }
    let recipe = game_data
        .recipe(&input.recipe_id)
        .ok_or_else(|| AppError::Invalid(format!("unknown recipe id: {}", input.recipe_id)))?;
    // The recipe must actually run in the building the user picked. Without
    // this check a stale or malformed client could insert e.g. an Iron Plate
    // recipe under a Smelter, then `compose_ledger` would happily compute
    // recipe flows from one and power from the other — silently producing
    // wrong planning data.
    if recipe.building_id != input.building_id {
        return Err(AppError::Invalid(format!(
            "recipe {} runs in {}, not {}",
            input.recipe_id, recipe.building_id, input.building_id
        )));
    }
    let db = require_active(&active)?;
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    db.with(|c| {
        repo::machine_insert(
            c,
            &id,
            &input.factory_id,
            &input.building_id,
            &input.recipe_id,
            input.count,
            input.clock_pct,
            &now,
        )
        .map_err(AppError::from)
    })?;
    let machines = db.with(|c| repo::machines_for_factory(c, &input.factory_id).map_err(AppError::from))?;
    machines
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::Internal("machine disappeared after insert".into()))
}

#[tauri::command]
pub fn update_factory_machine(
    active: State<ActivePlaythrough>,
    input: UpdateMachineInput,
) -> AppResult<()> {
    validate_count(input.count)?;
    validate_clock(input.clock_pct)?;
    let db = require_active(&active)?;
    let now = now_iso();
    let affected = db.with(|c| {
        repo::machine_update(c, &input.id, input.count, input.clock_pct, &now)
            .map_err(AppError::from)
    })?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("machine {} not found", input.id)));
    }
    Ok(())
}

#[tauri::command]
pub fn remove_factory_machine(active: State<ActivePlaythrough>, id: String) -> AppResult<()> {
    let db = require_active(&active)?;
    db.with(|c| repo::machine_delete(c, &id).map_err(AppError::from))
}

#[tauri::command]
pub fn factory_ledger(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    factory_id: String,
) -> AppResult<FactoryLedger> {
    let db = require_active(&active)?;
    let machines = db.with(|c| repo::machines_for_factory(c, &factory_id).map_err(AppError::from))?;
    Ok(compose_ledger(&factory_id, &machines, &game_data))
}

#[tauri::command]
pub fn get_factory_detail(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    id: String,
) -> AppResult<FactoryDetail> {
    let db = require_active(&active)?;
    let factory = db
        .with(|c| repo::factory_get(c, &id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("factory {id} not found")))?;
    let machines = db.with(|c| repo::machines_for_factory(c, &id).map_err(AppError::from))?;
    let ledger = compose_ledger(&id, &machines, &game_data);
    Ok(FactoryDetail {
        factory,
        machines,
        ledger,
    })
}

/// Aggregate ledger across all machines in a factory. Pure given the inputs;
/// no DB or Tauri State touched here so it can be unit-tested directly.
pub fn compose_ledger(
    factory_id: &str,
    machines: &[FactoryMachine],
    game_data: &GameData,
) -> FactoryLedger {
    let mut produced: BTreeMap<String, f32> = BTreeMap::new();
    let mut consumed: BTreeMap<String, f32> = BTreeMap::new();
    let mut power_mw = 0.0_f32;

    for m in machines {
        if let Some(recipe) = game_data.recipe(&m.recipe_id) {
            let (ins, outs) = recipe_io_flows(recipe, m.count, m.clock_pct);
            for (item, ipm) in ins {
                *consumed.entry(item).or_insert(0.0) += ipm;
            }
            for (item, ipm) in outs {
                *produced.entry(item).or_insert(0.0) += ipm;
            }
        }
        if let Some(building) = game_data.building(&m.building_id) {
            power_mw += machine_power_mw(building.power_mw, m.count, m.clock_pct);
        }
    }

    let mut all_ids: Vec<String> = produced.keys().chain(consumed.keys()).cloned().collect();
    all_ids.sort();
    all_ids.dedup();

    let flows = all_ids
        .into_iter()
        .map(|item_id| {
            let p = *produced.get(&item_id).unwrap_or(&0.0);
            let c = *consumed.get(&item_id).unwrap_or(&0.0);
            let (name, is_fluid) = game_data
                .item(&item_id)
                .map(|i| (i.name.clone(), i.is_fluid))
                .unwrap_or_else(|| (item_id.clone(), false));
            ItemFlow {
                item_id,
                item_name: name,
                is_fluid,
                produced_per_minute: p,
                consumed_per_minute: c,
                net_per_minute: p - c,
            }
        })
        .collect();

    FactoryLedger {
        factory_id: factory_id.to_string(),
        flows,
        power_mw,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::gamedata::GameData;

    fn gd() -> GameData {
        GameData::from_bundled().unwrap()
    }

    fn machine(id: &str, building: &str, recipe: &str, count: i64, clock: f32) -> FactoryMachine {
        FactoryMachine {
            id: id.into(),
            factory_id: "f1".into(),
            building_id: building.into(),
            recipe_id: recipe.into(),
            count,
            clock_pct: clock,
            created_at: "2026-05-10T00:00:00Z".into(),
            updated_at: "2026-05-10T00:00:00Z".into(),
        }
    }

    #[test]
    fn ledger_for_self_contained_factory_balances_to_zero() {
        // 1× Smelter consuming Iron Ore → producing Iron Ingot
        // + 1× Constructor consuming exactly that ingot → producing Iron Plate
        // The ingot should net to 0 (produced 30 - consumed 30).
        let machines = vec![
            machine("m1", "Build_SmelterMk1_C", "Recipe_IronIngot_C", 1, 100.0),
            machine("m2", "Build_ConstructorMk1_C", "Recipe_IronPlate_C", 1, 100.0),
        ];
        let ledger = compose_ledger("f1", &machines, &gd());
        let ingot = ledger.flows.iter().find(|f| f.item_id == "Desc_IronIngot_C").unwrap();
        assert!((ingot.net_per_minute).abs() < 0.001, "ingot should net to 0, got {}", ingot.net_per_minute);
        let ore = ledger.flows.iter().find(|f| f.item_id == "Desc_IronOre_C").unwrap();
        assert!((ore.net_per_minute - (-30.0)).abs() < 0.001);
        let plate = ledger.flows.iter().find(|f| f.item_id == "Desc_IronPlate_C").unwrap();
        assert!((plate.net_per_minute - 20.0).abs() < 0.001);
    }

    #[test]
    fn ledger_power_sums_per_machine_at_clock() {
        // Smelter is 4 MW. Two of them at 50% should sum to 4 MW total.
        let machines = vec![
            machine("m1", "Build_SmelterMk1_C", "Recipe_IronIngot_C", 1, 50.0),
            machine("m2", "Build_SmelterMk1_C", "Recipe_IronIngot_C", 1, 50.0),
        ];
        let ledger = compose_ledger("f1", &machines, &gd());
        assert!((ledger.power_mw - 4.0).abs() < 0.001, "got {}", ledger.power_mw);
    }

    #[test]
    fn ledger_handles_machine_with_unknown_recipe_safely() {
        let machines = vec![
            machine("m1", "Build_SmelterMk1_C", "Recipe_NonExistent_C", 1, 100.0),
        ];
        let ledger = compose_ledger("f1", &machines, &gd());
        // Unknown recipes contribute no flows, but the machine's building
        // power still counts (the user can see something is consuming power).
        assert!(ledger.flows.is_empty());
        assert!((ledger.power_mw - 4.0).abs() < 0.001);
    }

    #[test]
    fn ledger_overclock_scales_both_inputs_and_outputs() {
        let machines = vec![
            machine("m1", "Build_SmelterMk1_C", "Recipe_IronIngot_C", 1, 250.0),
        ];
        let ledger = compose_ledger("f1", &machines, &gd());
        let ore = ledger.flows.iter().find(|f| f.item_id == "Desc_IronOre_C").unwrap();
        let ingot = ledger.flows.iter().find(|f| f.item_id == "Desc_IronIngot_C").unwrap();
        // 250% on a 30 ipm recipe → 75 ipm both ways.
        assert!((ore.consumed_per_minute - 75.0).abs() < 0.001);
        assert!((ingot.produced_per_minute - 75.0).abs() < 0.001);
    }

    #[test]
    fn validate_factory_name_rejects_empty_and_too_long() {
        assert!(validate_factory_name("").is_err());
        assert!(validate_factory_name("   ").is_err());
        assert!(validate_factory_name(&"x".repeat(81)).is_err());
        assert!(validate_factory_name(&"鉄".repeat(80)).is_ok());
        assert!(validate_factory_name("Iron Plant").is_ok());
    }

    #[test]
    fn validate_count_rejects_zero_and_absurd() {
        assert!(validate_count(0).is_err());
        assert!(validate_count(-1).is_err());
        assert!(validate_count(10_001).is_err());
        assert!(validate_count(1).is_ok());
        assert!(validate_count(10_000).is_ok());
    }

    #[test]
    fn validate_clock_caps_at_1_and_250_percent() {
        assert!(validate_clock(0.0).is_err());
        assert!(validate_clock(0.5).is_err());
        assert!(validate_clock(251.0).is_err());
        assert!(validate_clock(1.0).is_ok());
        assert!(validate_clock(250.0).is_ok());
    }
}
