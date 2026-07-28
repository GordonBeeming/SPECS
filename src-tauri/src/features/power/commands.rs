//! Tauri command surface for the power slice.

use std::collections::BTreeMap;

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::features::factory::commands::compose_ledger_with_supply;
use crate::features::factory::repo as factory_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::features::resource_nodes::repo as nodes_repo;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::domain::{generator_byproduct_flow, generator_fuel_flows, generator_power_mw};
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

/// Every factory's power balance in one call — the Power screen's grid
/// total and its "which factories have no power" prominence both need
/// every factory, not just the ones that already carry a generator.
#[tauri::command]
pub fn list_power_balances(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<Vec<FactoryPowerBalance>> {
    let db = require_active(&active)?;
    list_power_balances_impl(&db, &game_data)
}

fn list_power_balances_impl(
    db: &crate::shared::db::playthrough_db::PlaythroughDb,
    game_data: &GameData,
) -> AppResult<Vec<FactoryPowerBalance>> {
    let factories = db.with(|c| factory_repo::factory_list(c).map_err(AppError::from))?;
    // Claims and water groups are whole-playthrough tables, not
    // per-factory — load each once and thread it through every factory's
    // balance instead of letting `power_balance_with_supply` re-query
    // them per factory, which turned one Power screen load into N full
    // table scans.
    let claims = db.with(|c| nodes_repo::claims_all(c).map_err(AppError::from))?;
    let water_groups = db.with(|c| nodes_repo::water_groups_all(c).map_err(AppError::from))?;
    let tier = current_tier(db)?;
    factories
        .iter()
        .map(|f| power_balance_with_supply(db, game_data, &f.id, &claims, &water_groups, tier))
        .collect()
}

/// The playthrough's current tier — one read for the whole batch, for
/// the same reason claims and water groups are loaded once above.
fn current_tier(db: &crate::shared::db::playthrough_db::PlaythroughDb) -> AppResult<u8> {
    let (tier, _progress) = db.with(|c| {
        crate::features::playthrough::repo::progress_get(c).map_err(AppError::from)
    })?;
    Ok(tier.clamp(0, u8::MAX as i64) as u8)
}

/// Command-free balance composition so other slices (the validation
/// sweep) reuse the same math instead of reimplementing it. Fetches
/// claims/water groups itself — the single-factory case this backs
/// (`factory_power_balance`) only ever needs one query each, so there's
/// no batching to be done here. A caller computing balances for several
/// factories in one pass (`list_power_balances_impl`, the validation
/// sweep) should call `power_balance_with_supply` directly with claims
/// and water groups it already loaded, instead of this.
pub(crate) fn power_balance_impl(
    db: &crate::shared::db::playthrough_db::PlaythroughDb,
    game_data: &GameData,
    factory_id: &str,
) -> AppResult<FactoryPowerBalance> {
    let claims = db.with(|c| nodes_repo::claims_all(c).map_err(AppError::from))?;
    let water_groups = db.with(|c| nodes_repo::water_groups_all(c).map_err(AppError::from))?;
    let tier = current_tier(db)?;
    power_balance_with_supply(db, game_data, factory_id, &claims, &water_groups, tier)
}

/// Same math as `power_balance_impl`, but takes already-loaded claims
/// and water groups instead of querying them itself — see that
/// function's doc for why a multi-factory caller wants this one.
pub(crate) fn power_balance_with_supply(
    db: &crate::shared::db::playthrough_db::PlaythroughDb,
    game_data: &GameData,
    factory_id: &str,
    claims: &std::collections::HashMap<String, nodes_repo::ClaimRow>,
    water_groups: &[nodes_repo::WaterGroupRow],
    tier: u8,
) -> AppResult<FactoryPowerBalance> {
    let machines = db.with(|c| {
        factory_repo::machines_for_factory(c, factory_id).map_err(AppError::from)
    })?;
    // Extractors (miners, water/oil pumps, resource wells) never show up
    // as factory machines — they're claimed against a map node, not
    // added to a factory's machine bank. `compose_ledger_with_supply`
    // folds their draw onto `power_mw` itself given the raw claims/water
    // groups, so passing them through here is enough to get the true
    // consumption rather than having to add it on by hand.
    let consumed_mw = compose_ledger_with_supply(
        factory_id,
        &machines,
        game_data,
        claims,
        water_groups,
        &std::collections::HashMap::new(),
        tier,
    )
    .power_mw;

    let mut generated_mw = 0.0_f32;
    let mut fuel_totals: BTreeMap<String, f32> = BTreeMap::new();
    let mut byproduct_totals: BTreeMap<String, f32> = BTreeMap::new();

    // A nuclear waste recipe is materialized as an ordinary
    // `factory_machine` row so the planner can chain through it — its
    // building is `Build_GeneratorNuclear_C`, whose `power_mw` is
    // authored as 0 because a generator's draw side is nothing (see
    // convert-game-data.ts). Left uncounted here, a plan that produces
    // nuclear waste builds a Nuclear Power Plant that contributes
    // neither its generation nor its fuel/byproduct flows to the grid,
    // and the only way to see them was to re-declare the same physical
    // plant as a manual `power_gen` row — double-counting it.
    //
    // Fuel and byproduct flows are credited here too, the same as
    // generation. This does not double-count `consumed_mw`: that's a
    // single MW scalar from `compose_ledger_with_supply`, not a sum of
    // these per-item totals, so the two never touch. The one thing this
    // does duplicate is *display*, not counting — the factory's own
    // ledger table already lists the fuel rod and waste as the recipe's
    // ordinary inputs/outputs, and the Power view's fuel/byproduct cards
    // now show the same fact from a different angle (what this factory
    // draws from and emits into the grid). Showing the same real number
    // on two screens for two different questions is fine; the failure
    // mode this avoids is a plant reading 1,250 MW generated with an
    // empty fuel-demand card, which is what a reader distrusts.
    for m in &machines {
        let Some(gen) = game_data.generator(&m.building_id) else {
            continue;
        };
        let Some(fuel_item_id) = game_data
            .recipe(&m.recipe_id)
            .and_then(|r| r.inputs.first())
            .map(|i| i.item_id.as_str())
        else {
            continue;
        };
        if let Some(fuel) = gen.fuels.iter().find(|f| f.fuel_item_id == fuel_item_id) {
            generated_mw += generator_power_mw(gen, fuel, m.count, m.clock_pct);
            let (main, supp) = generator_fuel_flows(fuel, m.count, m.clock_pct);
            *fuel_totals.entry(main.0).or_insert(0.0) += main.1;
            if let Some((id, rate)) = supp {
                *fuel_totals.entry(id).or_insert(0.0) += rate;
            }
            if let Some((id, rate)) = generator_byproduct_flow(fuel, m.count, m.clock_pct) {
                *byproduct_totals.entry(id).or_insert(0.0) += rate;
            }
        }
    }

    let gens = db.with(|c| repo::power_gens_for_factory(c, factory_id).map_err(AppError::from))?;
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
        if let Some((id, rate)) = generator_byproduct_flow(fuel, g.count, g.clock_pct) {
            *byproduct_totals.entry(id).or_insert(0.0) += rate;
        }
    }

    let to_flows = |totals: BTreeMap<String, f32>| -> Vec<PowerFuelFlow> {
        totals
            .into_iter()
            .filter(|(_, v)| *v > 0.0)
            .map(|(item_id, per_minute)| {
                let (item_name, is_fluid) = game_data
                    .item(&item_id)
                    .map(|it| (it.name.clone(), it.is_fluid))
                    .unwrap_or((item_id.clone(), false));
                PowerFuelFlow { item_id, item_name, is_fluid, per_minute }
            })
            .collect()
    };

    Ok(FactoryPowerBalance {
        factory_id: factory_id.to_string(),
        generated_mw,
        consumed_mw,
        net_mw: generated_mw - consumed_mw,
        fuel_flows: to_flows(fuel_totals),
        byproduct_flows: to_flows(byproduct_totals),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::db::playthrough_db::PlaythroughDb;

    const NOW: &str = "2026-06-11T00:00:00Z";

    /// A balance now reads the playthrough's tier (a claim contributes
    /// what its port can deliver at that tier), and every real
    /// playthrough DB is created with a progress row — so seed one here
    /// rather than exercising a shape the app can't be in.
    fn open_test_db(tier: i64) -> PlaythroughDb {
        let db = PlaythroughDb::open_in_memory().expect("open in-memory playthrough db");
        db.with(|c| crate::features::playthrough::repo::progress_init(c, tier))
            .expect("seed progress");
        db
    }

    #[test]
    fn power_balance_includes_bound_extractor_draw_alongside_machines() {
        // Tier-0 acceptance shape: a Cable constructor at 50% clock
        // (1.6 MW under the real curve) plus one Miner Mk1 (5 MW) bound
        // to the same factory. Before this fix the miner contributed 0
        // MW and this factory's `consumed_mw` read 1.6 instead of 6.6 —
        // the exact hole issue #55 was filed against.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| factory_repo::factory_insert(c, "f1", "Copper Works", None, None, None, NOW))
            .expect("insert factory");
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m1", "f1", "Build_ConstructorMk1_C", "Recipe_Cable_C", 1, 50.0, false, 0, 0,
                None, NOW,
            )
        })
        .expect("insert machine");
        let iron_node = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .expect("dataset ships an iron node")
            .id
            .clone();
        db.with(|c| {
            nodes_repo::claim_upsert(c, &iron_node, Some("Build_MinerMk1_C"), 100.0, Some("f1"), None, NOW)
        })
        .expect("claim node for f1");

        let balance = power_balance_impl(&db, &gd, "f1").expect("balance computes");
        assert!(
            (balance.consumed_mw - 6.6).abs() < 0.01,
            "expected 1.6 MW machine + 5 MW miner = 6.6, got {}",
            balance.consumed_mw
        );
    }

    #[test]
    fn power_balance_reports_the_waste_a_nuclear_bank_emits() {
        // The plant's panel used to list its fuel and water and no
        // output of any kind, so a nuclear factory had nowhere to state
        // where its waste goes. Two plants at 50% burn 0.2 rods/min and
        // emit 10 ipm of Uranium Waste — half of two plants' 10/min
        // each.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| factory_repo::factory_insert(c, "f1", "Nuclear", None, None, None, NOW))
            .expect("insert factory");
        db.with(|c| {
            repo::power_gen_insert(
                c, "g1", "f1", "Build_GeneratorNuclear_C", "Desc_NuclearFuelRod_C", 2, 50.0,
                None, NOW,
            )
        })
        .expect("insert generator");

        let balance = power_balance_impl(&db, &gd, "f1").expect("balance computes");
        let waste = balance
            .byproduct_flows
            .iter()
            .find(|f| f.item_id == "Desc_NuclearWaste_C")
            .expect("the bank emits Uranium Waste");
        assert_eq!(waste.item_name, "Uranium Waste");
        assert!((waste.per_minute - 10.0).abs() < 0.01, "got {}", waste.per_minute);
        assert!(
            balance.fuel_flows.iter().any(|f| f.item_id == "Desc_NuclearFuelRod_C"),
            "the consumed side still reports the rods"
        );
    }

    #[test]
    fn power_balance_counts_generation_and_flows_from_a_plan_saved_nuclear_plant() {
        // A plan that produces nuclear waste materializes the burn
        // recipe as an ordinary factory_machine (Build_GeneratorNuclear_C
        // / Recipe_NuclearWaste_C) so the planner can chain through it.
        // Before this fix that machine's generation, fuel demand and
        // byproduct output never reached the balance — only manual
        // power_gen rows did — so the Power view showed a plant
        // generating nothing, burning nothing and emitting nothing, on a
        // building whose power_mw is deliberately authored as 0 (a
        // generator's draw side is nothing; see convert-game-data.ts).
        // One plant at 50% clock: 2,500 × 0.5 = 1,250 MW, 0.2 × 0.5 =
        // 0.1 rods/min, 240 × 0.5 = 120 m³/min water, 10 × 0.5 = 5
        // Uranium Waste/min.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| factory_repo::factory_insert(c, "f1", "Nuclear", None, None, None, NOW))
            .expect("insert factory");
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m1", "f1", "Build_GeneratorNuclear_C", "Recipe_NuclearWaste_C", 1, 50.0,
                false, 0, 0, None, NOW,
            )
        })
        .expect("insert machine");

        let balance = power_balance_impl(&db, &gd, "f1").expect("balance computes");
        assert!(
            (balance.generated_mw - 1250.0).abs() < 0.01,
            "expected 1,250 MW from one plant at 50%, got {}",
            balance.generated_mw
        );
        let rod = balance
            .fuel_flows
            .iter()
            .find(|f| f.item_id == "Desc_NuclearFuelRod_C")
            .expect("fuel demand shows the rod, not just an empty card");
        assert!((rod.per_minute - 0.1).abs() < 0.001, "got {}", rod.per_minute);
        let water = balance
            .fuel_flows
            .iter()
            .find(|f| f.item_id == "Desc_Water_C")
            .expect("fuel demand shows the coolant too");
        assert!((water.per_minute - 120.0).abs() < 0.01, "got {}", water.per_minute);
        let waste = balance
            .byproduct_flows
            .iter()
            .find(|f| f.item_id == "Desc_NuclearWaste_C")
            .expect("byproducts show the waste, not just an empty card");
        assert!((waste.per_minute - 5.0).abs() < 0.01, "got {}", waste.per_minute);
    }

    #[test]
    fn power_balance_reports_no_byproducts_for_a_clean_burner() {
        // Only nuclear emits anything; a coal bank must not grow an
        // empty-but-present waste row for the Power view to render.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| factory_repo::factory_insert(c, "f1", "Coal", None, None, None, NOW))
            .expect("insert factory");
        db.with(|c| {
            repo::power_gen_insert(
                c, "g1", "f1", "Build_GeneratorCoal_C", "Desc_Coal_C", 1, 100.0, None, NOW,
            )
        })
        .expect("insert generator");

        let balance = power_balance_impl(&db, &gd, "f1").expect("balance computes");
        assert!(balance.byproduct_flows.is_empty());
        assert!(!balance.fuel_flows.is_empty());
    }

    #[test]
    fn list_power_balances_includes_factories_with_no_generators() {
        // The Power view's old data source only ever fetched a balance
        // for the one selected factory, so a generator-less factory
        // never rendered — this is the query the fixed screen uses to
        // show every factory (and its grid-wide total) at once.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| factory_repo::factory_insert(c, "powered", "Has Gens", None, None, None, NOW))
            .expect("insert factory");
        db.with(|c| factory_repo::factory_insert(c, "unpowered", "No Gens", None, None, None, NOW))
            .expect("insert factory");
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m1", "unpowered", "Build_SmelterMk1_C", "Recipe_IngotIron_C", 1, 100.0, false,
                0, 0, None, NOW,
            )
        })
        .expect("insert machine");

        let balances = list_power_balances_impl(&db, &gd).expect("balances compute");
        assert_eq!(balances.len(), 2, "every factory must appear, not just powered ones");
        let unpowered = balances
            .iter()
            .find(|b| b.factory_id == "unpowered")
            .expect("unpowered factory present");
        assert!(unpowered.consumed_mw > 0.0, "its Smelter still draws power");
        assert_eq!(unpowered.generated_mw, 0.0);
        assert!(unpowered.net_mw < 0.0, "draw with no generators is a deficit");
    }

    #[test]
    fn list_power_balances_attributes_claims_to_the_right_factory() {
        // Codex nit: `list_power_balances_impl` now loads claims/water
        // groups once and threads them into `power_balance_with_supply`
        // per factory instead of each factory re-querying both tables.
        // Two factories with an extractor claim bound to only one of
        // them is the case that would leak if the threading mixed claims
        // up across factories instead of keeping the per-factory filter
        // `compose_ledger_with_supply` already applies.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| factory_repo::factory_insert(c, "f1", "Claims Iron", None, None, None, NOW))
            .expect("insert f1");
        db.with(|c| factory_repo::factory_insert(c, "f2", "No Claims", None, None, None, NOW))
            .expect("insert f2");
        let iron_node = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .expect("dataset ships an iron node")
            .id
            .clone();
        db.with(|c| {
            nodes_repo::claim_upsert(c, &iron_node, Some("Build_MinerMk1_C"), 100.0, Some("f1"), None, NOW)
        })
        .expect("claim node for f1");

        let balances = list_power_balances_impl(&db, &gd).expect("balances compute");
        let f1 = balances.iter().find(|b| b.factory_id == "f1").unwrap();
        let f2 = balances.iter().find(|b| b.factory_id == "f2").unwrap();
        assert!((f1.consumed_mw - 5.0).abs() < 0.01, "f1's Miner Mk1 draws 5 MW, got {}", f1.consumed_mw);
        assert_eq!(f2.consumed_mw, 0.0, "f2's claim-free balance must not pick up f1's extractor");
    }

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
