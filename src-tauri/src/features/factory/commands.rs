use std::collections::BTreeMap;

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::dto::{
    AddMachineInput, CreateFactoryInput, Factory, FactoryDetail, FactoryLedger, FactoryMachine,
    ItemFlow, MachineLayout, RenameFactoryInput, SetFactoryIconInput, SetFactoryPositionInput,
    SetMachineLayoutInput, UpdateMachineInput,
};
use super::domain::{machine_power_mw_amp, recipe_io_flows_amp};
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

fn validate_amplification(
    use_somersloop: bool,
    somersloop_slots_filled: i64,
    power_shard_count: i64,
) -> AppResult<()> {
    if !(0..=4).contains(&somersloop_slots_filled) {
        return Err(AppError::Invalid(format!(
            "somersloop_slots_filled must be 0..=4 (got {somersloop_slots_filled})"
        )));
    }
    if !use_somersloop && somersloop_slots_filled > 0 {
        return Err(AppError::Invalid(
            "cannot specify somersloop_slots_filled > 0 when use_somersloop is false"
                .into(),
        ));
    }
    if !(0..=3).contains(&power_shard_count) {
        return Err(AppError::Invalid(format!(
            "power_shard_count must be 0..=3 (got {power_shard_count})"
        )));
    }
    Ok(())
}

/// Maximum clock the machine can sustain given its installed power
/// shards. 0 shards → 100%, 1 → 150%, 2 → 200%, 3 → 250%. The DTO
/// docstring already promised this contract; this helper makes the
/// rule machine-checkable.
fn max_clock_for_shards(power_shard_count: i64) -> f32 {
    100.0 + (power_shard_count.clamp(0, 3) as f32) * 50.0
}

/// Cross-check `clock_pct` against `power_shard_count`. Without this,
/// requests like `(power_shard_count = 0, clock_pct = 250)` would
/// persist impossible machine states and make shard-tracking
/// inaccurate (the player would see "0 shards consumed" while the
/// machine claims to run at 250%).
fn validate_clock_against_shards(clock_pct: f32, power_shard_count: i64) -> AppResult<()> {
    let cap = max_clock_for_shards(power_shard_count);
    // Allow a 0.001 margin so the inclusive boundary survives the
    // floating-point round-trip through the x100 storage.
    if clock_pct > cap + 0.001 {
        return Err(AppError::Invalid(format!(
            "clock {clock_pct}% exceeds the {cap}% cap for {power_shard_count} power shard(s)"
        )));
    }
    Ok(())
}

fn validate_clock(clock_pct: f32) -> AppResult<()> {
    if !(1.0..=250.0).contains(&clock_pct) {
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
    let trimmed_icon = input
        .icon_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    db.with(|c| {
        repo::factory_insert(
            c,
            &id,
            &trimmed_name,
            trimmed_color.as_deref(),
            trimmed_notes.as_deref(),
            trimmed_icon.as_deref(),
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
pub fn set_machine_layout(
    active: State<ActivePlaythrough>,
    input: SetMachineLayoutInput,
) -> AppResult<()> {
    if !input.x.is_finite() || !input.y.is_finite() {
        return Err(AppError::Invalid("layout coords must be finite".into()));
    }
    let db = require_active(&active)?;
    let now = now_iso();
    db.with(|c| {
        repo::machine_layout_upsert(c, &input.machine_id, input.x, input.y, &now)
            .map_err(AppError::from)
    })
}

#[tauri::command]
pub fn list_machine_layouts(
    active: State<ActivePlaythrough>,
    factory_id: String,
) -> AppResult<Vec<MachineLayout>> {
    let db = require_active(&active)?;
    let rows = db.with(|c| {
        repo::machine_layouts_for_factory(c, &factory_id).map_err(AppError::from)
    })?;
    Ok(rows
        .into_iter()
        .map(|(machine_id, x, y)| MachineLayout { machine_id, x, y })
        .collect())
}

#[tauri::command]
pub fn set_factory_position(
    active: State<ActivePlaythrough>,
    input: SetFactoryPositionInput,
) -> AppResult<Factory> {
    if !input.world_x.is_finite() || !input.world_y.is_finite() {
        return Err(AppError::Invalid(
            "world coordinates must be finite numbers".into(),
        ));
    }
    let db = require_active(&active)?;
    let now = now_iso();
    let affected = db.with(|c| {
        repo::factory_set_position(c, &input.id, input.world_x, input.world_y, &now)
            .map_err(AppError::from)
    })?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("factory {} not found", input.id)));
    }
    db.with(|c| repo::factory_get(c, &input.id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("factory {} not found", input.id)))
}

#[tauri::command]
pub fn set_factory_icon(
    active: State<ActivePlaythrough>,
    input: SetFactoryIconInput,
) -> AppResult<Factory> {
    let db = require_active(&active)?;
    let now = now_iso();
    let trimmed = input
        .icon_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let affected = db.with(|c| {
        repo::factory_set_icon(c, &input.id, trimmed.as_deref(), &now).map_err(AppError::from)
    })?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("factory {} not found", input.id)));
    }
    db.with(|c| repo::factory_get(c, &input.id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("factory {} not found", input.id)))
}

#[tauri::command]
pub fn delete_factory(active: State<ActivePlaythrough>, id: String) -> AppResult<()> {
    let db = require_active(&active)?;
    // Wrap in a transaction so the factory delete + the train-route
    // cleanup land atomically. Without the cleanup, deleting a factory
    // that's a stop on a 2-stop route would cascade-delete its stop
    // and leave the parent route stranded with 1 stop — violating the
    // trains slice's ≥2-stops invariant.
    db.with(|c| {
        let tx = c.transaction().map_err(|e| AppError::from(anyhow::Error::from(e)))?;
        repo::factory_delete(&tx, &id).map_err(AppError::from)?;
        crate::features::trains::repo::routes_drop_below_two_stops(&tx)
            .map_err(AppError::from)?;
        tx.commit().map_err(|e| AppError::from(anyhow::Error::from(e)))?;
        Ok::<(), AppError>(())
    })
}

#[tauri::command]
pub fn add_factory_machine(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: AddMachineInput,
) -> AppResult<FactoryMachine> {
    validate_count(input.count)?;
    validate_clock(input.clock_pct)?;
    validate_amplification(
        input.use_somersloop,
        input.somersloop_slots_filled,
        input.power_shard_count,
    )?;
    validate_clock_against_shards(input.clock_pct, input.power_shard_count)?;
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
            input.use_somersloop,
            input.somersloop_slots_filled,
            input.power_shard_count,
            None,
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
    game_data: State<GameData>,
    input: UpdateMachineInput,
) -> AppResult<()> {
    validate_count(input.count)?;
    validate_clock(input.clock_pct)?;
    validate_amplification(
        input.use_somersloop,
        input.somersloop_slots_filled,
        input.power_shard_count,
    )?;
    validate_clock_against_shards(input.clock_pct, input.power_shard_count)?;
    let db = require_active(&active)?;
    let now = now_iso();
    let affected = if let (Some(recipe_id), Some(building_id)) =
        (input.recipe_id.as_deref(), input.building_id.as_deref())
    {
        // Cross-check the recipe/building against the dataset so a
        // typo or stale id doesn't leave the row in an inconsistent
        // state.
        let recipe = game_data
            .recipe(recipe_id)
            .ok_or_else(|| AppError::Invalid(format!("unknown recipe: {recipe_id}")))?;
        if recipe.building_id != building_id {
            return Err(AppError::Invalid(format!(
                "recipe {recipe_id} runs in {} not {building_id}",
                recipe.building_id
            )));
        }
        db.with(|c| {
            repo::machine_update_with_recipe(
                c, &input.id, building_id, recipe_id, input.count, input.clock_pct,
                input.use_somersloop, input.somersloop_slots_filled, input.power_shard_count,
                &now,
            )
            .map_err(AppError::from)
        })?
    } else {
        db.with(|c| {
            repo::machine_update(
                c, &input.id, input.count, input.clock_pct,
                input.use_somersloop, input.somersloop_slots_filled, input.power_shard_count,
                &now,
            )
            .map_err(AppError::from)
        })?
    };
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
    let claims = db.with(|c| {
        crate::features::resource_nodes::repo::claims_all(c).map_err(AppError::from)
    })?;
    let supply =
        crate::features::resource_nodes::domain::supply_for_factory(&claims, &factory_id, &game_data);
    Ok(compose_ledger_with_supply(&factory_id, &machines, &game_data, &supply))
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
    let claims = db.with(|c| {
        crate::features::resource_nodes::repo::claims_all(c).map_err(AppError::from)
    })?;
    let supply =
        crate::features::resource_nodes::domain::supply_for_factory(&claims, &id, &game_data);
    let ledger = compose_ledger_with_supply(&id, &machines, &game_data, &supply);
    Ok(FactoryDetail {
        factory,
        machines,
        ledger,
    })
}

/// Returns the Somersloop amplifier slot count for a building id.
/// 4 slots: Manufacturer, Blender, Particle Accelerator, Quantum
/// Encoder. Everything else: 1 slot. Centralised here so the ledger
/// (and any future caller) reads from a single source until the
/// dataset grows a `Building.amp_slots` column in Phase 11.
fn amp_slots_for_building(building_id: &str) -> u8 {
    matches!(
        building_id,
        "Build_ManufacturerMk1_C"
            | "Build_Blender_C"
            | "Build_HadronCollider_C"
            | "Build_QuantumEncoder_C"
    )
    .then_some(4)
    .unwrap_or(1)
}

/// Aggregate ledger across all machines in a factory. Pure given the inputs;
/// no DB or Tauri State touched here so it can be unit-tested directly.
pub fn compose_ledger(
    factory_id: &str,
    machines: &[FactoryMachine],
    game_data: &GameData,
) -> FactoryLedger {
    compose_ledger_with_supply(factory_id, machines, game_data, &std::collections::HashMap::new())
}

/// Same as `compose_ledger` but also annotates each `ItemFlow` with the
/// ipm available from resource nodes bound to this factory. The
/// power slice + tests stay on `compose_ledger` and get the zero-supply
/// behaviour by default.
pub fn compose_ledger_with_supply(
    factory_id: &str,
    machines: &[FactoryMachine],
    game_data: &GameData,
    node_supply: &std::collections::HashMap<String, f32>,
) -> FactoryLedger {
    let mut produced: BTreeMap<String, f32> = BTreeMap::new();
    let mut consumed: BTreeMap<String, f32> = BTreeMap::new();
    let mut power_mw = 0.0_f32;

    for m in machines {
        // Phase 8: amplification is opt-in. When `use_somersloop` is
        // false the slot count is forced to 0 here (defence-in-depth —
        // the command-layer validator already rejects the invalid combo)
        // so the amp factor collapses to 1× and we get the unamplified
        // result without a separate code path. `amp_total` is sourced
        // per-building so 1-slot machines (Constructor, Smelter, etc.)
        // don't get 1/4 instead of 1/1 when fully filled.
        let amp_total: u8 = amp_slots_for_building(&m.building_id);
        let amp_filled: u8 = if m.use_somersloop {
            // Clamp to the building's actual slot count so a stale row
            // (e.g. swapped recipe to a Constructor while a Manufacturer-
            // sized fill was recorded) doesn't push the ratio above 1.
            m.somersloop_slots_filled.clamp(0, amp_total as i64) as u8
        } else {
            0
        };
        if let Some(recipe) = game_data.recipe(&m.recipe_id) {
            let (ins, outs) = recipe_io_flows_amp(
                recipe, m.count, m.clock_pct, amp_filled, amp_total,
            );
            for (item, ipm) in ins {
                *consumed.entry(item).or_insert(0.0) += ipm;
            }
            for (item, ipm) in outs {
                *produced.entry(item).or_insert(0.0) += ipm;
            }
        }
        if let Some(building) = game_data.building(&m.building_id) {
            power_mw += machine_power_mw_amp(
                building.power_mw, m.count, m.clock_pct, amp_filled, amp_total,
            );
        }
    }

    // Include items that are *only* fed by bound nodes (e.g. the user
    // wired water wells to this factory before adding any water-using
    // machines) so the supply chip isn't silently invisible.
    let mut all_ids: Vec<String> = produced
        .keys()
        .chain(consumed.keys())
        .chain(node_supply.keys())
        .cloned()
        .collect();
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
            let from_nodes = *node_supply.get(&item_id).unwrap_or(&0.0);
            ItemFlow {
                item_id,
                item_name: name,
                is_fluid,
                produced_per_minute: p,
                consumed_per_minute: c,
                net_per_minute: p - c,
                from_nodes_per_minute: from_nodes,
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

    #[test]
    fn amp_slots_for_known_4_slot_buildings_returns_4() {
        assert_eq!(amp_slots_for_building("Build_ManufacturerMk1_C"), 4);
        assert_eq!(amp_slots_for_building("Build_Blender_C"), 4);
        assert_eq!(amp_slots_for_building("Build_HadronCollider_C"), 4);
        assert_eq!(amp_slots_for_building("Build_QuantumEncoder_C"), 4);
    }

    #[test]
    fn amp_slots_for_other_buildings_defaults_to_1() {
        assert_eq!(amp_slots_for_building("Build_SmelterMk1_C"), 1);
        assert_eq!(amp_slots_for_building("Build_ConstructorMk1_C"), 1);
        assert_eq!(amp_slots_for_building("Build_AssemblerMk1_C"), 1);
        assert_eq!(amp_slots_for_building("Build_FoundryMk1_C"), 1);
        assert_eq!(amp_slots_for_building("Build_OilRefinery_C"), 1);
        // Unknown ids also default to 1 — Phase 11 dataset will replace
        // this whole helper, so the conservative pick now is "trust the
        // amp_filled value 1:1 for new buildings" rather than silently
        // applying a 4× cap.
        assert_eq!(amp_slots_for_building("Build_Future_C"), 1);
    }

    #[test]
    fn max_clock_for_shards_steps_50_per_shard_from_100_to_250() {
        assert!((max_clock_for_shards(0) - 100.0).abs() < 0.001);
        assert!((max_clock_for_shards(1) - 150.0).abs() < 0.001);
        assert!((max_clock_for_shards(2) - 200.0).abs() < 0.001);
        assert!((max_clock_for_shards(3) - 250.0).abs() < 0.001);
        // Out-of-range shard count clamps; the validator catches the
        // out-of-range case earlier but the helper stays correct anyway.
        assert!((max_clock_for_shards(99) - 250.0).abs() < 0.001);
    }

    #[test]
    fn validate_clock_against_shards_rejects_overclock_without_enough_shards() {
        // Codex P2: 0 shards, 250% clock should be rejected.
        assert!(validate_clock_against_shards(250.0, 0).is_err());
        assert!(validate_clock_against_shards(150.01, 0).is_err());
        assert!(validate_clock_against_shards(200.0, 1).is_err());
        // Boundaries are inclusive within the floating-point margin.
        assert!(validate_clock_against_shards(100.0, 0).is_ok());
        assert!(validate_clock_against_shards(150.0, 1).is_ok());
        assert!(validate_clock_against_shards(200.0, 2).is_ok());
        assert!(validate_clock_against_shards(250.0, 3).is_ok());
    }

    fn machine(id: &str, building: &str, recipe: &str, count: i64, clock: f32) -> FactoryMachine {
        FactoryMachine {
            id: id.into(),
            factory_id: "f1".into(),
            building_id: building.into(),
            recipe_id: recipe.into(),
            count,
            clock_pct: clock,
            use_somersloop: false,
            somersloop_slots_filled: 0,
            power_shard_count: 0,
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
            machine("m1", "Build_SmelterMk1_C", "Recipe_IngotIron_C", 1, 100.0),
            machine("m2", "Build_ConstructorMk1_C", "Recipe_IronPlate_C", 1, 100.0),
        ];
        let ledger = compose_ledger("f1", &machines, &gd());
        let ingot = ledger.flows.iter().find(|f| f.item_id == "Desc_IronIngot_C").unwrap();
        assert!((ingot.net_per_minute).abs() < 0.001, "ingot should net to 0, got {}", ingot.net_per_minute);
        let ore = ledger.flows.iter().find(|f| f.item_id == "Desc_OreIron_C").unwrap();
        assert!((ore.net_per_minute - (-30.0)).abs() < 0.001);
        let plate = ledger.flows.iter().find(|f| f.item_id == "Desc_IronPlate_C").unwrap();
        assert!((plate.net_per_minute - 20.0).abs() < 0.001);
    }

    #[test]
    fn ledger_power_sums_per_machine_at_clock_with_overclock_curve() {
        // Phase 8: power uses the wiki's `clock^1.321928` curve even
        // without amplification. Smelter base = 4 MW; two of them at 50%
        // each draws `4 × 1 × 1 × 0.5^1.321928 ≈ 4 × 0.4 ≈ 1.6 MW each`,
        // total ≈ 3.2 MW (vs the old linear 4 MW). The change is
        // intentional — the linear model in Phase 4 was a placeholder.
        let machines = vec![
            machine("m1", "Build_SmelterMk1_C", "Recipe_IngotIron_C", 1, 50.0),
            machine("m2", "Build_SmelterMk1_C", "Recipe_IngotIron_C", 1, 50.0),
        ];
        let ledger = compose_ledger("f1", &machines, &gd());
        let expected = 2.0 * 4.0 * (0.5_f32).powf(1.321928);
        assert!(
            (ledger.power_mw - expected).abs() < 0.01,
            "got {}, expected ~{expected}",
            ledger.power_mw
        );
    }

    #[test]
    fn ledger_handles_machine_with_unknown_recipe_safely() {
        let machines = vec![
            machine("m1", "Build_SmelterMk1_C", "Recipe_NonExistent_C", 1, 100.0),
        ];
        let ledger = compose_ledger("f1", &machines, &gd());
        // Unknown recipes contribute no flows, but the machine's building
        // power still counts (the user can see something is consuming power).
        // At 100% clock the overclock factor is 1.0 so the result matches
        // the unamplified base of 4 MW.
        assert!(ledger.flows.is_empty());
        assert!((ledger.power_mw - 4.0).abs() < 0.001);
    }

    #[test]
    fn ledger_overclock_scales_both_inputs_and_outputs() {
        let machines = vec![
            machine("m1", "Build_SmelterMk1_C", "Recipe_IngotIron_C", 1, 250.0),
        ];
        let ledger = compose_ledger("f1", &machines, &gd());
        let ore = ledger.flows.iter().find(|f| f.item_id == "Desc_OreIron_C").unwrap();
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
