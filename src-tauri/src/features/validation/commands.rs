use std::collections::{HashMap, HashSet};

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::features::alts::repo as alts_repo;
use crate::features::factory::repo as factory_repo;
use crate::features::logistics::repo as logistics_repo;
use crate::features::planner::commands::saved_plan_graph;
use crate::features::planner::repo as plan_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::features::power::commands::power_balance_impl;
use crate::features::resource_nodes::repo as nodes_repo;
use crate::shared::db::playthrough_db::PlaythroughDb;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use super::domain;
use super::dto::{
    Category, FactoryRef, Finding, FindingKind, GridSummary, Severity, ValidationReport,
};

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

#[tauri::command]
pub fn validate_playthrough(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<ValidationReport> {
    let (_id, db) = active
        .snapshot()
        .ok_or_else(|| AppError::Invalid("no active playthrough".into()))?;
    validate_impl(&db, &game_data)
}

pub(crate) fn validate_impl(db: &PlaythroughDb, gd: &GameData) -> AppResult<ValidationReport> {
    let (current_tier, _) = db.with(|c| {
        crate::features::playthrough::repo::progress_get(c).map_err(AppError::from)
    })?;
    let tier: u8 = current_tier.clamp(0, u8::MAX as i64) as u8;

    let factories = db.with(|c| factory_repo::factory_list(c).map_err(AppError::from))?;
    let factory_names: HashMap<String, String> =
        factories.iter().map(|f| (f.id.clone(), f.name.clone())).collect();
    let unlocked: HashSet<String> = db.with(|c| {
        alts_repo::alt_list(c)
            .map(|v| v.into_iter().map(|u| u.recipe_id).collect())
            .map_err(AppError::from)
    })?;
    let claims = db.with(|c| nodes_repo::claims_all(c).map_err(AppError::from))?;
    let links = db.with(|c| logistics_repo::link_list(c).map_err(AppError::from))?;
    let targets = db.with(|c| plan_repo::plan_targets_all(c).map_err(AppError::from))?;

    let mut findings: Vec<Finding> = Vec::new();
    // (factory, recipe_id, in_plan, in_machines) — merged per factory
    // before the shopping list is built.
    let mut alt_hits: Vec<(FactoryRef, String, bool, bool)> = Vec::new();

    let mut grid_generated = 0.0_f32;
    let mut grid_consumed = 0.0_f32;

    for f in &factories {
        let fref = FactoryRef { factory_id: f.id.clone(), factory_name: f.name.clone() };

        // Machines: tier gating + locked alts.
        let machines = db.with(|c| {
            factory_repo::machines_for_factory(c, &f.id).map_err(AppError::from)
        })?;
        domain::check_machines_tier(&fref, &machines, tier, gd, &mut findings);
        let machine_alts = domain::check_machines_locked_alts(&fref, &machines, &unlocked, gd);

        // Saved plan: recompute and inspect.
        let mut plan_alts: Vec<String> = Vec::new();
        match saved_plan_graph(db, gd, &f.id)? {
            None => {}
            Some(Err(reason)) => findings.push(Finding {
                severity: Severity::Error,
                category: Category::SupplyPower,
                kind: FindingKind::PlanDoesNotCompute {
                    factory_id: f.id.clone(),
                    factory_name: f.name.clone(),
                    reason,
                },
            }),
            Some(Ok(graph)) => {
                plan_alts =
                    domain::check_plan_graph(&fref, &graph, tier, &unlocked, gd, &mut findings);
            }
        }

        // Merge machine + plan hits per recipe so one factory wanting an
        // alt in both places is one row, flagged for both.
        let mut merged: HashMap<String, (bool, bool)> = HashMap::new();
        for r in plan_alts {
            merged.entry(r).or_insert((false, false)).0 = true;
        }
        for r in machine_alts {
            merged.entry(r).or_insert((false, false)).1 = true;
        }
        let mut merged: Vec<_> = merged.into_iter().collect();
        merged.sort_by(|a, b| a.0.cmp(&b.0));
        for (recipe_id, (in_plan, in_machines)) in merged {
            alt_hits.push((fref.clone(), recipe_id, in_plan, in_machines));
        }

        // Power.
        match power_balance_impl(db, gd, &f.id) {
            Ok(balance) => {
                grid_generated += balance.generated_mw;
                grid_consumed += balance.consumed_mw;
                if balance.net_mw < -0.001 {
                    findings.push(Finding {
                        severity: Severity::Warning,
                        category: Category::SupplyPower,
                        kind: FindingKind::PowerDeficit {
                            factory_id: f.id.clone(),
                            factory_name: f.name.clone(),
                            net_mw: balance.net_mw,
                        },
                    });
                }
            }
            Err(e) => findings.push(Finding {
                severity: Severity::Warning,
                category: Category::SupplyPower,
                kind: FindingKind::CheckFailed {
                    area: "power".to_string(),
                    factory_name: Some(f.name.clone()),
                    reason: e.to_string(),
                },
            }),
        }
    }

    domain::check_claims(&claims, tier, gd, &mut findings);
    domain::check_links_tier(&links, &factory_names, tier, gd, &mut findings);
    domain::check_flows(&targets, &links, &factory_names, gd, &mut findings);
    let alt_shopping_list = domain::build_alt_shopping_list(&alt_hits, gd, &mut findings);

    if grid_consumed > grid_generated + 0.001 {
        findings.push(Finding {
            severity: Severity::Error,
            category: Category::SupplyPower,
            kind: FindingKind::GridDeficit {
                generated_mw: grid_generated,
                consumed_mw: grid_consumed,
            },
        });
    }

    Ok(ValidationReport {
        current_tier: tier,
        findings,
        alt_shopping_list,
        grid: GridSummary {
            generated_mw: grid_generated,
            consumed_mw: grid_consumed,
            net_mw: grid_generated - grid_consumed,
        },
        checked_at: now_iso(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db(tier: i64) -> PlaythroughDb {
        let db = PlaythroughDb::open_in_memory().expect("open in-memory playthrough db");
        db.with(|c| crate::features::playthrough::repo::progress_init(c, tier))
            .expect("seed progress");
        db
    }

    const NOW: &str = "2026-06-11T00:00:00Z";

    fn insert_factory(db: &PlaythroughDb, id: &str, name: &str) {
        db.with(|c| factory_repo::factory_insert(c, id, name, None, None, None, NOW))
            .expect("insert factory");
    }

    fn insert_machine(db: &PlaythroughDb, factory_id: &str, building: &str, recipe: &str) {
        db.with(|c| {
            factory_repo::machine_insert(
                c,
                &format!("m-{factory_id}-{recipe}"),
                factory_id,
                building,
                recipe,
                1,
                100.0,
                false,
                0,
                0,
                None,
                NOW,
            )
        })
        .expect("insert machine");
    }

    fn kinds(report: &ValidationReport) -> Vec<&FindingKind> {
        report.findings.iter().map(|f| &f.kind).collect()
    }

    #[test]
    fn empty_playthrough_validates_clean() {
        let db = open_test_db(0);
        let gd = GameData::from_bundled().unwrap();
        let report = validate_impl(&db, &gd).unwrap();
        assert!(report.findings.is_empty(), "got {:?}", report.findings);
        assert!(report.alt_shopping_list.is_empty());
        assert_eq!(report.current_tier, 0);
    }

    #[test]
    fn machines_above_tier_flag_after_a_downgrade() {
        // A Manufacturer (T6) running Computers (T6) in a tier-2 world —
        // exactly what a tier downgrade leaves behind.
        let db = open_test_db(2);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Compute Hall");
        insert_machine(&db, "f1", "Build_ManufacturerMk1_C", "Recipe_Computer_C");
        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::MachineRecipeAboveTier { recipe_id, unlock_tier, .. }
                    if recipe_id == "Recipe_Computer_C" && *unlock_tier > 2)),
            "missing recipe finding: {ks:?}"
        );
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::MachineBuildingAboveTier { building_id, .. }
                    if building_id == "Build_ManufacturerMk1_C")),
            "missing building finding: {ks:?}"
        );
        assert!(report.findings.iter().all(|f| f.severity == Severity::Error
            || !matches!(f.kind, FindingKind::MachineRecipeAboveTier { .. })));
    }

    #[test]
    fn locked_alt_in_machines_lands_on_the_shopping_list() {
        // Tier 9 world, alt machine present, alt never collected.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Ingot Works");
        insert_machine(&db, "f1", "Build_SmelterMk1_C", "Recipe_Alternate_IngotIron_C");
        let report = validate_impl(&db, &gd).unwrap();
        assert_eq!(report.alt_shopping_list.len(), 1, "{:?}", report.alt_shopping_list);
        let alt = &report.alt_shopping_list[0];
        assert_eq!(alt.recipe_id, "Recipe_Alternate_IngotIron_C");
        assert_eq!(alt.wanted_by[0].factory_id, "f1");
        assert!(kinds(&report).iter().any(|k| matches!(k,
            FindingKind::LockedAltInUse { in_machines: true, .. })));

        // Collecting it clears the finding.
        db.with(|c| alts_repo::alt_unlock(c, "Recipe_Alternate_IngotIron_C", NOW)).unwrap();
        let report = validate_impl(&db, &gd).unwrap();
        assert!(report.alt_shopping_list.is_empty());
    }

    #[test]
    fn link_overdraw_and_missing_product_flag() {
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "src", "Plate Source");
        insert_factory(&db, "dst", "Plate Sink");
        // Source plans 30 plates with a 10 export slice...
        db.with(|c| {
            plan_repo::plan_targets_replace(
                c,
                "src",
                &[plan_repo::PlanTargetRow {
                    item_id: "Desc_IronPlate_C".into(),
                    ipm: 30.0,
                    export_ipm: Some(10.0),
                    sort_order: 0,
                }],
                NOW,
            )
        })
        .unwrap();
        // ...but a link draws 25, and another link pulls an item the
        // source never makes.
        db.with(|c| {
            logistics_repo::link_insert(
                c, "l1", "src", "dst", "Desc_IronPlate_C", 25.0, "belt", "{}", None, None, NOW,
            )?;
            logistics_repo::link_insert(
                c, "l2", "src", "dst", "Desc_IronRod_C", 5.0, "belt", "{}", None, None, NOW,
            )
        })
        .unwrap();
        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::LinkOverdraw { item_id, drawn_ipm, available_ipm, .. }
                    if item_id == "Desc_IronPlate_C"
                        && (*drawn_ipm - 25.0).abs() < 0.01
                        && (*available_ipm - 10.0).abs() < 0.01)),
            "missing overdraw: {ks:?}"
        );
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::LinkSourceMissingProduct { item_id, .. }
                    if item_id == "Desc_IronRod_C")),
            "missing missing-product: {ks:?}"
        );
    }

    #[test]
    fn grid_deficit_is_an_error_per_factory_deficit_a_warning() {
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Hungry");
        // Machines draw power; no generators anywhere.
        insert_machine(&db, "f1", "Build_SmelterMk1_C", "Recipe_IngotIron_C");
        let report = validate_impl(&db, &gd).unwrap();
        let deficit = report.findings.iter().find(|f| {
            matches!(f.kind, FindingKind::PowerDeficit { .. })
        });
        let grid = report.findings.iter().find(|f| {
            matches!(f.kind, FindingKind::GridDeficit { .. })
        });
        assert_eq!(deficit.map(|f| f.severity), Some(Severity::Warning));
        assert_eq!(grid.map(|f| f.severity), Some(Severity::Error));
        assert!(report.grid.net_mw < 0.0);
    }

    #[test]
    fn claims_with_invalid_or_above_tier_extractors_flag() {
        let db = open_test_db(0);
        let gd = GameData::from_bundled().unwrap();
        let oil = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_LiquidOil_C"
                && n.kind == crate::shared::gamedata::types::NodeKind::MinerNode)
            .unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .unwrap();
        db.with(|c| {
            // Stale Mk2 on an oil seep = invalid extractor; a Mk2 on
            // iron at tier 0 = valid but above tier (Mk2 is T4).
            nodes_repo::claim_upsert(c, &oil.id, Some("Build_MinerMk2_C"), 100.0, None, None, NOW)?;
            nodes_repo::claim_upsert(c, &iron.id, Some("Build_MinerMk2_C"), 100.0, None, None, NOW)
        })
        .unwrap();
        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(ks.iter().any(|k| matches!(k,
            FindingKind::ClaimInvalidExtractor { node_id, .. } if *node_id == oil.id)));
        assert!(ks.iter().any(|k| matches!(k,
            FindingKind::ClaimExtractorAboveTier { node_id, unlock_tier, .. }
                if *node_id == iron.id && *unlock_tier == 4)));
    }
}
