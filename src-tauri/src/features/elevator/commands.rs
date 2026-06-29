//! Space Elevator slice commands.
//!
//! The only command, [`elevator_overview`], joins the bundled Project Assembly
//! phase requirements against the active playthrough's production. It does the
//! cross-factory aggregation server-side (one IPC round-trip) rather than
//! making the React side fetch every factory ledger separately.
//!
//! VSA note: this slice owns no tables. It reads through the factory and
//! logistics slices' public functions (`factory::repo`, `factory::commands::
//! compose_ledger`, `logistics::repo::link_list`) — never their internals.

use std::collections::HashMap;

use tauri::State;

use crate::features::factory::commands::compose_ledger;
use crate::features::factory::repo as factory_repo;
use crate::features::logistics::repo as logistics_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::shared::db::playthrough_db::PlaythroughDb;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::dto::{ElevatorOverview, ElevatorPartProgress, ElevatorPhase, ElevatorProducer};

#[tauri::command]
pub fn elevator_overview(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<ElevatorOverview> {
    let (_id, db) = active
        .snapshot()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    build_overview(&db, &game_data)
}

/// Pure-ish core of [`elevator_overview`]: everything except pulling the DB
/// handle off Tauri state, so it can be unit-tested with an in-memory DB.
fn build_overview(db: &PlaythroughDb, game_data: &GameData) -> AppResult<ElevatorOverview> {
    let factories = db.with(|c| factory_repo::factory_list(c).map_err(AppError::from))?;
    let links = db.with(|c| logistics_repo::link_list(c).map_err(AppError::from))?;

    // Sum every outgoing link by (source factory, item) — that's the slice of a
    // factory's output already committed to feeding another factory.
    let mut synced_out: HashMap<(String, String), f32> = HashMap::new();
    for link in &links {
        *synced_out
            .entry((link.from_factory_id.clone(), link.item_id.clone()))
            .or_insert(0.0) += link.items_per_minute;
    }

    // Compute each factory's ledger once, up front, so the per-part loop below
    // is a pure in-memory join.
    let mut ledgers = Vec::with_capacity(factories.len());
    for factory in &factories {
        let machines =
            db.with(|c| factory_repo::machines_for_factory(c, &factory.id).map_err(AppError::from))?;
        let ledger = compose_ledger(&factory.id, &machines, game_data);
        ledgers.push((factory.clone(), ledger));
    }

    let phases = game_data
        .space_elevator_phases()
        .iter()
        .map(|phase| {
            let parts = phase
                .parts
                .iter()
                .map(|part| {
                    let item_name = game_data
                        .item(&part.item_id)
                        .map(|i| i.name.clone())
                        .unwrap_or_else(|| part.item_id.clone());

                    let mut producers: Vec<ElevatorProducer> = ledgers
                        .iter()
                        .filter_map(|(factory, ledger)| {
                            let flow = ledger
                                .flows
                                .iter()
                                .find(|f| f.item_id == part.item_id && f.produced_per_minute > 0.0)?;
                            let synced = synced_out
                                .get(&(factory.id.clone(), part.item_id.clone()))
                                .copied()
                                .unwrap_or(0.0);
                            Some(ElevatorProducer {
                                factory_id: factory.id.clone(),
                                factory_name: factory.name.clone(),
                                produced_per_minute: flow.produced_per_minute,
                                consumed_internally_per_minute: flow.consumed_per_minute,
                                synced_out_per_minute: synced,
                                available_per_minute: flow.produced_per_minute
                                    - flow.consumed_per_minute
                                    - synced,
                            })
                        })
                        .collect();
                    // Busiest producer first so the most relevant factory leads.
                    producers.sort_by(|a, b| {
                        b.produced_per_minute
                            .partial_cmp(&a.produced_per_minute)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    });

                    let total_produced_per_minute =
                        producers.iter().map(|p| p.produced_per_minute).sum();

                    ElevatorPartProgress {
                        item_id: part.item_id.clone(),
                        item_name,
                        required_quantity: part.quantity,
                        total_produced_per_minute,
                        producers,
                    }
                })
                .collect();

            ElevatorPhase {
                phase: phase.phase,
                name: phase.name.clone(),
                unlocks_tiers: phase.unlocks_tiers.clone(),
                parts,
            }
        })
        .collect();

    Ok(ElevatorOverview { phases })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part_in<'a>(
        overview: &'a ElevatorOverview,
        phase: u8,
        item_id: &str,
    ) -> &'a ElevatorPartProgress {
        overview
            .phases
            .iter()
            .find(|p| p.phase == phase)
            .unwrap_or_else(|| panic!("phase {phase} present"))
            .parts
            .iter()
            .find(|p| p.item_id == item_id)
            .unwrap_or_else(|| panic!("{item_id} required in phase {phase}"))
    }

    #[test]
    fn overview_lists_every_phase_with_zero_production_by_default() {
        let db = PlaythroughDb::open_in_memory().unwrap();
        let gd = GameData::from_bundled().unwrap();
        let overview = build_overview(&db, &gd).unwrap();

        assert_eq!(overview.phases.len(), 5);
        let smart_plating = part_in(&overview, 1, "Desc_SpaceElevatorPart_1_C");
        assert_eq!(smart_plating.required_quantity, 50);
        assert_eq!(smart_plating.total_produced_per_minute, 0.0);
        assert!(smart_plating.producers.is_empty());
    }

    #[test]
    fn overview_joins_production_and_splits_consumed_synced_available() {
        let db = PlaythroughDb::open_in_memory().unwrap();
        let gd = GameData::from_bundled().unwrap();
        let now = "2026-01-01T00:00:00Z";

        // A factory with one Smart Plating Assembler at 100% ⇒ 2/min.
        db.with(|c| {
            factory_repo::factory_insert(c, "f1", "Plating Plant", None, None, None, now).unwrap();
            factory_repo::factory_insert(c, "f2", "Frame Plant", None, None, None, now).unwrap();
            factory_repo::machine_insert(
                c,
                "m1",
                "f1",
                "Build_AssemblerMk1_C",
                "Recipe_SpaceElevatorPart_1_C",
                1,
                100.0,
                false,
                0,
                0,
                None,
                now,
            )
            .unwrap();
            // 1/min of the Smart Plating is shipped onward to another factory.
            logistics_repo::link_insert(
                c,
                "l1",
                "f1",
                "f2",
                "Desc_SpaceElevatorPart_1_C",
                1.0,
                "belt",
                "{\"belts\":[{\"mark\":1,\"count\":1}]}",
                None,
                None,
                now,
            )
            .unwrap();
        });

        let overview = build_overview(&db, &gd).unwrap();
        let sp = part_in(&overview, 1, "Desc_SpaceElevatorPart_1_C");
        assert_eq!(sp.total_produced_per_minute, 2.0);
        assert_eq!(sp.producers.len(), 1);
        let p = &sp.producers[0];
        assert_eq!(p.factory_id, "f1");
        assert_eq!(p.produced_per_minute, 2.0);
        assert_eq!(p.consumed_internally_per_minute, 0.0);
        assert_eq!(p.synced_out_per_minute, 1.0);
        // 2 produced − 0 internal − 1 synced onward = 1 free for the elevator.
        assert_eq!(p.available_per_minute, 1.0);
    }
}
