//! Tauri command surface for the power slice.

use std::collections::BTreeMap;

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::features::factory::commands::compose_ledger;
use crate::features::factory::repo as factory_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::domain::{generator_fuel_flows, generator_power_mw};
use super::dto::{
    CreatePowerGenInput, FactoryPowerBalance, PowerFuelFlow, PowerGen, SetPowerGenPositionInput,
    UpdatePowerGenInput,
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

fn validate_count(count: i64) -> AppResult<()> {
    if count < 1 {
        return Err(AppError::Invalid("generator count must be 1 or more".into()));
    }
    if count > 1_000 {
        return Err(AppError::Invalid(
            "generator count above 1,000 is almost certainly a typo".into(),
        ));
    }
    Ok(())
}

fn validate_clock(clock_pct: f32) -> AppResult<()> {
    if !clock_pct.is_finite() || !(1.0..=250.0).contains(&clock_pct) {
        return Err(AppError::Invalid(format!(
            "clock must be between 1% and 250% (got {clock_pct})"
        )));
    }
    Ok(())
}

fn lookup_generator_and_fuel<'a>(
    game_data: &'a GameData,
    generator_id: &str,
    fuel_item_id: &str,
) -> AppResult<(
    &'a crate::shared::gamedata::types::Generator,
    &'a crate::shared::gamedata::types::GeneratorFuel,
)> {
    let gen = game_data
        .generator(generator_id)
        .ok_or_else(|| AppError::Invalid(format!("unknown generator id: {generator_id}")))?;
    let fuel = gen
        .fuels
        .iter()
        .find(|f| f.fuel_item_id == fuel_item_id)
        .ok_or_else(|| {
            AppError::Invalid(format!(
                "generator {generator_id} doesn't burn fuel {fuel_item_id}"
            ))
        })?;
    Ok((gen, fuel))
}

#[tauri::command]
pub fn list_power_gens(
    active: State<ActivePlaythrough>,
    factory_id: String,
) -> AppResult<Vec<PowerGen>> {
    let db = require_active(&active)?;
    db.with(|c| repo::power_gens_for_factory(c, &factory_id).map_err(AppError::from))
}

#[tauri::command]
pub fn add_power_gen(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: CreatePowerGenInput,
) -> AppResult<PowerGen> {
    validate_count(input.count)?;
    validate_clock(input.clock_pct)?;
    lookup_generator_and_fuel(&game_data, &input.generator_id, &input.fuel_item_id)?;

    let db = require_active(&active)?;
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    db.with(|c| {
        repo::power_gen_insert(
            c, &id, &input.factory_id, &input.generator_id, &input.fuel_item_id,
            input.count, input.clock_pct, trimmed_notes.as_deref(), &now,
        )
        .map_err(AppError::from)
    })?;
    let rows = db.with(|c| repo::power_gens_for_factory(c, &input.factory_id).map_err(AppError::from))?;
    rows.into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::Internal("power generator disappeared after insert".into()))
}

#[tauri::command]
pub fn update_power_gen(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: UpdatePowerGenInput,
) -> AppResult<()> {
    validate_count(input.count)?;
    validate_clock(input.clock_pct)?;
    // Need the existing row to know which generator it's against (the
    // update form lets the user swap fuel but not generator type).
    let db = require_active(&active)?;
    // Look the existing generator id up so the fuel-validation below can
    // confirm the swap-target fuel is one the row's stored generator
    // actually burns. Using `?` (not `.ok()`) so real DB errors surface
    // as `AppError` instead of silently turning into NotFound later.
    let gen_id_for_row: Option<String> = db.with(|c| {
        match c.query_row(
            "SELECT generator_id FROM power_gen WHERE id = ?",
            [&input.id],
            |r| r.get::<_, String>(0),
        ) {
            Ok(id) => Ok(Some(id)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::from(anyhow::Error::from(e))),
        }
    })?;
    if let Some(gen_id) = gen_id_for_row.as_deref() {
        lookup_generator_and_fuel(&game_data, gen_id, &input.fuel_item_id)?;
    }
    let now = now_iso();
    let trimmed_notes = input.notes.as_deref().map(str::trim).map(str::to_string);
    let affected = db.with(|c| {
        repo::power_gen_update(
            c, &input.id, input.count, input.clock_pct, &input.fuel_item_id,
            trimmed_notes.as_deref(), &now,
        )
        .map_err(AppError::from)
    })?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("power generator {} not found", input.id)));
    }
    Ok(())
}

#[tauri::command]
pub fn list_all_power_gens(active: State<ActivePlaythrough>) -> AppResult<Vec<PowerGen>> {
    let db = require_active(&active)?;
    db.with(|c| repo::power_gens_all(c).map_err(AppError::from))
}

#[tauri::command]
pub fn set_power_gen_position(
    active: State<ActivePlaythrough>,
    input: SetPowerGenPositionInput,
) -> AppResult<()> {
    if !input.world_x.is_finite() || !input.world_y.is_finite() {
        return Err(AppError::Invalid("position coords must be finite".into()));
    }
    let db = require_active(&active)?;
    let now = now_iso();
    let affected = db.with(|c| {
        repo::power_gen_set_position(c, &input.id, input.world_x, input.world_y, &now)
            .map_err(AppError::from)
    })?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("power gen {} not found", input.id)));
    }
    Ok(())
}

#[tauri::command]
pub fn remove_power_gen(active: State<ActivePlaythrough>, id: String) -> AppResult<()> {
    let db = require_active(&active)?;
    let affected = db.with(|c| repo::power_gen_delete(c, &id).map_err(AppError::from))?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("power generator {id} not found")));
    }
    Ok(())
}

#[tauri::command]
pub fn factory_power_balance(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    factory_id: String,
) -> AppResult<FactoryPowerBalance> {
    let db = require_active(&active)?;
    power_balance_impl(&db, &game_data, &factory_id)
}

/// Command-free balance composition so other slices (the validation
/// sweep) reuse the same math instead of reimplementing it.
pub(crate) fn power_balance_impl(
    db: &crate::shared::db::playthrough_db::PlaythroughDb,
    game_data: &GameData,
    factory_id: &str,
) -> AppResult<FactoryPowerBalance> {
    let machines = db.with(|c| {
        factory_repo::machines_for_factory(c, factory_id).map_err(AppError::from)
    })?;
    let consumed_mw = compose_ledger(factory_id, &machines, game_data).power_mw;

    let gens = db.with(|c| repo::power_gens_for_factory(c, factory_id).map_err(AppError::from))?;
    let mut generated_mw = 0.0_f32;
    let mut fuel_totals: BTreeMap<String, f32> = BTreeMap::new();
    for g in &gens {
        // Don't silently drop rows whose generator/fuel id doesn't
        // resolve — that would mask data corruption (or a dataset
        // downgrade) and produce a "looks fine" balance with the wrong
        // numbers. The lookup error surfaces as `AppError::Invalid`
        // and the caller sees which row is bad.
        let (gen, fuel) =
            lookup_generator_and_fuel(game_data, &g.generator_id, &g.fuel_item_id)?;
        generated_mw += generator_power_mw(gen, fuel, g.count, g.clock_pct);
        let (main, supp) = generator_fuel_flows(fuel, g.count, g.clock_pct);
        *fuel_totals.entry(main.0).or_insert(0.0) += main.1;
        if let Some((id, rate)) = supp {
            *fuel_totals.entry(id).or_insert(0.0) += rate;
        }
    }

    let fuel_flows = fuel_totals
        .into_iter()
        .filter(|(_, v)| *v > 0.0)
        .map(|(item_id, per_minute)| {
            let (item_name, is_fluid) = game_data
                .item(&item_id)
                .map(|it| (it.name.clone(), it.is_fluid))
                .unwrap_or((item_id.clone(), false));
            PowerFuelFlow { item_id, item_name, is_fluid, per_minute }
        })
        .collect();

    Ok(FactoryPowerBalance {
        factory_id: factory_id.to_string(),
        generated_mw,
        consumed_mw,
        net_mw: generated_mw - consumed_mw,
        fuel_flows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_count_rejects_zero_negative_and_huge_values() {
        assert!(validate_count(0).is_err());
        assert!(validate_count(-1).is_err());
        assert!(validate_count(2000).is_err());
        assert!(validate_count(4).is_ok());
    }

    #[test]
    fn validate_clock_rejects_zero_negative_and_above_250_and_nan() {
        assert!(validate_clock(0.0).is_err());
        assert!(validate_clock(-1.0).is_err());
        assert!(validate_clock(250.01).is_err());
        assert!(validate_clock(f32::NAN).is_err());
        assert!(validate_clock(100.0).is_ok());
        assert!(validate_clock(250.0).is_ok());
    }
}
