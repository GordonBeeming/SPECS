use std::collections::{HashMap, HashSet};

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::features::alts::repo as alts_repo;
use crate::features::factory::repo as factory_repo;
use crate::features::logistics::repo as logistics_repo;
use crate::features::factory::commands::compose_ledger_with_supply;
use crate::features::planner::commands::saved_plan_graph;
use crate::features::planner::repo as plan_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::features::power::commands::power_balance_with_supply;
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
    let water_groups = db.with(|c| nodes_repo::water_groups_all(c).map_err(AppError::from))?;
    let links = db.with(|c| logistics_repo::link_list(c).map_err(AppError::from))?;
    let targets = db.with(|c| plan_repo::plan_targets_all(c).map_err(AppError::from))?;

    let mut findings: Vec<Finding> = Vec::new();
    // (factory, recipe_id, in_plan, in_machines) — merged per factory
    // before the shopping list is built.
    let mut alt_hits: Vec<(FactoryRef, String, bool, bool)> = Vec::new();

    let mut grid_generated = 0.0_f32;
    let mut grid_consumed = 0.0_f32;
    // Held until the grid total is known: Satisfactory has one shared
    // grid, so a factory with no generators of its own is normal, not a
    // problem, as long as the grid overall covers the draw. Only surface
    // these once the grid is actually short (see below).
    let mut per_factory_deficits: Vec<(String, String, f32)> = Vec::new();
    // (factory, item) pairs produced by manual machine banks — legacy
    // factories without saved plans still legitimately feed links.
    let mut manual_produced: HashSet<(String, String)> = HashSet::new();

    for f in &factories {
        let fref = FactoryRef { factory_id: f.id.clone(), factory_name: f.name.clone() };

        // Machines: tier gating + locked alts.
        let machines = db.with(|c| {
            factory_repo::machines_for_factory(c, &f.id).map_err(AppError::from)
        })?;
        domain::check_machines_tier(&fref, &machines, tier, gd, &mut findings);
        let machine_alts = domain::check_machines_locked_alts(&machines, tier, &unlocked, gd);
        for m in &machines {
            if let Some(r) = gd.recipe(&m.recipe_id) {
                for o in &r.outputs {
                    manual_produced.insert((f.id.clone(), o.item_id.clone()));
                }
            }
        }

        // Saved plan: recompute and inspect. A failure to even load one
        // factory's plan must not kill the sweep — report it and move on
        // (validation reports, never blocks).
        let mut plan_alts: Vec<String> = Vec::new();
        // Machine-side raw demand per item, for folding generator fuel
        // draw onto the same claimed-supply comparison below. Filled from
        // the saved plan's raw_demand when there is one; a factory with
        // no saved plan falls back to its machines' direct ingredient
        // draw below (see `has_plan_graph`) rather than staying empty.
        let mut machine_raw_demand: HashMap<String, f32> = HashMap::new();
        // Just the graph's own portion of `machine_raw_demand` — the
        // part `check_plan_graph`'s forwarded `RawShort` actually
        // covers. Kept separate from `machine_raw_demand` once manual
        // rows are folded in below, so the generator-fuel check can
        // tell "already reported" apart from "just happens to share a
        // HashMap entry with something that was".
        let mut demand_reported_elsewhere: HashMap<String, f32> = HashMap::new();
        let mut has_plan_graph = false;
        match saved_plan_graph(db, gd, &f.id) {
            Err(e) => findings.push(Finding {
                severity: Severity::Warning,
                category: Category::SupplyPower,
                kind: FindingKind::CheckFailed {
                    area: "plan".to_string(),
                    factory_name: Some(f.name.clone()),
                    reason: e.to_string(),
                },
            }),
            Ok(None) => {}
            Ok(Some(Err(reason))) => findings.push(Finding {
                severity: Severity::Error,
                category: Category::SupplyPower,
                kind: FindingKind::PlanDoesNotCompute {
                    factory_id: f.id.clone(),
                    factory_name: f.name.clone(),
                    reason,
                },
            }),
            Ok(Some(Ok(graph))) => {
                plan_alts =
                    domain::check_plan_graph(&fref, &graph, tier, &unlocked, gd, &mut findings);
                domain::check_plan_graph_capacity(&fref, &graph, tier, gd, &mut findings);
                machine_raw_demand = graph.raw_demand.clone();
                demand_reported_elsewhere = graph.raw_demand.clone();
                // The graph only accounts for the machines it generated
                // — plan saves deliberately leave manual rows
                // (`plan_node_key IS NULL`) untouched, so a manual
                // foundry sitting alongside a computed plan is a real,
                // separate claimant on the same supply that raw_demand
                // never saw. Fold its direct ingredient draw into the
                // total, but *not* into `demand_reported_elsewhere` —
                // nothing has reported the manual portion anywhere, so
                // it must never be skipped as "already covered".
                let manual_machines = db.with(|c| {
                    factory_repo::manual_machines_for_factory(c, &f.id).map_err(AppError::from)
                })?;
                if !manual_machines.is_empty() {
                    let manual_ledger = compose_ledger_with_supply(
                        &f.id, &manual_machines, gd, &HashMap::new(), &[], &HashMap::new(),
                    );
                    for flow in &manual_ledger.flows {
                        if flow.consumed_per_minute > 0.0 {
                            *machine_raw_demand.entry(flow.item_id.clone()).or_insert(0.0) +=
                                flow.consumed_per_minute;
                        }
                    }
                }
                has_plan_graph = true;
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

        // Power. `claims`/`water_groups` are already loaded once above
        // for the whole sweep — pass them through rather than letting
        // this re-query both whole-playthrough tables on every factory.
        match power_balance_with_supply(db, gd, &f.id, &claims, &water_groups) {
            Ok(balance) => {
                grid_generated += balance.generated_mw;
                grid_consumed += balance.consumed_mw;
                if balance.net_mw < -0.001 {
                    per_factory_deficits.push((f.id.clone(), f.name.clone(), balance.net_mw));
                }
                // Total available supply, not claims alone: a claimed
                // node is one source, but a factory that refines its own
                // fuel (Fuel from an Oil Refinery, say) never claims a
                // node for it — `compose_ledger_with_supply` is the same
                // machinery the factory ledger uses to fold claimed-node
                // output, manufactured production and imports into one
                // per-item figure, so generator demand gets checked
                // against what's actually available instead of only what
                // came off a node.
                let link_supply = domain::incoming_link_supply(&links, &f.id);
                let ledger = compose_ledger_with_supply(
                    &f.id, &machines, gd, &claims, &water_groups, &link_supply,
                );
                let supply: HashMap<String, f32> = ledger
                    .flows
                    .iter()
                    .map(|flow| {
                        (
                            flow.item_id.clone(),
                            flow.from_nodes_per_minute
                                + flow.from_links_per_minute
                                + flow.net_per_minute.max(0.0),
                        )
                    })
                    .collect();
                // A factory without a saved plan graph has no
                // `raw_demand` (there's no graph to compute it from), but
                // its manual machine rows are real claimants on the same
                // supply pool — `ledger` above already folds their direct
                // ingredient draw per item, so use that instead of
                // leaving demand at zero and missing e.g. a legacy
                // foundry's coal draw competing with its coal generators.
                let machine_demand: HashMap<String, f32> = if has_plan_graph {
                    machine_raw_demand
                } else {
                    ledger
                        .flows
                        .iter()
                        .filter(|flow| flow.consumed_per_minute > 0.0)
                        .map(|flow| (flow.item_id.clone(), flow.consumed_per_minute))
                        .collect()
                };
                domain::check_generator_supply(
                    &fref,
                    &machine_demand,
                    &demand_reported_elsewhere,
                    &balance.fuel_flows,
                    &supply,
                    &mut findings,
                );
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
    domain::check_claim_port_capacity(&claims, tier, gd, &mut findings);
    domain::check_unlocked_alts_tier(&unlocked, tier, gd, &mut findings);
    domain::check_links_tier(&links, &factory_names, tier, gd, &mut findings);
    domain::check_flows(&targets, &links, &manual_produced, &factory_names, gd, &mut findings);
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
        // The grid itself is short, so it's worth knowing which factories
        // draw the most — that's where a new generator bank helps most.
        // When the grid nets positive, this same per-factory imbalance is
        // just "this factory has no power plant of its own", which is
        // true of every factory on a shared grid and not a to-do item.
        for (factory_id, factory_name, net_mw) in per_factory_deficits {
            findings.push(Finding {
                severity: Severity::Warning,
                category: Category::SupplyPower,
                kind: FindingKind::PowerDeficit { factory_id, factory_name, net_mw },
            });
        }
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
    fn unlocked_alt_above_tier_flags_instead_of_validating_clean() {
        // The Alts screen's "Select all" doesn't stop at the current
        // tier by design (someone may genuinely have the hard drive
        // early) — this pins that Validate is the safety net for that
        // permissiveness, not a silent no-op. Regression for the bug
        // where ticking a T7 alt at T0 read as "everything checks out".
        let db = open_test_db(0);
        let gd = GameData::from_bundled().unwrap();
        let late_alt = gd
            .recipes()
            .iter()
            .find(|r| r.is_alt && r.unlock_tier > 0)
            .expect("an alt above tier 0 exists");
        db.with(|c| alts_repo::alt_unlock(c, &late_alt.id, NOW)).unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        assert!(
            report.findings.iter().any(|f| matches!(&f.kind,
                FindingKind::UnlockedAltAboveTier { recipe_id, unlock_tier, .. }
                    if *recipe_id == late_alt.id && *unlock_tier == late_alt.unlock_tier)),
            "got {:?}",
            report.findings
        );
        // Warning, not error — the tick itself is still permitted.
        let finding = report
            .findings
            .iter()
            .find(|f| matches!(f.kind, FindingKind::UnlockedAltAboveTier { .. }))
            .unwrap();
        assert_eq!(finding.severity, Severity::Warning);
    }

    #[test]
    fn tier_reachable_unlocked_alt_does_not_flag() {
        // Collecting an alt you're already eligible for (the normal,
        // intended flow) must not trip the above-tier finding.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        let alt = gd.recipes().iter().find(|r| r.is_alt).expect("an alt exists");
        db.with(|c| alts_repo::alt_unlock(c, &alt.id, NOW)).unwrap();
        let report = validate_impl(&db, &gd).unwrap();
        assert!(
            !report
                .findings
                .iter()
                .any(|f| matches!(f.kind, FindingKind::UnlockedAltAboveTier { .. })),
            "got {:?}",
            report.findings
        );
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
    fn above_tier_alt_machine_is_tier_gating_not_shopping_list() {
        // After a downgrade to T0, a machine on a higher-tier alt is a
        // TierGating error — listing it as collectable would mislead.
        let db = open_test_db(0);
        let gd = GameData::from_bundled().unwrap();
        let late_alt = gd
            .recipes()
            .iter()
            .find(|r| r.is_alt && r.unlock_tier > 0)
            .expect("an alt above tier 0 exists");
        insert_factory(&db, "f1", "Downgraded");
        insert_machine(&db, "f1", &late_alt.building_id, &late_alt.id);
        let report = validate_impl(&db, &gd).unwrap();
        assert!(report.alt_shopping_list.is_empty(), "{:?}", report.alt_shopping_list);
        assert!(kinds(&report).iter().any(|k| matches!(k,
            FindingKind::MachineRecipeAboveTier { recipe_id, .. } if *recipe_id == late_alt.id)));
    }

    #[test]
    fn manual_machine_production_satisfies_link_source_check() {
        // A legacy factory with manual machines and no saved plan can
        // still feed links — no missing-product error, and no overdraw
        // either (no export slice declared, so no capacity to enforce).
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "legacy", "Manual Iron");
        insert_factory(&db, "dst", "Consumer");
        insert_machine(&db, "legacy", "Build_SmelterMk1_C", "Recipe_IngotIron_C");
        db.with(|c| {
            logistics_repo::link_insert(
                c, "l1", "legacy", "dst", "Desc_IronIngot_C", 30.0, "belt", "{}", None, None, NOW,
            )
        })
        .unwrap();
        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(
            !ks.iter().any(|k| matches!(k, FindingKind::LinkSourceMissingProduct { .. })),
            "manual production must satisfy the source check: {ks:?}"
        );
        assert!(!ks.iter().any(|k| matches!(k, FindingKind::LinkOverdraw { .. })));
    }

    #[test]
    fn playthrough_validate_flags_raw_supply_shortfall() {
        // Regression for #68: the playthrough sweep never checked raw
        // supply at all — a factory with a real ore shortfall (demand
        // against zero bound claims) validated clean under Supply &
        // power because only power was ever checked there.
        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Copper Works");
        // Iron demanded with no claim bound to this factory at all.
        db.with(|c| {
            plan_repo::plan_targets_replace(
                c,
                "f1",
                &[plan_repo::PlanTargetRow {
                    item_id: "Desc_IronIngot_C".into(),
                    ipm: 30.0,
                    export_ipm: None,
                    sort_order: 0,
                }],
                NOW,
            )
        })
        .unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        assert!(
            report.findings.iter().any(|f| f.category == Category::SupplyPower
                && matches!(&f.kind, FindingKind::PlanIssue { warning, .. }
                    if matches!(
                        warning,
                        crate::features::planner::dto::PlanWarning::RawShort { item_id, .. }
                            if item_id == "Desc_OreIron_C"
                    ))),
            "raw shortfall must surface under Supply & power, got {:?}",
            report.findings
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
    fn generator_less_factory_on_a_healthy_shared_grid_gets_no_power_deficit() {
        // Regression for #77: a central power station covering the whole
        // grid means every consuming factory has zero generators of its
        // own — that's the normal shape of a shared grid, not a per-factory
        // problem, as long as the grid nets positive. Before the fix this
        // produced one PowerDeficit warning per consumer, forever.
        use crate::features::power::repo as power_repo;

        let db = open_test_db(9);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "plant", "Coal Power Station");
        insert_factory(&db, "consumer", "Steel Mill");
        // One Coal Generator (75 MW) comfortably covers one Smelter's draw.
        db.with(|c| {
            power_repo::power_gen_insert(
                c, "g1", "plant", "Build_GeneratorCoal_C", "Desc_Coal_C", 1, 100.0, None, NOW,
            )
        })
        .expect("insert generator");
        insert_machine(&db, "consumer", "Build_SmelterMk1_C", "Recipe_IngotIron_C");

        let report = validate_impl(&db, &gd).unwrap();
        assert!(report.grid.net_mw > 0.0, "grid must net positive: {:?}", report.grid);
        assert!(
            !kinds(&report).iter().any(|k| matches!(k, FindingKind::PowerDeficit { .. })),
            "no per-factory power deficit once the shared grid covers the draw: {:?}",
            report.findings
        );
        assert!(
            !kinds(&report).iter().any(|k| matches!(k, FindingKind::GridDeficit { .. })),
            "grid itself isn't short: {:?}",
            report.findings
        );
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

    #[test]
    fn playthrough_validate_flags_extractor_over_the_ports_belt_cap() {
        // End-to-end regression for #82: a Miner Mk.1 on a Pure node
        // clocked to 250% reports 300/min at Tier 1, but the only belt
        // unlocked (Mk1, 60/min) is what the port can actually carry.
        let db = open_test_db(1);
        let gd = GameData::from_bundled().unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C"
                && n.purity == crate::shared::gamedata::types::NodePurity::Pure)
            .unwrap();
        db.with(|c| {
            nodes_repo::claim_upsert(c, &iron.id, Some("Build_MinerMk1_C"), 250.0, None, None, NOW)
        })
        .unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::ClaimOverPortCapacity {
                    node_id, output_ipm, capacity_ipm, capacity_mark, ..
                } if *node_id == iron.id
                    && (*output_ipm - 300.0).abs() < 0.01
                    && (*capacity_ipm - 60.0).abs() < 0.01
                    && *capacity_mark == 1)),
            "missing port-capacity finding: {:?}",
            report.findings
        );
    }

    #[test]
    fn playthrough_validate_generator_fuel_satisfied_by_manufactured_supply() {
        // Regression for #84: an Oil Refinery running Recipe_LiquidFuel_C
        // at 60% clock manufactures 24 Fuel/min in its own machine bank.
        // A single Fuel Generator at 100% burns 20/min. Before the fix,
        // the check read raw claims only (0, since Fuel has no node to
        // claim), so this warned forever despite being fully self-fed.
        let db = open_test_db(6);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Oil Refinery");
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m1", "f1", "Build_OilRefinery_C", "Recipe_LiquidFuel_C", 1, 60.0, false, 0, 0,
                None, NOW,
            )
        })
        .unwrap();
        db.with(|c| {
            crate::features::power::repo::power_gen_insert(
                c, "g1", "f1", "Build_GeneratorFuel_C", "Desc_LiquidFuel_C", 1, 100.0, None, NOW,
            )
        })
        .unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(
            !ks.iter().any(|k| matches!(k, FindingKind::GeneratorFuelShort { .. })),
            "manufactured Fuel must satisfy the generator's own draw: {:?}",
            report.findings
        );
    }

    #[test]
    fn playthrough_validate_counts_manual_machine_demand_against_generator_fuel() {
        // Codex P1: a factory with manual machine rows but no saved
        // planner graph had `machine_raw_demand` stuck empty (it was only
        // ever filled from a plan graph's `raw_demand`), so its own
        // machines' ingredient draw never competed with a generator bank
        // for the same claimed supply. A Foundry running Steel Ingot at
        // 100% draws 45 Coal/min on its own; one Coal Generator draws
        // another 15/min, for 60/min combined against a coal claim
        // clocked to yield only 48/min — over budget only once the
        // machine's draw is counted.
        let db = open_test_db(3);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Steel Mill");
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m1", "f1", "Build_FoundryMk1_C", "Recipe_IngotSteel_C", 1, 100.0, false, 0, 0,
                None, NOW,
            )
        })
        .unwrap();
        db.with(|c| {
            crate::features::power::repo::power_gen_insert(
                c, "g1", "f1", "Build_GeneratorCoal_C", "Desc_Coal_C", 1, 100.0, None, NOW,
            )
        })
        .unwrap();
        let coal = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_Coal_C"
                && n.purity == crate::shared::gamedata::types::NodePurity::Normal)
            .unwrap();
        db.with(|c| {
            nodes_repo::claim_upsert(
                c, &coal.id, Some("Build_MinerMk1_C"), 80.0, Some("f1"), None, NOW,
            )
        })
        .unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::GeneratorFuelShort { item_id, demand_ipm, claimed_ipm, .. }
                    if item_id == "Desc_Coal_C"
                        && (*demand_ipm - 60.0).abs() < 0.01
                        && (*claimed_ipm - 48.0).abs() < 0.01)),
            "manual machine's coal draw must count against the generator's shared supply: {:?}",
            report.findings
        );
    }

    #[test]
    fn playthrough_validate_flags_manual_machine_fuel_short_even_when_machine_demand_alone_exceeds_claim() {
        // Codex P1, round 2: the skip inside `check_generator_supply`
        // ("machine demand alone already exceeds supply, so it's
        // reported by the forwarded RawShort") only holds when there's a
        // plan graph to produce that RawShort. A manual-machine factory
        // with no saved plan has no RawShort check anywhere, so with a
        // fully unclaimed coal node the old code silently skipped this
        // factory's coal shortfall instead of reporting it. Same
        // fixture as the test above but with zero coal claimed, so
        // machine demand (45) alone already exceeds supply (0).
        let db = open_test_db(3);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Steel Mill");
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m1", "f1", "Build_FoundryMk1_C", "Recipe_IngotSteel_C", 1, 100.0, false, 0, 0,
                None, NOW,
            )
        })
        .unwrap();
        db.with(|c| {
            crate::features::power::repo::power_gen_insert(
                c, "g1", "f1", "Build_GeneratorCoal_C", "Desc_Coal_C", 1, 100.0, None, NOW,
            )
        })
        .unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::GeneratorFuelShort { item_id, demand_ipm, claimed_ipm, .. }
                    if item_id == "Desc_Coal_C"
                        && (*demand_ipm - 60.0).abs() < 0.01
                        && *claimed_ipm == 0.0)),
            "manual factory's coal shortfall must not be silently skipped: {:?}",
            report.findings
        );
    }

    #[test]
    fn playthrough_validate_counts_manual_machine_demand_alongside_a_saved_plan_graph() {
        // Codex P1, round 3: the plan-graph branch used only
        // `graph.raw_demand`, so a manual machine sitting alongside a
        // computed plan was invisible to the generator-fuel check even
        // though plan saves deliberately leave manual rows untouched
        // (`plan_node_key IS NULL`). A saved plan targeting Iron Plate,
        // a manual Foundry (Steel Ingot, 45 Coal/min) and a Coal
        // Generator (15/min) must all count against the same coal
        // claim — whatever the solver's own chain draws (it's free to
        // pick a coal-touching alt for Iron Plate at this tier) plus the
        // manual 45 plus the generator's 15.
        let db = open_test_db(3);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Mixed Factory");

        crate::features::planner::commands::plan_save_impl(
            &db,
            &gd,
            crate::features::planner::dto::SavePlanInput {
                factory_id: "f1".to_string(),
                targets: vec![crate::features::planner::dto::PlanTargetSpec {
                    item_id: "Desc_IronPlate_C".to_string(),
                    ipm: 60.0,
                    export_ipm: None,
                }],
                imports: vec![],
                recipe_overrides: Default::default(),
                options: Default::default(),
            },
            NOW,
        )
        .expect("save must succeed even with zero claimed iron supply (warn, don't block)");
        let graph_coal_demand = saved_plan_graph(&db, &gd, "f1")
            .unwrap()
            .unwrap()
            .unwrap()
            .raw_demand
            .get("Desc_Coal_C")
            .copied()
            .unwrap_or(0.0);

        db.with(|c| {
            factory_repo::machine_insert(
                c, "manual-1", "f1", "Build_FoundryMk1_C", "Recipe_IngotSteel_C", 1, 100.0, false,
                0, 0, None, NOW,
            )
        })
        .unwrap();
        db.with(|c| {
            crate::features::power::repo::power_gen_insert(
                c, "g1", "f1", "Build_GeneratorCoal_C", "Desc_Coal_C", 1, 100.0, None, NOW,
            )
        })
        .unwrap();
        let coal = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_Coal_C"
                && n.purity == crate::shared::gamedata::types::NodePurity::Normal)
            .unwrap();
        db.with(|c| {
            nodes_repo::claim_upsert(
                c, &coal.id, Some("Build_MinerMk1_C"), 80.0, Some("f1"), None, NOW,
            )
        })
        .unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        let expected_demand = graph_coal_demand + 45.0 + 15.0;
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::GeneratorFuelShort { item_id, demand_ipm, claimed_ipm, .. }
                    if item_id == "Desc_Coal_C"
                        && (*demand_ipm - expected_demand).abs() < 0.01
                        && (*claimed_ipm - 48.0).abs() < 0.01)),
            "manual machine's coal draw ({} graph + 45 manual + 15 generator = {expected_demand}) \
             must still count when a saved plan graph exists too: {:?}",
            graph_coal_demand,
            report.findings
        );
    }

    #[test]
    fn playthrough_validate_flags_generator_fuel_and_water_shortfall() {
        // End-to-end regression: a coal generator bank's fuel and water
        // draw never touched the raw-supply check, so a factory could
        // run 14 Coal Generators fed by nothing at all and validate
        // clean. Exercises the full command-layer wiring (claims_all +
        // water_groups_all + power_balance_impl's fuel_flows), not just
        // the pure check in isolation.
        let db = open_test_db(3);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Coal Power");
        db.with(|c| {
            crate::features::power::repo::power_gen_insert(
                c, "g1", "f1", "Build_GeneratorCoal_C", "Desc_Coal_C", 14, 100.0, None, NOW,
            )
        })
        .unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        let ks = kinds(&report);
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::GeneratorFuelShort { item_id, demand_ipm, claimed_ipm, .. }
                    if item_id == "Desc_Coal_C"
                        && (*demand_ipm - 210.0).abs() < 0.01
                        && *claimed_ipm == 0.0)),
            "missing coal shortfall: {:?}",
            report.findings
        );
        assert!(
            ks.iter().any(|k| matches!(k,
                FindingKind::GeneratorFuelShort { item_id, demand_ipm, claimed_ipm, .. }
                    if item_id == "Desc_Water_C"
                        && (*demand_ipm - 630.0).abs() < 0.01
                        && *claimed_ipm == 0.0)),
            "missing water shortfall: {:?}",
            report.findings
        );
    }

    #[test]
    fn playthrough_validate_flags_belt_segment_over_tier_cap() {
        // End-to-end regression for #48: at Tier 0 only Mk1 (60/min) is
        // unlocked, so planning Iron Ingot at 90/min (1:1 with raw ore)
        // produces a raw-ore segment the app never flagged as needing
        // more than one belt.
        let db = open_test_db(0);
        let gd = GameData::from_bundled().unwrap();
        insert_factory(&db, "f1", "Ingot Works");
        db.with(|c| {
            plan_repo::plan_targets_replace(
                c,
                "f1",
                &[plan_repo::PlanTargetRow {
                    item_id: "Desc_IronIngot_C".into(),
                    ipm: 90.0,
                    export_ipm: None,
                    sort_order: 0,
                }],
                NOW,
            )
        })
        .unwrap();

        let report = validate_impl(&db, &gd).unwrap();
        assert!(
            kinds(&report).iter().any(|k| matches!(k,
                FindingKind::SegmentOverBeltCapacity { item_id, belts_needed, .. }
                    if item_id == "Desc_OreIron_C" && *belts_needed == 2)),
            "missing belt-capacity finding: {:?}",
            report.findings
        );
    }
}
