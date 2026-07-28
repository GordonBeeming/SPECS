use std::collections::HashSet;

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::features::factory::dto::Factory;
use crate::features::factory::repo as factory_repo;
use crate::features::logistics::repo as logistics_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::features::resource_nodes::domain as nodes_domain;
use crate::features::resource_nodes::repo as nodes_repo;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use crate::shared::db::playthrough_db::PlaythroughDb;

use super::domain::compute_plan_graph;
use super::dto::{
    ComputePlanInput, ComputePlanResult, FactoryPlan, PlanImportRowDto, PlanLayoutEntry,
    PlanNode, SavePlanInput, SavePlanResult,
};
use super::repo as plan_repo;
use super::tier;

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

// ---- Production plan (graph-first designer) ----

/// Alt recipes the planner may use: everything at or below the
/// playthrough's current tier, collected or not. Planning stays open —
/// the unlocked-alts table records what's actually been collected, and
/// the validation slice diffs plans against it to produce the
/// "unlock these to build this" shopping list.
pub(crate) fn tier_reachable_alts(tier: u8, game_data: &GameData) -> HashSet<String> {
    game_data
        .recipes()
        .iter()
        .filter(|r| r.is_alt && r.unlock_tier <= tier)
        .map(|r| r.id.clone())
        .collect()
}

/// Every playthrough-state input a plan computation needs: tier-reached
/// alts, the tier itself (the planner gates recipe chains on it), this
/// factory's bound raw-supply pool, and the raw claim/water-group rows
/// the supply was derived from. Claims and water groups travel
/// alongside the pool (not just folded into it) because callers also
/// need them to add a factory's bound extractor power onto the computed
/// graph — see `add_bound_extractor_power`.
struct PlanContext {
    alts: HashSet<String>,
    current_tier: u8,
    supply: std::collections::HashMap<String, f32>,
    claims: std::collections::HashMap<String, nodes_repo::ClaimRow>,
    water_groups: Vec<nodes_repo::WaterGroupRow>,
}

/// Supply is scoped to `factory_id` via `supply_for_factory`, never the
/// whole-map `available_supply` pool — a node claimed for one factory
/// must never read as "claimed" for another just because it's on the
/// same map. Claiming a node *for* a factory is the whole point of the
/// binding; a global pool would make every factory look self-sufficient
/// regardless of what it actually has links or claims for.
fn gather_plan_context(
    db: &PlaythroughDb,
    game_data: &GameData,
    factory_id: &str,
) -> AppResult<PlanContext> {
    let (current_tier, _) =
        db.with(|c| crate::features::playthrough::repo::progress_get(c).map_err(AppError::from))?;
    let tier: u8 = current_tier.clamp(0, u8::MAX as i64) as u8;
    let alts = tier_reachable_alts(tier, game_data);
    let claims = db.with(|c| nodes_repo::claims_all(c).map_err(AppError::from))?;
    let water_groups = db.with(|c| nodes_repo::water_groups_all(c).map_err(AppError::from))?;
    let supply = nodes_domain::supply_for_factory(&claims, &water_groups, factory_id, game_data);
    Ok(PlanContext { alts, current_tier: tier, supply, claims, water_groups })
}

/// Extractors (miners, water/oil pumps, resource wells) are claimed
/// against a map node, not added to a factory's machine bank, so
/// `compute_plan_graph` never sees them and `total_power_mw` would
/// undercount by exactly the same hole the Power view had. Added on
/// after the graph computes so the plan header, Power view, and
/// Validate's grid total all read the same number for a factory.
///
/// The count and the MW share are recorded alongside the total: a
/// header showing machines next to a power figure that silently
/// includes extractors has the two numbers counting different sets,
/// and the only honest fix is to hand the UI both halves.
fn add_bound_extractor_power(
    graph: &mut super::dto::PlanGraph,
    factory_id: &str,
    claims: &std::collections::HashMap<String, nodes_repo::ClaimRow>,
    water_groups: &[nodes_repo::WaterGroupRow],
    game_data: &GameData,
) {
    let mw = nodes_domain::power_for_factory(claims, water_groups, factory_id, game_data);
    // One extractor per claimed node; a water group is a bank (both
    // sub-banks counted), which is how the Power view counts them too.
    let claimed_nodes = claims
        .iter()
        .filter(|(node_id, claim)| {
            claim.factory_id.as_deref() == Some(factory_id) && game_data.node(node_id).is_some()
        })
        .count() as i64;
    let pumps: i64 = water_groups
        .iter()
        .filter(|g| g.factory_id.as_deref() == Some(factory_id))
        .map(|g| g.count.max(0) + g.count2.unwrap_or(0).max(0))
        .sum();
    graph.total_power_mw += mw;
    graph.extractor_power_mw = mw;
    graph.extractor_count = claimed_nodes + pumps;
}

/// Remaining export capacity per (factory, item) from one consumer's
/// point of view: each factory's export slice minus what OTHER
/// factories already draw via logistics links. The consumer's own
/// links are excluded so its existing draw doesn't eat its own
/// headroom when its plan recomputes.
fn gather_export_capacity(
    db: &PlaythroughDb,
    beneficiary_factory_id: &str,
) -> AppResult<std::collections::HashMap<(String, String), f32>> {
    let targets = db.with(|c| plan_repo::plan_targets_all(c).map_err(AppError::from))?;
    let links = db.with(|c| logistics_repo::link_list(c).map_err(AppError::from))?;
    let mut drawn: std::collections::HashMap<(String, String), f32> =
        std::collections::HashMap::new();
    for l in links {
        if l.to_factory_id == beneficiary_factory_id {
            continue;
        }
        *drawn
            .entry((l.from_factory_id, l.item_id))
            .or_insert(0.0) += l.items_per_minute;
    }
    let mut out = std::collections::HashMap::new();
    for (fid, t) in targets {
        let Some(export) = t.export_ipm else { continue };
        if export <= 0.0 {
            continue;
        }
        // An export slice larger than the production rate is a wish,
        // not capacity — the plan only materializes machines for
        // `ipm`, so offers clamp to what actually gets made.
        let export = export.min(t.ipm);
        let d = *drawn.get(&(fid.clone(), t.item_id.clone())).unwrap_or(&0.0);
        out.insert((fid, t.item_id), (export - d).max(0.0));
    }
    Ok(out)
}

/// Straight-line distance in meters between two factories' map
/// positions, or `None` when either hasn't been placed yet. Mirrors
/// `factoryDistanceMeters` in `src/features/map/transform.ts` — both
/// sides must agree that the schema's `(0, 0)` default means "never
/// dragged onto the map," not "placed at the origin," or a plan save
/// would stamp a plausible-looking distance to nowhere.
fn factory_distance_meters(a: &Factory, b: &Factory) -> Option<i64> {
    let placed = |f: &Factory| f.world_x != 0.0 || f.world_y != 0.0;
    if !placed(a) || !placed(b) {
        return None;
    }
    let dx = a.world_x - b.world_x;
    let dy = a.world_y - b.world_y;
    // World coords are stored in cm — divide by 100 for meters.
    Some(((dx * dx + dy * dy).sqrt() / 100.0).round() as i64)
}

fn validate_plan_specs(input_targets: &[super::dto::PlanTargetSpec]) -> AppResult<()> {
    for t in input_targets {
        if !t.ipm.is_finite() || t.ipm <= 0.0 {
            return Err(AppError::Invalid(format!(
                "target rate for {} must be a positive number (got {})",
                t.item_id, t.ipm
            )));
        }
    }
    Ok(())
}

fn plan_get_impl(db: &PlaythroughDb, factory_id: &str) -> AppResult<FactoryPlan> {
    let exists = db.with(|c| factory_repo::factory_get(c, factory_id).map_err(AppError::from))?;
    if exists.is_none() {
        return Err(AppError::NotFound(format!("factory {factory_id} not found")));
    }
    let targets = db.with(|c| plan_repo::plan_targets_for_factory(c, factory_id).map_err(AppError::from))?;
    let recipes = db.with(|c| plan_repo::plan_recipes_for_factory(c, factory_id).map_err(AppError::from))?;
    let imports = db.with(|c| plan_repo::plan_imports_for_factory(c, factory_id).map_err(AppError::from))?;
    let layout = db.with(|c| plan_repo::plan_layouts_for_factory(c, factory_id).map_err(AppError::from))?;
    let include_sam =
        db.with(|c| plan_repo::plan_option_include_sam(c, factory_id).map_err(AppError::from))?;
    Ok(FactoryPlan {
        factory_id: factory_id.to_string(),
        include_sam,
        targets: targets
            .into_iter()
            .map(|t| super::dto::PlanTargetSpec {
                item_id: t.item_id,
                ipm: t.ipm,
                export_ipm: t.export_ipm,
            })
            .collect(),
        recipe_overrides: recipes.into_iter().collect(),
        imports: imports
            .into_iter()
            .map(|i| PlanImportRowDto {
                id: i.id,
                item_id: i.item_id,
                source_factory_id: i.source_factory_id,
                ipm_cap: i.ipm_cap,
            })
            .collect(),
        layout: layout
            .into_iter()
            .map(|(node_key, x, y)| PlanLayoutEntry { node_key, x, y })
            .collect(),
    })
}

/// Recompute a factory's saved plan graph the way `factory_plan_compute`
/// does, for slices that need the materialized graph (the validation
/// sweep). `Ok(None)` = no plan saved; `Ok(Some(Err(reason)))` = the plan
/// no longer computes (itself a finding, not a hard error).
pub(crate) fn saved_plan_graph(
    db: &PlaythroughDb,
    game_data: &GameData,
    factory_id: &str,
) -> AppResult<Option<Result<super::dto::PlanGraph, String>>> {
    let plan = plan_get_impl(db, factory_id)?;
    if plan.targets.is_empty() {
        return Ok(None);
    }
    let ctx = gather_plan_context(db, game_data, factory_id)?;
    let export_capacity = gather_export_capacity(db, factory_id)?;
    let imports: Vec<super::dto::PlanImportSpec> = plan
        .imports
        .iter()
        .map(|i| super::dto::PlanImportSpec {
            item_id: i.item_id.clone(),
            source_factory_id: i.source_factory_id.clone(),
            ipm_cap: i.ipm_cap,
        })
        .collect();
    let options = super::dto::PlanComputeOptions {
        include_sam: plan.include_sam,
        ..Default::default()
    };
    let graph = compute_plan_graph(
        factory_id,
        &plan.targets,
        &ctx.alts,
        Some(ctx.current_tier),
        &ctx.supply,
        &imports,
        &plan.recipe_overrides,
        &export_capacity,
        &options,
        game_data,
    );
    Ok(Some(graph.map(|mut g| {
        add_bound_extractor_power(&mut g, factory_id, &ctx.claims, &ctx.water_groups, game_data);
        g
    }).map_err(|e| format!("{e:?}"))))
}

// `pub(crate)` rather than private: the validation sweep's tests need a
// real saved plan on the books to exercise its "plan graph + manual
// machines both present" branch, and this is the one path that
// persists one the same way the command layer does.
pub(crate) fn plan_save_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
    input: SavePlanInput,
    now: &str,
) -> AppResult<SavePlanResult> {
    validate_plan_specs(&input.targets)?;
    let dest_factory = db
        .with(|c| factory_repo::factory_get(c, &input.factory_id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("factory {} not found", input.factory_id)))?;

    let ctx = gather_plan_context(db, game_data, &input.factory_id)?;
    let export_capacity = gather_export_capacity(db, &input.factory_id)?;
    // The graph is recomputed server-side from the submitted inputs —
    // a client-supplied graph is never trusted for materialization.
    let mut graph = compute_plan_graph(
        &input.factory_id,
        &input.targets,
        &ctx.alts,
        Some(ctx.current_tier),
        &ctx.supply,
        &input.imports,
        &input.recipe_overrides,
        &export_capacity,
        &input.options,
        game_data,
    )
    .map_err(|e| AppError::Invalid(format!("plan does not compute: {e:?}")))?;
    add_bound_extractor_power(
        &mut graph,
        &input.factory_id,
        &ctx.claims,
        &ctx.water_groups,
        game_data,
    );

    let mut machine_ids: Vec<String> = Vec::new();
    let mut link_ids: Vec<String> = Vec::new();

    db.with(|c| {
        let tx = c.unchecked_transaction()?;

        // Reconcile logistics links from previous saves: delete and
        // recreate, so removed/re-routed imports never leave orphans.
        for old_link in plan_repo::plan_link_ids_for_factory(&tx, &input.factory_id)? {
            logistics_repo::link_delete(&tx, &old_link)?;
        }

        // Persist the plan inputs.
        let target_rows: Vec<plan_repo::PlanTargetRow> = input
            .targets
            .iter()
            .enumerate()
            .map(|(i, t)| plan_repo::PlanTargetRow {
                item_id: t.item_id.clone(),
                ipm: t.ipm,
                export_ipm: t.export_ipm,
                sort_order: i as i64,
            })
            .collect();
        plan_repo::plan_targets_replace(&tx, &input.factory_id, &target_rows, now)?;

        let mut recipe_rows: Vec<(String, String)> = input
            .recipe_overrides
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        recipe_rows.sort();
        plan_repo::plan_recipes_replace(&tx, &input.factory_id, &recipe_rows, now)?;

        let import_rows: Vec<plan_repo::PlanImportRow> = input
            .imports
            .iter()
            .enumerate()
            .map(|(i, s)| plan_repo::PlanImportRow {
                id: Uuid::new_v4().to_string(),
                item_id: s.item_id.clone(),
                source_factory_id: s.source_factory_id.clone(),
                ipm_cap: s.ipm_cap,
                sort_order: i as i64,
                logistics_link_id: None,
            })
            .collect();
        plan_repo::plan_imports_replace(&tx, &input.factory_id, &import_rows, now)?;
        plan_repo::plan_option_upsert(&tx, &input.factory_id, input.options.include_sam, now)?;

        // Regenerate the plan-managed machines. Manual machines
        // (plan_node_key IS NULL) survive untouched.
        plan_repo::plan_machines_delete(&tx, &input.factory_id)?;
        for node in &graph.nodes {
            let PlanNode::Recipe {
                node_key,
                building_id,
                recipe_id,
                machine_count,
                clock_pct,
                ..
            } = node
            else {
                continue;
            };
            let machine_id = Uuid::new_v4().to_string();
            factory_repo::machine_insert(
                &tx,
                &machine_id,
                &input.factory_id,
                building_id,
                recipe_id,
                *machine_count,
                *clock_pct,
                false,
                0,
                0,
                Some(node_key),
                now,
            )?;
            machine_ids.push(machine_id);
        }

        // Materialize one logistics link per positive allocation.
        // Allocations preserve spec order (unsourced specs skipped),
        // so zipping against this item's sourced rows in declared
        // order pairs each link with its originating import row.
        for node in &graph.nodes {
            let PlanNode::Import { item_id, allocations, .. } = node else {
                continue;
            };
            // Self rows ("build it here") never become logistics links —
            // they're the local production marker, not a route.
            let sourced_rows: Vec<&plan_repo::PlanImportRow> = import_rows
                .iter()
                .filter(|r| {
                    &r.item_id == item_id
                        && r.source_factory_id.is_some()
                        && r.source_factory_id.as_deref() != Some(input.factory_id.as_str())
                })
                .collect();
            for (row, alloc) in sourced_rows.iter().zip(allocations.iter()) {
                if alloc.resolved_ipm <= 1e-3 {
                    continue;
                }
                let link_id = Uuid::new_v4().to_string();
                // Computed fresh from both factories' current map
                // positions rather than a fabricated default — a
                // wrong number that looks authoritative (the old
                // hard-coded 1000m) is worse than a blank one, and an
                // unplaced source correctly comes back `None`.
                let source_factory =
                    factory_repo::factory_get(&tx, &alloc.source_factory_id)?;
                let distance_m = source_factory
                    .as_ref()
                    .and_then(|src| factory_distance_meters(&dest_factory, src));
                logistics_repo::link_insert(
                    &tx,
                    &link_id,
                    &alloc.source_factory_id,
                    &input.factory_id,
                    item_id,
                    alloc.resolved_ipm,
                    "belt",
                    "null", // transport_plan_json — picker refines later
                    distance_m,
                    None,
                    now,
                )?;
                plan_repo::plan_import_set_link(&tx, &row.id, Some(&link_id), now)?;
                link_ids.push(link_id);
            }
        }

        // Saved node positions for steps that no longer exist are
        // dropped so the layout table doesn't accrete stale rows.
        let keep_keys: Vec<String> =
            graph.nodes.iter().map(|n| n.node_key().to_string()).collect();
        plan_repo::plan_layout_prune(&tx, &input.factory_id, &keep_keys)?;

        tx.commit()?;
        Ok::<_, anyhow::Error>(())
    })
    .map_err(AppError::from)?;

    Ok(SavePlanResult { graph, machine_ids, link_ids })
}

/// Load a factory's saved plan inputs (targets, recipe choices,
/// imports, node layout) so the designer can restore its state.
#[tauri::command]
pub fn factory_plan_get(
    active: State<ActivePlaythrough>,
    factory_id: String,
) -> AppResult<FactoryPlan> {
    let db = require_active(&active)?;
    plan_get_impl(&db, &factory_id)
}

/// Pure computation for live editing — no writes. The designer calls
/// this (debounced) on every edit and renders the returned graph.
#[tauri::command]
pub fn factory_plan_compute(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: ComputePlanInput,
) -> AppResult<ComputePlanResult> {
    validate_plan_specs(&input.targets)?;
    let db = require_active(&active)?;
    let ctx = gather_plan_context(&db, &game_data, &input.factory_id)?;
    let export_capacity = gather_export_capacity(&db, &input.factory_id)?;
    match compute_plan_graph(
        &input.factory_id,
        &input.targets,
        &ctx.alts,
        Some(ctx.current_tier),
        &ctx.supply,
        &input.imports,
        &input.recipe_overrides,
        &export_capacity,
        &input.options,
        &game_data,
    ) {
        Ok(mut graph) => {
            add_bound_extractor_power(
                &mut graph,
                &input.factory_id,
                &ctx.claims,
                &ctx.water_groups,
                &game_data,
            );
            Ok(ComputePlanResult::Ok { graph })
        }
        Err(error) => Ok(ComputePlanResult::Err { error }),
    }
}

/// Persist the plan and materialize it: plan-managed machines are
/// regenerated and sourced imports become logistics links — all in one
/// transaction. Saving with warnings is fully supported (warn, don't
/// block); only structurally impossible plans are rejected.
#[tauri::command]
pub fn factory_plan_save(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    input: SavePlanInput,
) -> AppResult<SavePlanResult> {
    let db = require_active(&active)?;
    plan_save_impl(&db, &game_data, input, &now_iso())
}

/// Every unsourced input in the playthrough, for map badges and the
/// "what's still waiting on a source?" planning view.
#[tauri::command]
pub fn list_unsourced_inputs(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<Vec<super::dto::UnsourcedInput>> {
    let db = require_active(&active)?;
    let rows = db.with(|c| plan_repo::unsourced_inputs_all(c).map_err(AppError::from))?;
    Ok(rows
        .into_iter()
        .map(|r| super::dto::UnsourcedInput {
            item_name: game_data
                .item(&r.item_id)
                .map(|i| i.name.clone())
                .unwrap_or_else(|| r.item_id.clone()),
            import_id: r.import_id,
            factory_id: r.factory_id,
            item_id: r.item_id,
            ipm_cap: r.ipm_cap,
        })
        .collect())
}

/// What every factory can feed to another, with how much other
/// factories already draw — feeds the designer's source picker.
///
/// Producing the item is the qualifier, not declaring an export slice.
/// A slice is one click at the exporter, so a plant making 60/min with
/// nobody drawing it is a source you can have; filing it under "not
/// exporting this" instead hides a working flow behind a screen nobody
/// has a reason to open.
fn export_offers_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
) -> AppResult<Vec<super::dto::ExportOffer>> {
    let targets = db.with(|c| plan_repo::plan_targets_all(c).map_err(AppError::from))?;
    let factories = db.with(|c| factory_repo::factory_list(c).map_err(AppError::from))?;
    let links = db.with(|c| logistics_repo::link_list(c).map_err(AppError::from))?;
    let factory_names: std::collections::HashMap<String, String> =
        factories.into_iter().map(|f| (f.id, f.name)).collect();

    // Σ outbound link ipm per (factory, item) — what's already spoken for.
    let mut drawn: std::collections::HashMap<(String, String), f32> =
        std::collections::HashMap::new();
    for l in links {
        *drawn
            .entry((l.from_factory_id, l.item_id))
            .or_insert(0.0) += l.items_per_minute;
    }

    let mut by_factory: std::collections::HashMap<String, Vec<super::dto::ExportOfferProduct>> =
        std::collections::HashMap::new();
    for (fid, t) in targets {
        if t.ipm <= 0.0 {
            continue;
        }
        // Same clamp as gather_export_capacity: the offer can't exceed
        // what the plan actually produces.
        let export = t.export_ipm.unwrap_or(0.0).max(0.0).min(t.ipm);
        let drawn_ipm = *drawn
            .get(&(fid.clone(), t.item_id.clone()))
            .unwrap_or(&0.0);
        by_factory.entry(fid).or_default().push(super::dto::ExportOfferProduct {
            item_name: game_data
                .item(&t.item_id)
                .map(|i| i.name.clone())
                .unwrap_or_else(|| t.item_id.clone()),
            item_id: t.item_id,
            produced_ipm: t.ipm,
            export_ipm: export,
            drawn_ipm,
            remaining_ipm: (export - drawn_ipm).max(0.0),
            spare_ipm: (t.ipm - drawn_ipm).max(0.0),
        });
    }

    let mut out: Vec<super::dto::ExportOffer> = by_factory
        .into_iter()
        .map(|(factory_id, products)| super::dto::ExportOffer {
            factory_name: factory_names
                .get(&factory_id)
                .cloned()
                .unwrap_or_else(|| factory_id.clone()),
            factory_id,
            products,
        })
        .collect();
    out.sort_by_key(|o| o.factory_name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub fn list_export_offers(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<Vec<super::dto::ExportOffer>> {
    let db = require_active(&active)?;
    export_offers_impl(&db, &game_data)
}

/// Below this, a raise is rounding noise — plan rates persist at two
/// decimal places, so a delta smaller than a hundredth can't be stored
/// and asking for one is a no-op, not a failure.
const RAISE_EPSILON_IPM: f32 = 0.005;

/// What factories other than `beneficiary` already pull out of
/// `factory_id` for `item_id`.
///
/// Excluding the beneficiary's own draw is what makes `needed_ipm` mean
/// "this much for me" rather than "this much on top of what I already
/// take". It matches `gather_export_capacity`, which the solver uses to
/// size the same import, so a raise for a source already supplying
/// 29/min of a 49/min need asks for 49 and gets 49 — not 78. With no
/// beneficiary this is every outbound link, which is the number the
/// picker's "N/min left" shows a factory that isn't drawing yet.
fn drawn_export_ipm(
    db: &PlaythroughDb,
    factory_id: &str,
    item_id: &str,
    beneficiary: Option<&str>,
) -> AppResult<f32> {
    let links = db.with(|c| logistics_repo::link_list(c).map_err(AppError::from))?;
    Ok(links
        .iter()
        .filter(|l| l.from_factory_id == factory_id && l.item_id == item_id)
        .filter(|l| beneficiary != Some(l.to_factory_id.as_str()))
        .map(|l| l.items_per_minute)
        .sum())
}

/// What a warning is *about*, so the same finding can be recognised
/// across two solves of the same plan. Variants without an item are
/// whole-plan findings and collapse to one subject each.
fn warning_subject(w: &super::dto::PlanWarning) -> (&'static str, &str) {
    use super::dto::PlanWarning as W;
    match w {
        W::RawShort { item_id, .. } => ("rawShort", item_id),
        W::ImportUnsourced { item_id, .. } => ("importUnsourced", item_id),
        W::ImportShort { item_id, .. } => ("importShort", item_id),
        W::FluidSurplus { item_id, .. } => ("fluidSurplus", item_id),
        W::OptimizerFellBack { .. } => ("optimizerFellBack", ""),
        W::AboveTier { .. } => ("aboveTier", ""),
        W::TargetUnplannable { item_id, .. } => ("targetUnplannable", item_id),
    }
}

/// The number a reader takes off a warning, so "the same gap, wider"
/// can be told from "the same gap, unchanged". Only comparable within a
/// subject — a tier and an ipm share this scale by convention, never by
/// meaning.
fn warning_severity(w: &super::dto::PlanWarning) -> f32 {
    use super::dto::PlanWarning as W;
    match w {
        W::RawShort { demand_ipm, claimed_ipm, .. } => demand_ipm - claimed_ipm,
        W::ImportUnsourced { ipm, .. } => *ipm,
        W::ImportShort { gap_ipm, .. } => *gap_ipm,
        W::FluidSurplus { ipm, .. } => *ipm,
        W::AboveTier { required_tier, .. } => *required_tier as f32,
        // Neither carries a magnitude: present or absent is the whole
        // signal, so an unchanged one must never read as worsened.
        W::OptimizerFellBack { .. } | W::TargetUnplannable { .. } => 0.0,
    }
}

/// Warnings an edit is answerable for, split by which sentence they
/// deserve: `.0` weren't there before, `.1` were and got worse. A gap
/// the edit merely widened is not a gap the edit opened, and reading
/// the second as the first sends the user looking for damage that was
/// already on the screen before they clicked.
fn warnings_introduced(
    before: &[super::dto::PlanWarning],
    after: &[super::dto::PlanWarning],
) -> (Vec<super::dto::PlanWarning>, Vec<super::dto::PlanWarning>) {
    let mut new_findings = Vec::new();
    let mut worsened = Vec::new();
    for w in after {
        let subject = warning_subject(w);
        match before.iter().find(|b| warning_subject(b) == subject) {
            None => new_findings.push(w.clone()),
            Some(b) if warning_severity(w) > warning_severity(b) + RAISE_EPSILON_IPM => {
                worsened.push(w.clone());
            }
            Some(_) => {}
        }
    }
    (new_findings, worsened)
}

/// Raise an exporter's target for one item until it can spare
/// `needed_ipm` — the Sources panel's answer to "this factory makes
/// what I need and has none left". Equivalent to opening that factory,
/// raising the target and its export slice, and saving.
///
/// `needed_ipm` is the spare the caller wants to exist *for itself*,
/// not a delta: the shortfall is recomputed here from current links, so
/// a stale panel or a second click can't stack raises on top of each
/// other. `beneficiary_factory_id` is the factory asking, and its own
/// existing draw is discounted — see `drawn_export_ipm`. Topping up a
/// source you already import from is the common case once a network
/// starts scaling, and it only works if "20/min more" can be asked for
/// as "49/min for me".
///
/// The exporter is re-solved and **nothing upstream of it is touched**.
/// Raising a steel mill's pipe target can leave that mill short on ore,
/// and closing that gap could mean claiming a node, raising a further
/// exporter, swapping a recipe, or accepting it — a choice with map and
/// logistics cost that only the user can make. So the cost is reported
/// (`introduced_warnings`) rather than chased: one click must never
/// rewrite an unbounded fan of factories.
fn raise_export_target_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
    factory_id: &str,
    item_id: &str,
    needed_ipm: f32,
    beneficiary_factory_id: Option<&str>,
    now: &str,
) -> AppResult<super::dto::RaiseExportTargetResult> {
    if !needed_ipm.is_finite() || needed_ipm <= 0.0 {
        return Err(AppError::Invalid(format!(
            "the rate to spare must be a positive number (got {needed_ipm})"
        )));
    }
    let factory = db
        .with(|c| factory_repo::factory_get(c, factory_id).map_err(AppError::from))?
        .ok_or_else(|| AppError::NotFound(format!("factory {factory_id} not found")))?;
    let item_name = game_data
        .item(item_id)
        .map(|i| i.name.clone())
        .unwrap_or_else(|| item_id.to_string());

    let plan = plan_get_impl(db, factory_id)?;
    let Some(target) = plan.targets.iter().find(|t| t.item_id == item_id) else {
        return Err(AppError::Invalid(format!(
            "{} doesn't have a {item_name} target — open it and add the product first",
            factory.name
        )));
    };
    let previous_target_ipm = target.ipm;
    let previous_export_ipm = target.export_ipm.unwrap_or(0.0);
    // An export slice larger than the production rate is a wish, not
    // capacity — the same clamp the picker's figure is built on.
    let offered = previous_export_ipm.min(previous_target_ipm);
    let drawn = drawn_export_ipm(db, factory_id, item_id, beneficiary_factory_id)?;
    let spare = (offered - drawn).max(0.0);
    let delta = needed_ipm - spare;

    let mut result = super::dto::RaiseExportTargetResult {
        factory_id: factory_id.to_string(),
        factory_name: factory.name.clone(),
        item_id: item_id.to_string(),
        item_name,
        previous_target_ipm,
        new_target_ipm: previous_target_ipm,
        previous_export_ipm,
        new_export_ipm: previous_export_ipm,
        remaining_ipm: spare,
        introduced_warnings: Vec::new(),
        worsened_warnings: Vec::new(),
    };
    if delta <= RAISE_EPSILON_IPM {
        // Already covers it — nothing to write, and re-saving the plan
        // anyway would churn machines and links for no change.
        return Ok(result);
    }

    // `offered + delta` looks equivalent but silently discards an
    // existing deficit when other consumers already draw more than
    // what's offered (e.g. after the target was reduced elsewhere):
    // `spare` clamps to 0 there, so `delta` becomes the full
    // `needed_ipm` and the raise only closes the gap up to `offered`,
    // not up to what's already drawn — 100 offered, 120 drawn, 20
    // needed would raise to 120 and leave zero spare instead of the
    // 140 required. Computing the new offer straight from `drawn +
    // needed_ipm` is what "make sure I have `needed_ipm` spare after
    // everyone else's current draw" always meant; `.max(offered)` keeps
    // the no-decrease guarantee explicit rather than relying on the
    // early return above to make it true.
    let new_offered = (drawn + needed_ipm).max(offered);
    // Neither figure ever goes down: production only rises if the offer
    // outgrows it, and a declared export wish above production survives
    // untouched.
    let new_target_ipm = previous_target_ipm.max(new_offered);
    let new_export_ipm = previous_export_ipm.max(new_offered);

    // The exporter's warnings as they stood, to diff the raise against.
    // A plan that already fails to compute has nothing to compare, and
    // the save below surfaces that failure on its own.
    let before_warnings = saved_plan_graph(db, game_data, factory_id)?
        .and_then(|g| g.ok())
        .map(|g| g.warnings)
        .unwrap_or_default();

    let targets: Vec<super::dto::PlanTargetSpec> = plan
        .targets
        .iter()
        .map(|t| super::dto::PlanTargetSpec {
            item_id: t.item_id.clone(),
            ipm: if t.item_id == item_id { new_target_ipm } else { t.ipm },
            export_ipm: if t.item_id == item_id {
                Some(new_export_ipm)
            } else {
                t.export_ipm
            },
        })
        .collect();
    let imports: Vec<super::dto::PlanImportSpec> = plan
        .imports
        .iter()
        .map(|i| super::dto::PlanImportSpec {
            item_id: i.item_id.clone(),
            source_factory_id: i.source_factory_id.clone(),
            ipm_cap: i.ipm_cap,
        })
        .collect();
    let saved = plan_save_impl(
        db,
        game_data,
        SavePlanInput {
            factory_id: factory_id.to_string(),
            targets,
            imports,
            recipe_overrides: plan.recipe_overrides.clone(),
            options: super::dto::PlanComputeOptions {
                include_sam: plan.include_sam,
                ..Default::default()
            },
        },
        now,
    )?;

    result.new_target_ipm = new_target_ipm;
    result.new_export_ipm = new_export_ipm;
    // This factory's outbound links are untouched by its own plan save,
    // so the draw is still the one measured above.
    result.remaining_ipm = (new_export_ipm.min(new_target_ipm) - drawn).max(0.0);
    let (introduced, worsened) = warnings_introduced(&before_warnings, &saved.graph.warnings);
    result.introduced_warnings = introduced;
    result.worsened_warnings = worsened;
    Ok(result)
}

/// Sources-panel action: make an exporter big enough to supply this
/// factory, without leaving the plan you're designing.
#[tauri::command]
pub fn factory_plan_raise_export_target(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    factory_id: String,
    item_id: String,
    needed_ipm: f32,
    beneficiary_factory_id: Option<String>,
) -> AppResult<super::dto::RaiseExportTargetResult> {
    let db = require_active(&active)?;
    raise_export_target_impl(
        &db,
        &game_data,
        &factory_id,
        &item_id,
        needed_ipm,
        beneficiary_factory_id.as_deref(),
        &now_iso(),
    )
}

fn assign_import_source_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
    import_id: &str,
    source_factory_id: &str,
    now: &str,
) -> AppResult<SavePlanResult> {
    let Some((factory_id, _row)) =
        db.with(|c| plan_repo::plan_import_get(c, import_id).map_err(AppError::from))?
    else {
        return Err(AppError::NotFound(format!("input {import_id} not found")));
    };
    if factory_id == source_factory_id {
        return Err(AppError::Invalid(
            "a factory can't supply its own input — pick another factory".into(),
        ));
    }
    // Re-save the whole plan with just this import's source flipped —
    // the save path owns machine/link reconciliation, so the map
    // gesture can't drift from what the designer would have done.
    let plan = plan_get_impl(db, &factory_id)?;
    let imports: Vec<super::dto::PlanImportSpec> = plan
        .imports
        .iter()
        .map(|i| super::dto::PlanImportSpec {
            item_id: i.item_id.clone(),
            source_factory_id: if i.id == import_id {
                Some(source_factory_id.to_string())
            } else {
                i.source_factory_id.clone()
            },
            ipm_cap: i.ipm_cap,
        })
        .collect();
    plan_save_impl(
        db,
        game_data,
        SavePlanInput {
            factory_id,
            targets: plan.targets,
            imports,
            recipe_overrides: plan.recipe_overrides,
            options: super::dto::PlanComputeOptions {
                include_sam: plan.include_sam,
                ..Default::default()
            },
        },
        now,
    )
}

/// Map gesture: drag an unsourced input onto a factory pin to make
/// that factory the source. Equivalent to opening the plan, picking
/// the source, and saving.
#[tauri::command]
pub fn factory_plan_assign_import_source(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    import_id: String,
    source_factory_id: String,
) -> AppResult<SavePlanResult> {
    let db = require_active(&active)?;
    assign_import_source_impl(&db, &game_data, &import_id, &source_factory_id, &now_iso())
}

/// Earliest tier every item is actually reachable at, chain included.
///
/// Pure game data — no playthrough needed, and the client caches it for
/// the session. The picker can't derive this itself: a recipe's own
/// `unlock_tier` says nothing about whether its ingredients exist yet,
/// which is how a Tier 7 chain ended up offered under a Tier 5 heading.
/// Items no chain ever reaches are left out — offering a product that
/// can never be planned is worse than not listing it.
#[tauri::command]
pub fn list_item_tiers(game_data: State<GameData>) -> Vec<super::dto::ItemTier> {
    list_item_tiers_impl(&game_data)
}

fn list_item_tiers_impl(game_data: &GameData) -> Vec<super::dto::ItemTier> {
    let with_alts = tier::item_tier_table(game_data, tier::AltMode::On);
    let standard_only = tier::item_tier_table(game_data, tier::AltMode::Off);
    let mut out: Vec<super::dto::ItemTier> = game_data
        .items()
        .iter()
        .filter_map(|item| {
            let tier = with_alts.get(&item.id).copied().flatten();
            let standard_tier = standard_only.get(&item.id).copied().flatten();
            tier.map(|_| super::dto::ItemTier {
                item_id: item.id.clone(),
                tier,
                standard_tier,
            })
        })
        .collect();
    out.sort_by(|a, b| a.item_id.cmp(&b.item_id));
    out
}

/// Persist a designer node position (mirrors `set_machine_layout`).
#[tauri::command]
pub fn factory_plan_layout_set(
    active: State<ActivePlaythrough>,
    factory_id: String,
    node_key: String,
    x: f64,
    y: f64,
) -> AppResult<()> {
    let db = require_active(&active)?;
    db.with(|c| {
        plan_repo::plan_layout_upsert(c, &factory_id, &node_key, x, y, &now_iso())
            .map_err(AppError::from)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn open_test_db() -> PlaythroughDb {
        // Anonymous in-memory DB with refinery migrations applied.
        let db = PlaythroughDb::open_in_memory().expect("open in-memory playthrough db");
        // Plan computation reads the progress row for tier-gated alts;
        // tier 0 reaches no alts, matching the pre-tier-gating tests.
        db.with(|c| crate::features::playthrough::repo::progress_init(c, 0))
            .expect("seed progress row");
        db
    }

    fn insert_test_factory(db: &PlaythroughDb, id: &str, name: &str) {
        db.with(|c| {
            factory_repo::factory_insert(c, id, name, None, None, None, "2026-05-21T00:00:00Z")
        })
        .expect("insert factory");
    }

    // ---------- factory_plan_save / get tests ----------

    use crate::features::planner::dto::{PlanImportSpec, PlanTargetSpec};

    const NOW: &str = "2026-06-10T00:00:00Z";

    #[test]
    fn tier_reachable_alts_gate_by_tier_not_unlock_state() {
        let gd = GameData::from_bundled().unwrap();
        let t0 = tier_reachable_alts(0, &gd);
        let t9 = tier_reachable_alts(9, &gd);
        // Every alt in the dataset is reachable at tier 9; lower tiers
        // are strict subsets. No unlock rows involved anywhere.
        let all_alts = gd.recipes().iter().filter(|r| r.is_alt).count();
        assert_eq!(t9.len(), all_alts);
        // Tier 0 reaches no alts — the game has none at tier 0 — so the
        // dataset must never produce a tier-0 alt for this to reach at all.
        assert!(t0.is_empty());
    }

    fn save_input(factory_id: &str, targets: Vec<PlanTargetSpec>, imports: Vec<PlanImportSpec>) -> SavePlanInput {
        SavePlanInput {
            factory_id: factory_id.to_string(),
            targets,
            imports,
            recipe_overrides: Default::default(),
            options: Default::default(),
        }
    }

    fn cable_target() -> Vec<PlanTargetSpec> {
        vec![PlanTargetSpec { item_id: "Desc_Cable_C".into(), ipm: 60.0, export_ipm: None }]
    }

    #[test]
    fn plan_save_materializes_machines_and_round_trips_inputs() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "Cables v1");

        let result = plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW)
            .expect("save must succeed even with zero claimed supply (warn, don't block)");
        assert!(!result.machine_ids.is_empty());
        assert!(result.link_ids.is_empty(), "no sourced imports → no links");
        assert!(
            result.graph.warnings.iter().any(|w| matches!(
                w,
                crate::features::planner::dto::PlanWarning::RawShort { .. }
            )),
            "zero supply should surface as a warning, not an error"
        );

        // Machines are tagged with their node keys.
        let machines = db
            .with(|c| factory_repo::machines_for_factory(c, "fac-1"))
            .unwrap();
        assert_eq!(machines.len(), result.machine_ids.len());

        // The plan round-trips.
        let plan = plan_get_impl(&db, "fac-1").unwrap();
        assert_eq!(plan.targets.len(), 1);
        assert_eq!(plan.targets[0].item_id, "Desc_Cable_C");
    }

    #[test]
    fn plan_graph_only_counts_raw_supply_claimed_for_this_factory() {
        // Regression for #68: an ore node claimed for one factory must
        // never read as supply for another, even though both draw from
        // the same catalog of nodes. Before this fix `gather_plan_context`
        // fed every factory's plan the whole map's claimed ipm.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");
        insert_test_factory(&db, "copper-works", "Copper Works");

        let iron_node = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .expect("dataset ships an iron node")
            .id
            .clone();
        // Iron is claimed for Iron Works only.
        db.with(|c| {
            nodes_repo::claim_upsert(
                c, &iron_node, Some("Build_MinerMk1_C"), 100.0, Some("iron-works"), None, NOW,
            )
        })
        .expect("claim node for iron-works");

        // Copper Works also needs Iron Ingot but holds no claim of its own.
        let targets = vec![PlanTargetSpec { item_id: "Desc_IronIngot_C".into(), ipm: 15.0, export_ipm: None }];
        let result = plan_save_impl(&db, &gd, save_input("copper-works", targets, vec![]), NOW)
            .expect("save must succeed even short of raw supply (warn, don't block)");

        let raw_claimed = result.graph.nodes.iter().find_map(|n| match n {
            PlanNode::Raw { item_id, claimed_supply_ipm, .. } if item_id == "Desc_OreIron_C" => {
                Some(*claimed_supply_ipm)
            }
            _ => None,
        });
        assert_eq!(
            raw_claimed,
            Some(0.0),
            "Iron Works' claim must not leak into Copper Works' supply"
        );
        assert!(
            result.graph.warnings.iter().any(|w| matches!(
                w,
                crate::features::planner::dto::PlanWarning::RawShort { item_id, claimed_ipm, .. }
                    if item_id == "Desc_OreIron_C" && *claimed_ipm == 0.0
            )),
            "unbound-to-this-factory ore must surface as a genuine shortfall, got {:?}",
            result.graph.warnings
        );
    }

    #[test]
    fn plan_graph_total_power_includes_bound_extractor_draw() {
        // Same tier-0 shape the Power view and Validate see: a Smelter
        // at 50% clock (Iron Ingot direct from raw ore, no upstream
        // stage — 1.6 MW) plus a Miner Mk1 (5 MW) bound to the same
        // factory. Before this fix the miner never touched
        // `total_power_mw` and the plan header read 1.6 MW while
        // Power/Validate read 6.6 — the three-screens-disagree bug
        // from issues #45/#55.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "Iron Works");

        let iron_node = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .expect("dataset ships an iron node")
            .id
            .clone();
        db.with(|c| {
            nodes_repo::claim_upsert(
                c, &iron_node, Some("Build_MinerMk1_C"), 100.0, Some("fac-1"), None, NOW,
            )
        })
        .expect("claim node for fac-1");

        let targets = vec![PlanTargetSpec { item_id: "Desc_IronIngot_C".into(), ipm: 15.0, export_ipm: None }];
        let result = plan_save_impl(&db, &gd, save_input("fac-1", targets, vec![]), NOW)
            .expect("save must succeed even with zero claimed ore supply (warn, don't block)");
        assert!(
            (result.graph.total_power_mw - 6.6).abs() < 0.01,
            "expected 1.6 MW machine + 5 MW miner = 6.6, got {}",
            result.graph.total_power_mw
        );
        // The extractor's share travels with the total: a header
        // showing "1 machine · 6.6 MW" has the two figures counting
        // different sets, and only the breakdown makes them agree.
        assert_eq!(result.graph.extractor_count, 1);
        assert!(
            (result.graph.extractor_power_mw - 5.0).abs() < 0.01,
            "the miner's 5 MW must be attributable, got {}",
            result.graph.extractor_power_mw
        );
        assert_eq!(result.graph.total_machines, 1, "the graph's own machines stay separate");
    }

    #[test]
    fn item_tiers_expose_the_whole_chain_not_the_recipe_stamp() {
        // What the product picker consumes. AI Limiter's standard
        // recipe is Tier 7, but the Plastic alt grounds its whole chain
        // at Tier 5 — the picker filed it under Tier 7 because it read
        // the stamp, and offered it with nothing to say about tier.
        let gd = GameData::from_bundled().unwrap();
        let tiers = list_item_tiers_impl(&gd);
        let by_id: std::collections::HashMap<&str, &crate::features::planner::dto::ItemTier> =
            tiers.iter().map(|t| (t.item_id.as_str(), t)).collect();

        let ai_limiter = by_id["Desc_CircuitBoardHighSpeed_C"];
        assert_eq!(ai_limiter.tier, Some(5));
        assert_eq!(ai_limiter.standard_tier, Some(7));

        let iron_plate = by_id["Desc_IronPlate_C"];
        assert_eq!(iron_plate.tier, Some(0));
        assert_eq!(iron_plate.standard_tier, Some(0));

        // Items nothing can ever produce are left out rather than
        // offered and then rejected by the planner.
        assert!(
            !tiers.iter().any(|t| t.tier.is_none()),
            "an item with no reachable chain must not be listed"
        );
    }

    #[test]
    fn plan_resave_regenerates_plan_machines_but_keeps_manual_ones() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "Cables v1");

        // A manual machine added outside the plan.
        db.with(|c| {
            factory_repo::machine_insert(
                c, "m-manual", "fac-1", "Build_SmelterMk1_C", "Recipe_IngotIron_C",
                1, 100.0, false, 0, 0, None, NOW,
            )
        })
        .unwrap();

        let first = plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW).unwrap();
        let second = plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW).unwrap();

        let machines = db
            .with(|c| factory_repo::machines_for_factory(c, "fac-1"))
            .unwrap();
        // manual + the regenerated plan machines, never the first batch too.
        assert_eq!(machines.len(), 1 + second.machine_ids.len());
        assert!(machines.iter().any(|m| m.id == "m-manual"), "manual machine must survive");
        for id in &first.machine_ids {
            assert!(
                !machines.iter().any(|m| &m.id == id),
                "first-save machines must be regenerated away"
            );
        }
    }

    /// Give a factory a Wire plan that exports 150/min — uncapped
    /// sources only deliver what the supplier actually offers, so
    /// tests that expect a materialized link need a real offer.
    fn plan_wire_exports(db: &PlaythroughDb, gd: &GameData, factory_id: &str) {
        plan_save_impl(
            db,
            gd,
            save_input(
                factory_id,
                vec![PlanTargetSpec {
                    item_id: "Desc_Wire_C".into(),
                    ipm: 150.0,
                    export_ipm: Some(150.0),
                }],
                vec![],
            ),
            NOW,
        )
        .expect("supplier plan saves");
    }

    #[test]
    fn plan_save_creates_links_for_sourced_imports_and_reconciles_on_resave() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-cables", "Cables v1");
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_wire_exports(&db, &gd, "fac-wire");

        let sourced = vec![PlanImportSpec {
            item_id: "Desc_Wire_C".into(),
            source_factory_id: Some("fac-wire".into()),
            ipm_cap: None,
        }];
        let first =
            plan_save_impl(&db, &gd, save_input("fac-cables", cable_target(), sourced.clone()), NOW)
                .unwrap();
        assert_eq!(first.link_ids.len(), 1, "one sourced import → one link");

        let links = db.with(|c| logistics_repo::link_list(c)).unwrap();
        let link = links.iter().find(|l| l.id == first.link_ids[0]).unwrap();
        assert_eq!(link.from_factory_id, "fac-wire");
        assert_eq!(link.to_factory_id, "fac-cables");
        assert_eq!(link.item_id, "Desc_Wire_C");
        assert!((link.items_per_minute - 120.0).abs() < 0.5, "cable @60 needs ~120 wire");

        // Re-save with the import now UNSOURCED: the old link must go.
        let unsourced = vec![PlanImportSpec {
            item_id: "Desc_Wire_C".into(),
            source_factory_id: None,
            ipm_cap: None,
        }];
        let second =
            plan_save_impl(&db, &gd, save_input("fac-cables", cable_target(), unsourced), NOW)
                .unwrap();
        assert!(second.link_ids.is_empty());
        let links_after = db.with(|c| logistics_repo::link_list(c)).unwrap();
        assert!(
            links_after.iter().all(|l| l.id != first.link_ids[0]),
            "previous plan link must be reconciled away"
        );

        // The unsourced import persists as a row with NULL source.
        let plan = plan_get_impl(&db, "fac-cables").unwrap();
        assert_eq!(plan.imports.len(), 1);
        assert_eq!(plan.imports[0].source_factory_id, None);
    }

    #[test]
    fn plan_save_derives_link_distance_from_factory_positions_and_leaves_it_blank_when_unplaced() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-cables", "Cables v1");
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_wire_exports(&db, &gd, "fac-wire");

        let sourced = vec![PlanImportSpec {
            item_id: "Desc_Wire_C".into(),
            source_factory_id: Some("fac-wire".into()),
            ipm_cap: None,
        }];

        // Neither factory has been dragged onto the map yet — the schema's
        // (0, 0) default is the "unplaced" sentinel, so a materialized link
        // must leave distance absent rather than fall back to a fabricated
        // number that would look authoritative but isn't real.
        let unplaced =
            plan_save_impl(&db, &gd, save_input("fac-cables", cable_target(), sourced.clone()), NOW)
                .unwrap();
        let links = db.with(|c| logistics_repo::link_list(c)).unwrap();
        let link = links.iter().find(|l| l.id == unplaced.link_ids[0]).unwrap();
        assert_eq!(link.distance_m, None, "unplaced factories must not get a fabricated distance");

        // Same 3-4-5 triangle used across the map/logistics distance tests:
        // 30,000cm × 40,000cm apart = 50,000cm = 500m.
        db.with(|c| factory_repo::factory_set_position(c, "fac-wire", 10000.0, 10000.0, NOW))
            .unwrap();
        db.with(|c| factory_repo::factory_set_position(c, "fac-cables", 40000.0, 50000.0, NOW))
            .unwrap();

        let placed =
            plan_save_impl(&db, &gd, save_input("fac-cables", cable_target(), sourced), NOW).unwrap();
        let links_after = db.with(|c| logistics_repo::link_list(c)).unwrap();
        let link_after = links_after.iter().find(|l| l.id == placed.link_ids[0]).unwrap();
        assert_eq!(
            link_after.distance_m,
            Some(500),
            "must compute the real map distance, not the old hard-coded 1000m default"
        );
    }

    #[test]
    fn export_offers_clamp_to_actual_production() {
        // export_ipm > ipm is saveable (warn, don't block) but the
        // offer must not promise more than the plan produces.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-wire",
                vec![PlanTargetSpec {
                    item_id: "Desc_Wire_C".into(),
                    ipm: 100.0,
                    export_ipm: Some(500.0),
                }],
                vec![],
            ),
            NOW,
        )
        .unwrap();

        let offers = export_offers_impl(&db, &gd).unwrap();
        let wire = offers
            .iter()
            .find(|o| o.factory_id == "fac-wire")
            .and_then(|o| o.products.iter().find(|p| p.item_id == "Desc_Wire_C"))
            .expect("wire offer");
        assert!((wire.export_ipm - 100.0).abs() < 1e-3, "offer clamps to production");
        assert!((wire.remaining_ipm - 100.0).abs() < 1e-3);

        let capacity = gather_export_capacity(&db, "fac-consumer").unwrap();
        let cap = capacity
            .get(&("fac-wire".to_string(), "Desc_Wire_C".to_string()))
            .copied()
            .unwrap_or(0.0);
        assert!((cap - 100.0).abs() < 1e-3, "capacity clamps to production, got {cap}");
    }

    // ---------- raise-the-exporter's-target tests ----------

    fn offer_remaining(db: &PlaythroughDb, gd: &GameData, factory_id: &str, item_id: &str) -> f32 {
        export_offers_impl(db, gd)
            .unwrap()
            .iter()
            .find(|o| o.factory_id == factory_id)
            .and_then(|o| o.products.iter().find(|p| p.item_id == item_id))
            .map(|p| p.remaining_ipm)
            .unwrap_or(0.0)
    }

    fn saved_target(db: &PlaythroughDb, factory_id: &str, item_id: &str) -> PlanTargetSpec {
        plan_get_impl(db, factory_id)
            .unwrap()
            .targets
            .into_iter()
            .find(|t| t.item_id == item_id)
            .expect("target")
    }

    #[test]
    fn raise_export_target_covers_the_gap_the_source_picker_showed() {
        // The Tier 8 wall: every candidate exporter is sized to the
        // demand it had when it was built, so the picker's answer is
        // always "0/min left" and the only way through was to leave the
        // plan, find that factory, raise it, and come back.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-wire", "Wire farm");
        insert_test_factory(&db, "fac-cables", "Cables v1");

        // 60 cable/min draws 120 wire/min, which is the farm's whole
        // offer — if the dataset's cable ratio ever changes, the
        // assertion below is what says so.
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-wire",
                vec![PlanTargetSpec {
                    item_id: "Desc_Wire_C".into(),
                    ipm: 120.0,
                    export_ipm: Some(120.0),
                }],
                vec![],
            ),
            NOW,
        )
        .unwrap();
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-cables",
                cable_target(),
                vec![PlanImportSpec {
                    item_id: "Desc_Wire_C".into(),
                    source_factory_id: Some("fac-wire".into()),
                    ipm_cap: None,
                }],
            ),
            NOW,
        )
        .unwrap();
        assert!(
            offer_remaining(&db, &gd, "fac-wire", "Desc_Wire_C") < 1e-3,
            "setup: the cable factory must consume the farm's whole offer"
        );

        let raised =
            raise_export_target_impl(&db, &gd, "fac-wire", "Desc_Wire_C", 60.0, None, NOW).unwrap();
        assert!((raised.previous_export_ipm - 120.0).abs() < 1e-3);
        assert!((raised.new_export_ipm - 180.0).abs() < 1e-3, "offer must grow by the shortfall");
        assert!(
            (raised.new_target_ipm - 180.0).abs() < 1e-3,
            "the extra has to actually be produced, not carved out of the existing rate"
        );
        assert!((raised.remaining_ipm - 60.0).abs() < 1e-3);

        // And the picker agrees, without anything else being saved.
        assert!((offer_remaining(&db, &gd, "fac-wire", "Desc_Wire_C") - 60.0).abs() < 1e-3);
        let target = saved_target(&db, "fac-wire", "Desc_Wire_C");
        assert!((target.ipm - 180.0).abs() < 1e-3);
        assert_eq!(target.export_ipm.map(|e| (e - 180.0).abs() < 1e-3), Some(true));
    }

    #[test]
    fn raise_export_target_takes_a_wanted_spare_not_a_delta() {
        // The panel can be looking at a stale offer, and a double click
        // is one gesture away — asking for "60 spare" twice must leave
        // 60 spare, not 120.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_wire_exports(&db, &gd, "fac-wire"); // 150 made, 150 offered, none drawn

        let first = raise_export_target_impl(&db, &gd, "fac-wire", "Desc_Wire_C", 60.0, None, NOW).unwrap();
        assert!(
            (first.new_target_ipm - 150.0).abs() < 1e-3,
            "150 spare already covers 60 — nothing to raise"
        );
        assert!(first.introduced_warnings.is_empty(), "a no-op can't have cost anything");

        let second =
            raise_export_target_impl(&db, &gd, "fac-wire", "Desc_Wire_C", 200.0, None, NOW).unwrap();
        assert!((second.new_target_ipm - 200.0).abs() < 1e-3);
        let third =
            raise_export_target_impl(&db, &gd, "fac-wire", "Desc_Wire_C", 200.0, None, NOW).unwrap();
        assert!(
            (third.new_target_ipm - 200.0).abs() < 1e-3,
            "the second ask for the same spare must not stack on the first"
        );
    }

    #[test]
    fn raise_export_target_accounts_for_existing_overdraw_when_the_offer_was_reduced() {
        // Codex P2: if other consumers already draw more than the
        // exporter currently offers — e.g. its target was reduced after
        // a link was sized against the old, larger offer — clamping
        // `spare` to zero threw away that existing deficit. 100 offered,
        // 120 already drawn, 20 more wanted: the required offer is 140
        // (120 + 20), not 120 (100 + 20, the old bug).
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-wire", "Wire farm");
        insert_test_factory(&db, "fac-cables", "Cables v1");

        // The farm starts generous enough to cover the cable factory in
        // full.
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-wire",
                vec![PlanTargetSpec { item_id: "Desc_Wire_C".into(), ipm: 200.0, export_ipm: Some(200.0) }],
                vec![],
            ),
            NOW,
        )
        .unwrap();
        // 60 cable/min draws 120 wire/min — sizes the link to 120 while
        // the farm still offers 200.
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-cables",
                cable_target(),
                vec![PlanImportSpec {
                    item_id: "Desc_Wire_C".into(),
                    source_factory_id: Some("fac-wire".into()),
                    ipm_cap: None,
                }],
            ),
            NOW,
        )
        .unwrap();

        // The farm's own target then drops to 100 — a real edit made
        // independently, elsewhere. The cable factory's link is untouched
        // by that resave and still asks for its original 120.
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-wire",
                vec![PlanTargetSpec { item_id: "Desc_Wire_C".into(), ipm: 100.0, export_ipm: Some(100.0) }],
                vec![],
            ),
            NOW,
        )
        .unwrap();
        assert!(
            (drawn_export_ipm(&db, "fac-wire", "Desc_Wire_C", None).unwrap() - 120.0).abs() < 1e-3,
            "setup: the cable factory's link must still draw 120 after the farm's own resave"
        );

        let raised =
            raise_export_target_impl(&db, &gd, "fac-wire", "Desc_Wire_C", 20.0, None, NOW).unwrap();
        assert!(
            (raised.new_export_ipm - 140.0).abs() < 1e-3,
            "120 already drawn + 20 wanted = 140; got {}",
            raised.new_export_ipm
        );
        assert!((raised.new_target_ipm - 140.0).abs() < 1e-3);
    }

    #[test]
    fn raise_export_target_reports_the_cost_without_rewriting_upstream() {
        // The design call: a raise that leaves the exporter short on its
        // own inputs is reported, not chased. Cascading would rewrite an
        // unbounded fan of factories from one click.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-smelter", "Ingot smelter");
        insert_test_factory(&db, "fac-wire", "Wire farm");

        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-smelter",
                vec![PlanTargetSpec {
                    item_id: "Desc_CopperIngot_C".into(),
                    ipm: 100.0,
                    export_ipm: Some(100.0),
                }],
                vec![],
            ),
            NOW,
        )
        .unwrap();
        // 100 wire/min needs 50 ingot/min — comfortably inside the
        // smelter's offer, so the farm starts with no import gap.
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-wire",
                vec![PlanTargetSpec {
                    item_id: "Desc_Wire_C".into(),
                    ipm: 100.0,
                    export_ipm: Some(100.0),
                }],
                vec![PlanImportSpec {
                    item_id: "Desc_CopperIngot_C".into(),
                    source_factory_id: Some("fac-smelter".into()),
                    ipm_cap: None,
                }],
            ),
            NOW,
        )
        .unwrap();

        // 300 wire/min needs 150 ingot/min; the smelter only offers 100.
        let raised =
            raise_export_target_impl(&db, &gd, "fac-wire", "Desc_Wire_C", 300.0, None, NOW).unwrap();
        assert!((raised.new_target_ipm - 300.0).abs() < 1e-3);
        let short = raised
            .introduced_warnings
            .iter()
            .find_map(|w| match w {
                super::super::dto::PlanWarning::ImportShort { item_id, gap_ipm, .. }
                    if item_id == "Desc_CopperIngot_C" =>
                {
                    Some(*gap_ipm)
                }
                _ => None,
            })
            .expect("the raise must own up to the import gap it opened");
        assert!((short - 50.0).abs() < 1e-3, "gap should be 150 needed − 100 offered, got {short}");

        // Nothing upstream moved: the smelter is exactly as it was.
        let smelter = saved_target(&db, "fac-smelter", "Desc_CopperIngot_C");
        assert!((smelter.ipm - 100.0).abs() < 1e-3, "the raise must not cascade into the smelter");
        assert_eq!(smelter.export_ipm.map(|e| (e - 100.0).abs() < 1e-3), Some(true));
    }

    #[test]
    fn export_offers_include_a_factory_that_makes_the_item_but_never_exported_it() {
        // The Tier 8 dead end: a plant with 60/min entirely spare read
        // as "not exporting this — plan it there later", so the source
        // picker's answer was "nobody" and picking it added a row
        // supplying nothing.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-wire",
                vec![PlanTargetSpec {
                    item_id: "Desc_Wire_C".into(),
                    ipm: 60.0,
                    export_ipm: None,
                }],
                vec![],
            ),
            NOW,
        )
        .unwrap();

        let product = export_offers_impl(&db, &gd)
            .unwrap()
            .iter()
            .find(|o| o.factory_id == "fac-wire")
            .and_then(|o| o.products.iter().find(|p| p.item_id == "Desc_Wire_C").cloned())
            .expect("a factory that makes the item must be offered as a source");
        assert!((product.produced_ipm - 60.0).abs() < 1e-3);
        assert!(product.export_ipm.abs() < 1e-3, "it really hasn't declared an export slice");
        assert!(product.remaining_ipm.abs() < 1e-3);
        assert!(
            (product.spare_ipm - 60.0).abs() < 1e-3,
            "all 60 could be had for the price of opening the slice, got {}",
            product.spare_ipm
        );

        // And taking it costs the exporter nothing: the machines are
        // already there, so only the slice moves.
        let raised =
            raise_export_target_impl(&db, &gd, "fac-wire", "Desc_Wire_C", 60.0, None, NOW).unwrap();
        assert!(
            (raised.new_target_ipm - 60.0).abs() < 1e-3,
            "production already covered it — nothing to build"
        );
        assert!((raised.new_export_ipm - 60.0).abs() < 1e-3);
        assert!(raised.introduced_warnings.is_empty() && raised.worsened_warnings.is_empty());
    }

    #[test]
    fn raise_export_target_tops_up_a_source_the_asker_already_draws_from() {
        // Re-scaling a network is mostly top-ups: the source is already
        // wired in, and "20/min more" has to be asked for as "this much
        // for me" or the raise double-counts the asker's own draw and
        // over-provisions the exporter.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-wire", "Wire farm");
        insert_test_factory(&db, "fac-cables", "Cables v1");
        insert_test_factory(&db, "fac-other", "Cables v2");

        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-wire",
                vec![PlanTargetSpec {
                    item_id: "Desc_Wire_C".into(),
                    ipm: 200.0,
                    export_ipm: Some(200.0),
                }],
                vec![],
            ),
            NOW,
        )
        .unwrap();
        let wire_from_farm = || {
            vec![PlanImportSpec {
                item_id: "Desc_Wire_C".into(),
                source_factory_id: Some("fac-wire".into()),
                ipm_cap: None,
            }]
        };
        // 60 cable/min draws 120 wire/min, 40 draws 80 — together they
        // take the farm's whole offer.
        plan_save_impl(&db, &gd, save_input("fac-cables", cable_target(), wire_from_farm()), NOW)
            .unwrap();
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-other",
                vec![PlanTargetSpec { item_id: "Desc_Cable_C".into(), ipm: 40.0, export_ipm: None }],
                wire_from_farm(),
            ),
            NOW,
        )
        .unwrap();
        assert!(
            offer_remaining(&db, &gd, "fac-wire", "Desc_Wire_C") < 1e-3,
            "setup: both consumers together must exhaust the farm's offer"
        );

        // Cables v1 grows and now wants 180 wire/min for itself.
        let raised = raise_export_target_impl(
            &db,
            &gd,
            "fac-wire",
            "Desc_Wire_C",
            180.0,
            Some("fac-cables"),
            NOW,
        )
        .unwrap();
        assert!(
            (raised.new_export_ipm - 260.0).abs() < 1e-3,
            "180 for the asker + 80 still going to Cables v2; counting the asker's own 120 again \
             would have asked for 380, got {}",
            raised.new_export_ipm
        );
        assert!((raised.new_target_ipm - 260.0).abs() < 1e-3);
        // What the asker's own plan will now be allowed to pull.
        let capacity = gather_export_capacity(&db, "fac-cables").unwrap();
        let for_cables = capacity
            .get(&("fac-wire".to_string(), "Desc_Wire_C".to_string()))
            .copied()
            .unwrap_or(0.0);
        assert!((for_cables - 180.0).abs() < 1e-3, "the asker must get exactly its ask, got {for_cables}");
    }

    #[test]
    fn raise_export_target_refuses_an_item_the_factory_does_not_make() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_wire_exports(&db, &gd, "fac-wire");

        let err = raise_export_target_impl(&db, &gd, "fac-wire", "Desc_Cable_C", 10.0, None, NOW)
            .unwrap_err();
        let AppError::Invalid(message) = err else {
            panic!("expected an Invalid error naming the factory and the product");
        };
        assert!(message.contains("Wire farm") && message.contains("Cable"), "got {message}");
    }

    #[test]
    fn warnings_introduced_reports_new_and_worsened_findings_only() {
        use super::super::dto::PlanWarning as W;
        let raw = |demand: f32| W::RawShort {
            item_id: "Desc_OreCopper_C".into(),
            item_name: "Copper Ore".into(),
            demand_ipm: demand,
            claimed_ipm: 60.0,
        };
        let before = vec![
            raw(100.0),
            W::FluidSurplus {
                item_id: "Desc_Water_C".into(),
                item_name: "Water".into(),
                ipm: 30.0,
            },
        ];
        let after = vec![
            // Worse than before — the widening is this edit's doing.
            raw(160.0),
            // Unchanged, and not caused here: reporting it would make
            // the edit look responsible for a pre-existing gap.
            W::FluidSurplus {
                item_id: "Desc_Water_C".into(),
                item_name: "Water".into(),
                ipm: 30.0,
            },
            W::ImportShort {
                item_id: "Desc_CopperIngot_C".into(),
                item_name: "Copper Ingot".into(),
                gap_ipm: 50.0,
            },
        ];

        let (introduced, worsened) = warnings_introduced(&before, &after);
        // The two lists get different sentences in the panel, so a gap
        // that was already open must never land in `introduced`.
        assert_eq!(introduced.len(), 1, "got {introduced:?}");
        assert!(introduced.iter().any(|w| matches!(w, W::ImportShort { .. })));
        assert_eq!(worsened, vec![raw(160.0)], "the ore gap was open before; this edit widened it");

        // An edit that closes a gap owns nothing.
        let (closed_new, closed_worse) = warnings_introduced(&after, &before);
        assert!(closed_new
            .iter()
            .chain(closed_worse.iter())
            .all(|w| !matches!(w, W::RawShort { .. } | W::FluidSurplus { .. })));
    }

    #[test]
    fn plan_save_unknown_factory_is_not_found() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        let err = plan_save_impl(&db, &gd, save_input("fac-missing", cable_target(), vec![]), NOW)
            .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn plan_save_rejects_nonpositive_target_rate() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "X");
        let err = plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-1",
                vec![PlanTargetSpec { item_id: "Desc_Cable_C".into(), ipm: 0.0, export_ipm: None }],
                vec![],
            ),
            NOW,
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn assign_import_source_links_the_unsourced_input() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-cables", "Cables v1");
        insert_test_factory(&db, "fac-wire", "Wire farm");
        plan_wire_exports(&db, &gd, "fac-wire");

        // Save a plan with an unsourced Wire input.
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-cables",
                cable_target(),
                vec![PlanImportSpec {
                    item_id: "Desc_Wire_C".into(),
                    source_factory_id: None,
                    ipm_cap: None,
                }],
            ),
            NOW,
        )
        .unwrap();

        let unsourced = db.with(|c| plan_repo::unsourced_inputs_all(c)).unwrap();
        assert_eq!(unsourced.len(), 1);
        assert_eq!(unsourced[0].factory_id, "fac-cables");

        // Drag onto the wire factory.
        let result = assign_import_source_impl(
            &db,
            &gd,
            &unsourced[0].import_id,
            "fac-wire",
            NOW,
        )
        .unwrap();
        assert_eq!(result.link_ids.len(), 1, "assigning a source materializes the link");

        let after = db.with(|c| plan_repo::unsourced_inputs_all(c)).unwrap();
        assert!(after.is_empty(), "the input is no longer unsourced");

        let links = db.with(|c| logistics_repo::link_list(c)).unwrap();
        let link = links.iter().find(|l| l.id == result.link_ids[0]).unwrap();
        assert_eq!(link.from_factory_id, "fac-wire");
        assert_eq!(link.to_factory_id, "fac-cables");
    }

    #[test]
    fn assign_import_source_rejects_self_supply() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-cables", "Cables v1");
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-cables",
                cable_target(),
                vec![PlanImportSpec {
                    item_id: "Desc_Wire_C".into(),
                    source_factory_id: None,
                    ipm_cap: None,
                }],
            ),
            NOW,
        )
        .unwrap();
        let unsourced = db.with(|c| plan_repo::unsourced_inputs_all(c)).unwrap();
        let err = assign_import_source_impl(&db, &gd, &unsourced[0].import_id, "fac-cables", NOW)
            .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn plan_layout_survives_save_and_prunes_stale_keys() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-1", "Cables v1");
        plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW).unwrap();

        db.with(|c| {
            plan_repo::plan_layout_upsert(c, "fac-1", "recipe:Desc_Cable_C", 5.0, 6.0, NOW)?;
            plan_repo::plan_layout_upsert(c, "fac-1", "recipe:Desc_GoneItem_C", 1.0, 1.0, NOW)
        })
        .unwrap();

        plan_save_impl(&db, &gd, save_input("fac-1", cable_target(), vec![]), NOW).unwrap();
        let plan = plan_get_impl(&db, "fac-1").unwrap();
        assert!(
            plan.layout.iter().any(|l| l.node_key == "recipe:Desc_Cable_C"),
            "live node keeps its position"
        );
        assert!(
            plan.layout.iter().all(|l| l.node_key != "recipe:Desc_GoneItem_C"),
            "stale node key must be pruned on save"
        );
    }
}
