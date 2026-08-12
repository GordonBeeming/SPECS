use std::collections::HashSet;

use tauri::State;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::features::alts::repo as alts_repo;
use crate::features::factory::dto::Factory;
use crate::features::factory::repo as factory_repo;
use crate::features::logistics::dto as logistics_dto;
use crate::features::logistics::repo as logistics_repo;
use crate::features::playthrough::state::ActivePlaythrough;
use crate::features::resource_nodes::domain as nodes_domain;
use crate::features::resource_nodes::repo as nodes_repo;
use crate::shared::error::{AppError, AppResult};
use crate::shared::gamedata::GameData;

use crate::shared::db::playthrough_db::PlaythroughDb;

use super::domain::{compute_plan_graph, export_slice_ipm, spare_ipm, FLOW_EPS_IPM};
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
    /// Alts actually scanned, which is a different question from `alts`
    /// (everything the tier reaches). The planner plans with the second
    /// set on purpose; the designer needs the first to say so.
    collected_alts: HashSet<String>,
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
    let collected_alts: HashSet<String> = db
        .with(|c| alts_repo::alt_list(c).map_err(AppError::from))?
        .into_iter()
        .map(|a| a.recipe_id)
        .collect();
    let claims = db.with(|c| nodes_repo::claims_all(c).map_err(AppError::from))?;
    let water_groups = db.with(|c| nodes_repo::water_groups_all(c).map_err(AppError::from))?;
    let supply =
        nodes_domain::supply_for_factory(&claims, &water_groups, factory_id, tier, game_data);
    Ok(PlanContext { alts, collected_alts, current_tier: tier, supply, claims, water_groups })
}

/// Name the alts a computed plan leans on that aren't scanned yet.
///
/// Deliberately not a `PlanWarning`: the plan is correct and buildable
/// in principle, and whether the pioneer can build it *today* is a
/// separate fact from whether the chain is sound. Kept as its own list
/// so the designer can say "this needs 3 alts you haven't got" beside
/// the recipes rather than in the same amber block as a raw shortfall.
fn attach_uncollected_alts(
    graph: &mut super::dto::PlanGraph,
    collected: &HashSet<String>,
    game_data: &GameData,
) {
    let mut names: Vec<String> = graph
        .nodes
        .iter()
        .filter_map(|n| match n {
            PlanNode::Recipe { recipe_id, is_alt: true, .. } => Some(recipe_id),
            _ => None,
        })
        .filter(|recipe_id| !collected.contains(*recipe_id))
        .map(|recipe_id| {
            game_data
                .recipe(recipe_id)
                .map(|r| r.name.clone())
                .unwrap_or_else(|| recipe_id.clone())
        })
        .collect();
    names.sort();
    names.dedup();
    graph.uncollected_alts = names;
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
    game_data: &GameData,
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
    let mut planned: HashSet<(String, String)> = HashSet::new();
    for (fid, t) in targets {
        planned.insert((fid.clone(), t.item_id.clone()));
        if t.export_ipm.unwrap_or(0.0) <= 0.0 {
            continue;
        }
        let export = export_slice_ipm(t.export_ipm, t.ipm);
        let d = *drawn.get(&(fid.clone(), t.item_id.clone())).unwrap_or(&0.0);
        out.insert((fid, t.item_id), spare_ipm(export, d));
    }
    // Intermediates need no export slice to be real capacity, so an
    // import sourced from one has to size itself against the surplus
    // directly — otherwise the picker offers a source the solve then
    // treats as delivering nothing.
    for ((fid, item), surplus) in intermediate_surplus(db, game_data)? {
        if planned.contains(&(fid.clone(), item.clone())) {
            continue;
        }
        let d = *drawn.get(&(fid.clone(), item.clone())).unwrap_or(&0.0);
        out.insert((fid, item), spare_ipm(surplus, d));
    }
    Ok(out)
}

/// Machine-side spare per (factory, item) for every item a factory's
/// machines actually make — the ingots, sheets, rods and byproducts a
/// plan produces on its way to what it was told to build.
///
/// This is the whole of the "surplus export" idea: an intermediate is
/// already being produced, so taking some of it claims part of an
/// existing flow rather than adding a product. That distinction is why
/// `raise_export_target` can keep refusing to add a target to somebody
/// else's factory — a raise changes what that factory *is*, and this
/// doesn't.
///
/// **Producing the item is the qualifier, not having any of it spare.**
/// A factory that makes an item and consumes every unit belongs in the
/// answer with a spare of zero: leaving it out is indistinguishable
/// from "no factory makes this", and that ambiguity is what makes the
/// import flow look broken when it isn't. It's the same rule
/// `export_offers_impl` already applies to targets, where a target with
/// nothing left still gets a row. What zero *means* is unchanged —
/// taking any of it needs that factory to grow, which is a target
/// change and still the refusal above.
///
/// Read off the materialized machines rather than by re-solving each
/// plan: plan-managed machine rows are regenerated on every save, so
/// they're the persisted shadow of the plan graph, and this runs on
/// every debounced compute.
fn intermediate_surplus(
    db: &PlaythroughDb,
    game_data: &GameData,
) -> AppResult<std::collections::HashMap<(String, String), f32>> {
    let (tier_i64, _) =
        db.with(|c| crate::features::playthrough::repo::progress_get(c).map_err(AppError::from))?;
    let tier: u8 = tier_i64.clamp(0, u8::MAX as i64) as u8;
    // Whole-playthrough tables, loaded once and passed through rather
    // than re-queried per factory.
    let factories = db.with(|c| factory_repo::factory_list(c).map_err(AppError::from))?;
    let claims = db.with(|c| nodes_repo::claims_all(c).map_err(AppError::from))?;
    let water_groups = db.with(|c| nodes_repo::water_groups_all(c).map_err(AppError::from))?;
    let no_links = std::collections::HashMap::new();

    let mut out = std::collections::HashMap::new();
    for f in factories {
        let machines =
            db.with(|c| factory_repo::machines_for_factory(c, &f.id).map_err(AppError::from))?;
        if machines.is_empty() {
            continue;
        }
        let ledger = crate::features::factory::commands::compose_ledger_with_supply(
            &f.id,
            &machines,
            game_data,
            &claims,
            &water_groups,
            &no_links,
            tier,
        );
        for flow in ledger.flows {
            // An item the factory only *consumes* — its ore, its
            // imported inputs — is not something it can be a source
            // for, so those stay out. Anything its machines make is in,
            // spare or not.
            if flow.produced_per_minute > 0.0 {
                out.insert(
                    (f.id.clone(), flow.item_id),
                    spare_ipm(flow.produced_per_minute, flow.consumed_per_minute),
                );
            }
        }
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
    let mut recipes: std::collections::HashMap<String, String> = db
        .with(|c| plan_repo::plan_recipes_for_factory(c, factory_id).map_err(AppError::from))?
        .into_iter()
        .collect();
    // Plans saved before the recipe of every step was recorded only ever
    // persisted the items the player pinned by hand, so a factory built
    // without ever opening the recipe picker has none at all while its
    // machines are standing in the game. Reading the choice back off
    // those machines is what stops the next save — which can come from
    // another factory's screen, and from a tier that reaches recipes the
    // plan was never solved against — re-solving into a build sheet
    // nobody asked for. A save persists the full chosen set, so this
    // fills nothing on a plan saved since.
    for (node_key, recipe_id) in db.with(|c| {
        plan_repo::plan_machine_recipes_for_factory(c, factory_id).map_err(AppError::from)
    })? {
        let Some(item_id) = super::domain::recipe_node_item(&node_key) else {
            continue;
        };
        recipes.entry(item_id.to_string()).or_insert(recipe_id);
    }
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
        recipe_overrides: recipes,
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
    let export_capacity = gather_export_capacity(db, game_data, factory_id)?;
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

/// Claim the link a previous save left behind for this route, so a
/// re-save can carry it forward instead of building a replacement.
///
/// Matching is on `(source factory, item)` because that pair is the
/// route the player was looking at when they chose its transport; two
/// import rows for the same pair are interchangeable, so the first
/// unclaimed one wins and each is claimed at most once.
fn claim_reusable_link(
    pool: &mut Vec<logistics_dto::LogisticsLink>,
    source_factory_id: &str,
    item_id: &str,
) -> Option<logistics_dto::LogisticsLink> {
    let idx = pool
        .iter()
        .position(|l| l.from_factory_id == source_factory_id && l.item_id == item_id)?;
    Some(pool.remove(idx))
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
    let export_capacity = gather_export_capacity(db, game_data, &input.factory_id)?;
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
    // The designer renders the saved graph straight back, so a flag it
    // was showing before the save has to survive it.
    attach_uncollected_alts(&mut graph, &ctx.collected_alts, game_data);

    let mut machine_ids: Vec<String> = Vec::new();
    let mut link_ids: Vec<String> = Vec::new();

    db.with(|c| {
        let tx = c.unchecked_transaction()?;

        // Logistics links from previous saves, held aside so the
        // materialization step below can carry each one forward onto
        // the route it still serves. Whatever is left unclaimed is a
        // route this plan no longer has, and gets deleted at the end —
        // removed and re-routed imports never leave orphans.
        //
        // Carrying the row forward rather than replacing it is what
        // makes a re-save non-destructive: the link holds a transport
        // kind and plan the player picked and notes they wrote, and its
        // id is what a train route is attached by (`train_route_link`
        // cascades on delete). Rebuilding it would quietly reset every
        // one of those on an ordinary target edit, and leave the
        // re-optimize Undo with nothing to put back.
        //
        // Read before `plan_imports_replace` — the link ids live on the
        // import rows it is about to wipe.
        let mut reusable_links: Vec<logistics_dto::LogisticsLink> = Vec::new();
        for old_link in plan_repo::plan_link_ids_for_factory(&tx, &input.factory_id)? {
            // An id with no row behind it would mean the FK's
            // `ON DELETE SET NULL` failed to fire; skip rather than
            // fail the save over a link that is already gone.
            if let Some(link) = logistics_repo::link_get(&tx, &old_link)? {
                reusable_links.push(link);
            }
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

        // The recipe each step ended up on is part of what was saved,
        // not a detail to re-derive later. A plan is a build sheet for
        // machines the player has physically placed, and the recipe set
        // the solver may choose from widens on its own as the
        // playthrough reaches new tiers — so a save made on this
        // factory's behalf from somewhere else (raising an exporter's
        // target, sourcing an import from the map) would otherwise
        // redesign a standing factory nobody asked about, with no diff
        // and no way to refuse. Recording the choice makes every later
        // solve reproduce the same sheet; the designer's Re-optimize
        // drops these and takes the better plan deliberately.
        //
        // A submitted pin for an item the graph has no step for — one
        // that's imported today — is kept as-is so the choice comes back
        // if the import goes away.
        let mut chosen: std::collections::HashMap<String, String> = graph
            .nodes
            .iter()
            .filter_map(|n| match n {
                PlanNode::Recipe { item_id, recipe_id, .. } => {
                    Some((item_id.clone(), recipe_id.clone()))
                }
                _ => None,
            })
            .collect();
        for (item_id, recipe_id) in &input.recipe_overrides {
            chosen.entry(item_id.clone()).or_insert_with(|| recipe_id.clone());
        }
        let mut recipe_rows: Vec<(String, String)> = chosen.into_iter().collect();
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
                if alloc.resolved_ipm <= FLOW_EPS_IPM {
                    continue;
                }
                // Computed fresh from both factories' current map
                // positions rather than a fabricated default — a wrong
                // number that looks authoritative (the old hard-coded
                // 1000m) is worse than a blank one, and an unplaced
                // source correctly comes back `None`.
                let source_factory =
                    factory_repo::factory_get(&tx, &alloc.source_factory_id)?;
                let measured_m = source_factory
                    .as_ref()
                    .and_then(|src| factory_distance_meters(&dest_factory, src));
                let link_id = match claim_reusable_link(
                    &mut reusable_links,
                    &alloc.source_factory_id,
                    item_id,
                ) {
                    // The route is still here, so the transport kind,
                    // the plan under it and the notes beside it still
                    // stand — a save restates only what it can derive.
                    // Distance it can, the rest it can't, so a fresh
                    // measurement wins while an unmeasurable one (an
                    // endpoint off the map) leaves the stored figure
                    // alone rather than blanking it.
                    Some(prev) => {
                        logistics_repo::link_update(
                            &tx,
                            &prev.id,
                            alloc.resolved_ipm,
                            &prev.transport_kind,
                            &prev.transport_plan_json,
                            measured_m.or(prev.distance_m),
                            prev.notes.as_deref(),
                            now,
                        )?;
                        prev.id
                    }
                    None => {
                        let link_id = Uuid::new_v4().to_string();
                        logistics_repo::link_insert(
                            &tx,
                            &link_id,
                            &alloc.source_factory_id,
                            &input.factory_id,
                            item_id,
                            alloc.resolved_ipm,
                            "belt",
                            "null", // transport_plan_json — picker refines later
                            measured_m,
                            None,
                            now,
                        )?;
                        link_id
                    }
                };
                plan_repo::plan_import_set_link(&tx, &row.id, Some(&link_id), now)?;
                link_ids.push(link_id);
            }
        }

        // Anything still unclaimed served a route this plan no longer
        // has — an import that was removed, re-pointed at another
        // factory, or left unused by the recipes the solve landed on.
        for stale in reusable_links {
            logistics_repo::link_delete(&tx, &stale.id)?;
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
    let export_capacity = gather_export_capacity(&db, &game_data, &input.factory_id)?;
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
            attach_uncollected_alts(&mut graph, &ctx.collected_alts, &game_data);
            // Designer path only. The save path and the validation
            // sweep don't need the offers, and computing them means
            // reading every factory's machines — a cost worth paying
            // once per edit and not once per factory in a sweep.
            let offers = export_offers_impl(&db, &game_data)?;
            attach_existing_producers(&mut graph, &input.factory_id, &offers);
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
    let mut planned: HashSet<(String, String)> = HashSet::new();
    for (fid, t) in targets {
        planned.insert((fid.clone(), t.item_id.clone()));
        if t.ipm <= 0.0 {
            continue;
        }
        let export = export_slice_ipm(t.export_ipm, t.ipm);
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
            remaining_ipm: spare_ipm(export, drawn_ipm),
            spare_ipm: spare_ipm(t.ipm, drawn_ipm),
            has_target: true,
        });
    }

    // Intermediates. Every factory produces several items on the way to
    // what it was told to build, and from Tier 4 on those — ingots,
    // sheets, rods, wire — are exactly what a new factory wants. There's
    // no export slice to widen here and none to declare: whatever the
    // machines leave over is available as it stands, so `export_ipm` is
    // that figure directly. Where it's zero the row still belongs, for
    // the same reason a target with nothing left keeps its row: "makes
    // it, none spare" and "nobody makes it" are different answers and
    // the panel has to be able to tell them apart.
    // Sorted before they're appended: the source is a HashMap, and a
    // panel whose rows reshuffle between two identical loads is its own
    // bug. Targets keep their declared order ahead of them.
    let mut intermediates: Vec<((String, String), f32)> =
        intermediate_surplus(db, game_data)?.into_iter().collect();
    intermediates.sort_by(|a, b| a.0.cmp(&b.0));
    for ((fid, item_id), surplus) in intermediates {
        // A target of the same factory is the raise path's business and
        // already has its row above. A surplus of zero is not a reason
        // to drop the row — see `intermediate_surplus`.
        if planned.contains(&(fid.clone(), item_id.clone())) {
            continue;
        }
        let drawn_ipm = *drawn.get(&(fid.clone(), item_id.clone())).unwrap_or(&0.0);
        by_factory.entry(fid).or_default().push(super::dto::ExportOfferProduct {
            item_name: game_data
                .item(&item_id)
                .map(|i| i.name.clone())
                .unwrap_or_else(|| item_id.clone()),
            item_id,
            produced_ipm: surplus,
            export_ipm: surplus,
            drawn_ipm,
            remaining_ipm: spare_ipm(surplus, drawn_ipm),
            spare_ipm: spare_ipm(surplus, drawn_ipm),
            // No target here by construction — `planned` skipped every
            // item that has one, so a raise on this would only 400.
            has_target: false,
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

/// Below this a "somebody else already makes it" prompt is noise — the
/// same half-a-tenth threshold the rest of the planner reports against.
const OFFERABLE_SPARE_IPM: f32 = super::domain::REPORTABLE_IPM;

/// Point every locally-built step at the factories that already make
/// that item with capacity to spare.
///
/// The Sources panel has always been able to answer this, per item, once
/// you go and ask. Nothing asked it *for* you, so the default outcome
/// was rebuilding: at Tier 9 four factories built 238 machines' worth of
/// parts three other factories were already making with spare, while the
/// two that did take the import path needed 1 and 2 machines. Attaching
/// the answer to the graph is what lets the designer offer it at the
/// moment the local copy appears.
///
/// Offers only — nothing here changes a plan. Which producer to take
/// from, and whether to take one at all, stays the user's call.
fn attach_existing_producers(
    graph: &mut super::dto::PlanGraph,
    factory_id: &str,
    offers: &[super::dto::ExportOffer],
) {
    // Items this plan already imports aren't candidates: the flow the
    // prompt would suggest is the one that's already there.
    let imported: HashSet<&str> = graph
        .nodes
        .iter()
        .filter_map(|n| match n {
            PlanNode::Import { item_id, .. } => Some(item_id.as_str()),
            _ => None,
        })
        .collect();

    let mut out: Vec<super::dto::ExistingProducer> = Vec::new();
    for node in &graph.nodes {
        let PlanNode::Recipe { node_key, item_id, item_name, output_ipm, .. } = node else {
            continue;
        };
        if imported.contains(item_id.as_str()) {
            continue;
        }
        let mut sources: Vec<super::dto::ExistingProducerSource> = offers
            .iter()
            .filter(|o| o.factory_id != factory_id)
            .filter_map(|o| {
                o.products
                    .iter()
                    .find(|p| p.item_id == *item_id && p.spare_ipm > OFFERABLE_SPARE_IPM)
                    .map(|p| super::dto::ExistingProducerSource {
                        factory_id: o.factory_id.clone(),
                        factory_name: o.factory_name.clone(),
                        spare_ipm: p.spare_ipm,
                        remaining_ipm: p.remaining_ipm,
                        has_target: p.has_target,
                    })
            })
            .collect();
        if sources.is_empty() {
            continue;
        }
        // Most spare first, then by name so equal offers don't shuffle.
        sources.sort_by(|a, b| {
            b.spare_ipm
                .partial_cmp(&a.spare_ipm)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.factory_name.to_lowercase().cmp(&b.factory_name.to_lowercase()))
        });
        out.push(super::dto::ExistingProducer {
            node_key: node_key.clone(),
            item_id: item_id.clone(),
            item_name: item_name.clone(),
            local_ipm: *output_ipm,
            sources,
        });
    }
    out.sort_by(|a, b| a.item_name.to_lowercase().cmp(&b.item_name.to_lowercase()));
    graph.existing_producers = out;
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
    result.remaining_ipm = spare_ipm(
        export_slice_ipm(Some(new_export_ipm), new_target_ipm),
        drawn,
    );
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
/// Items nothing reaches by either route are left out — offering a
/// product that can never be planned is worse than not listing it.
#[tauri::command]
pub fn list_item_tiers(game_data: State<GameData>) -> Vec<super::dto::ItemTier> {
    list_item_tiers_impl(&game_data)
}

fn list_item_tiers_impl(game_data: &GameData) -> Vec<super::dto::ItemTier> {
    let with_alts =
        tier::item_tier_table(game_data, tier::AltMode::On, tier::Sourcing::Automated);
    let standard_only =
        tier::item_tier_table(game_data, tier::AltMode::Off, tier::Sourcing::Automated);
    let hand_gathered =
        tier::item_tier_table(game_data, tier::AltMode::On, tier::Sourcing::HandGathered);
    let mut out: Vec<super::dto::ItemTier> = game_data
        .items()
        .iter()
        .filter_map(|item| {
            let tier = with_alts.get(&item.id).copied().flatten();
            let standard_tier = standard_only.get(&item.id).copied().flatten();
            let hand = hand_gathered.get(&item.id).copied().flatten();
            // A row exists as long as *some* route reaches the item.
            // The burner fuels have only the hand-gathered one.
            if tier.is_none() && hand.is_none() {
                return None;
            }
            Some(super::dto::ItemTier {
                item_id: item.id.clone(),
                tier,
                standard_tier,
                hand_gathered_tier: if hand == tier { None } else { hand },
            })
        })
        .collect();
    out.sort_by(|a, b| a.item_id.cmp(&b.item_id));
    out
}

/// What a factory's plan would look like re-solved from scratch at the
/// current tier, next to what it is now. `None` when the factory has no
/// saved plan, or when the fresh solve lands on the same recipes.
fn replan_offer_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
    factory: &Factory,
) -> AppResult<Option<super::dto::ReplanOffer>> {
    let plan = plan_get_impl(db, &factory.id)?;
    if plan.targets.is_empty() {
        return Ok(None);
    }
    let Some(Ok(current)) = saved_plan_graph(db, game_data, &factory.id)? else {
        // A plan that no longer computes has a finding of its own; the
        // last thing it needs is a second card offering to redesign it.
        return Ok(None);
    };

    let ctx = gather_plan_context(db, game_data, &factory.id)?;
    let export_capacity = gather_export_capacity(db, game_data, &factory.id)?;
    let imports: Vec<super::dto::PlanImportSpec> = plan
        .imports
        .iter()
        .map(|i| super::dto::PlanImportSpec {
            item_id: i.item_id.clone(),
            source_factory_id: i.source_factory_id.clone(),
            ipm_cap: i.ipm_cap,
        })
        .collect();
    // Empty overrides is exactly the payload the designer's Re-optimize
    // sends, so the offer can't promise a plan that button wouldn't
    // produce.
    let Ok(mut fresh) = compute_plan_graph(
        &factory.id,
        &plan.targets,
        &ctx.alts,
        Some(ctx.current_tier),
        &ctx.supply,
        &imports,
        &Default::default(),
        &export_capacity,
        &super::dto::PlanComputeOptions {
            include_sam: plan.include_sam,
            ..Default::default()
        },
        game_data,
    ) else {
        return Ok(None);
    };
    add_bound_extractor_power(
        &mut fresh,
        &factory.id,
        &ctx.claims,
        &ctx.water_groups,
        game_data,
    );

    let recipe_by_item = |graph: &super::dto::PlanGraph| -> std::collections::HashMap<String, String> {
        graph
            .nodes
            .iter()
            .filter_map(|n| match n {
                PlanNode::Recipe { item_id, recipe_id, .. } => {
                    Some((item_id.clone(), recipe_id.clone()))
                }
                _ => None,
            })
            .collect()
    };
    let now_recipes = recipe_by_item(&current);
    let next_recipes = recipe_by_item(&fresh);
    let name_of = |recipe_id: &str| {
        game_data
            .recipe(recipe_id)
            .map(|r| r.name.clone())
            .unwrap_or_else(|| recipe_id.to_string())
    };

    let mut swaps: Vec<super::dto::RecipeSwap> = next_recipes
        .iter()
        .filter_map(|(item_id, to_recipe_id)| {
            let from_recipe_id = now_recipes.get(item_id)?;
            if from_recipe_id == to_recipe_id {
                return None;
            }
            Some(super::dto::RecipeSwap {
                item_name: game_data
                    .item(item_id)
                    .map(|i| i.name.clone())
                    .unwrap_or_else(|| item_id.clone()),
                item_id: item_id.clone(),
                from_recipe_name: name_of(from_recipe_id),
                from_recipe_id: from_recipe_id.clone(),
                to_recipe_name: name_of(to_recipe_id),
                to_is_alt: game_data.recipe(to_recipe_id).is_some_and(|r| r.is_alt),
                to_recipe_id: to_recipe_id.clone(),
            })
        })
        .collect();
    // A step that only exists on one side is a whole line appearing or
    // disappearing, which the machine and power totals already carry.
    // Listing it as a swap would need a recipe name for a side that has
    // none.
    swaps.sort_by(|a, b| a.item_name.cmp(&b.item_name));
    if swaps.is_empty() {
        return Ok(None);
    }

    Ok(Some(super::dto::ReplanOffer {
        factory_id: factory.id.clone(),
        factory_name: factory.name.clone(),
        current_machines: current.total_machines,
        current_power_mw: current.total_power_mw,
        reoptimized_machines: fresh.total_machines,
        reoptimized_power_mw: fresh.total_power_mw,
        swaps,
    }))
}

/// Every factory whose plan would change if it were re-optimized at the
/// current tier — the "3 factories could be cheaper, review?" offer.
///
/// Read-only on purpose. Saved plans hold their recipes (see
/// `plan_save_impl`), so nothing here applies anything; the player
/// picks which factories to redesign, if any.
#[tauri::command]
pub fn list_replan_offers(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
) -> AppResult<Vec<super::dto::ReplanOffer>> {
    let db = require_active(&active)?;
    let factories = db.with(|c| factory_repo::factory_list(c).map_err(AppError::from))?;
    let mut offers = Vec::new();
    for factory in factories {
        if let Some(offer) = replan_offer_impl(&db, &game_data, &factory)? {
            offers.push(offer);
        }
    }
    Ok(offers)
}

/// Re-save a factory's plan against a given set of recipe choices,
/// keeping its targets, imports and SAM toggle exactly as they are.
///
/// Both directions of a re-optimize run through here: an empty map is
/// the re-solve itself, and the map a re-solve dropped is its undo.
/// Sharing the path is what makes the undo faithful — anything that
/// rebuilt the plan another way could land the player somewhere they
/// have never been.
fn plan_resave_with_recipes_impl(
    db: &PlaythroughDb,
    game_data: &GameData,
    factory_id: String,
    recipe_overrides: std::collections::HashMap<String, String>,
) -> AppResult<(SavePlanResult, std::collections::HashMap<String, String>)> {
    let plan = plan_get_impl(db, &factory_id)?;
    let previous_recipes = plan.recipe_overrides;
    let saved = plan_save_impl(
        db,
        game_data,
        SavePlanInput {
            factory_id,
            targets: plan.targets,
            imports: plan
                .imports
                .iter()
                .map(|i| super::dto::PlanImportSpec {
                    item_id: i.item_id.clone(),
                    source_factory_id: i.source_factory_id.clone(),
                    ipm_cap: i.ipm_cap,
                })
                .collect(),
            recipe_overrides,
            options: super::dto::PlanComputeOptions {
                include_sam: plan.include_sam,
                ..Default::default()
            },
        },
        &now_iso(),
    )?;
    Ok((saved, previous_recipes))
}

/// Take the offer for one factory: re-solve its saved targets and
/// imports with the recipe choices dropped, and materialize the result.
/// The same thing the designer's Re-optimize does, reachable from the
/// screen that told the player it was worth doing — and, like the
/// designer's, undoable, which is what `dropped_recipes` carries.
#[tauri::command]
pub fn factory_plan_reoptimize(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    factory_id: String,
) -> AppResult<super::dto::ReoptimizeResult> {
    let db = require_active(&active)?;
    let (saved, dropped_recipes) =
        plan_resave_with_recipes_impl(&db, &game_data, factory_id, Default::default())?;
    Ok(super::dto::ReoptimizeResult {
        saved,
        dropped_recipes,
    })
}

/// Put back the recipe choices a re-optimize dropped — the undo half of
/// `factory_plan_reoptimize`.
#[tauri::command]
pub fn factory_plan_restore_recipes(
    active: State<ActivePlaythrough>,
    game_data: State<GameData>,
    factory_id: String,
    recipe_overrides: std::collections::HashMap<String, String>,
) -> AppResult<SavePlanResult> {
    let db = require_active(&active)?;
    let (saved, _) = plan_resave_with_recipes_impl(&db, &game_data, factory_id, recipe_overrides)?;
    Ok(saved)
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

    // ---------- build-sheet stability ----------

    /// Screws at 60/min: one Constructor on `Recipe_Screw_C` at tier 0,
    /// and `Recipe_Alternate_Screw_C` (Cast Screws, tier 1) is the
    /// cheaper choice the moment the playthrough reaches tier 1.
    fn screw_target() -> Vec<PlanTargetSpec> {
        vec![PlanTargetSpec { item_id: "Desc_IronScrew_C".into(), ipm: 60.0, export_ipm: None }]
    }

    /// Which recipe each of a factory's materialized machines runs.
    fn machine_recipes(db: &PlaythroughDb, factory_id: &str) -> Vec<String> {
        let mut ids: Vec<String> = db
            .with(|c| factory_repo::machines_for_factory(c, factory_id))
            .expect("read machines")
            .into_iter()
            .map(|m| m.recipe_id)
            .collect();
        ids.sort();
        ids
    }

    /// Re-save a factory's plan exactly as the app's own non-designer
    /// save paths do — read the persisted plan back, hand it straight to
    /// the save. `raise_export_target` and `assign_import_source` both
    /// do this to a factory the player isn't looking at.
    fn resave_persisted_plan(db: &PlaythroughDb, gd: &GameData, factory_id: &str) {
        let plan = plan_get_impl(db, factory_id).expect("plan exists");
        plan_save_impl(
            db,
            gd,
            SavePlanInput {
                factory_id: factory_id.to_string(),
                targets: plan.targets,
                imports: plan
                    .imports
                    .iter()
                    .map(|i| PlanImportSpec {
                        item_id: i.item_id.clone(),
                        source_factory_id: i.source_factory_id.clone(),
                        ipm_cap: i.ipm_cap,
                    })
                    .collect(),
                recipe_overrides: plan.recipe_overrides,
                options: Default::default(),
            },
            NOW,
        )
        .expect("re-save must succeed");
    }

    #[test]
    fn a_tier_bump_must_not_rewrite_a_factory_that_is_already_built() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");

        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");
        let as_built = machine_recipes(&db, "iron-works");
        assert_eq!(
            as_built,
            vec![
                "Recipe_IngotIron_C".to_string(),
                "Recipe_IronRod_C".to_string(),
                "Recipe_Screw_C".to_string(),
            ],
            "tier 0 has no alt to reach, so ore → ingot → rod → screws is what gets built"
        );

        // Reaching tier 1 widens the recipe set the solver may choose
        // from. The machines are already placed in the game by then.
        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        resave_persisted_plan(&db, &gd, "iron-works");

        assert_eq!(
            machine_recipes(&db, "iron-works"),
            as_built,
            "a save the player didn't ask for must reproduce the build sheet they built, \
             not redesign it against recipes that became available since"
        );
    }

    /// Put a factory back into the shape every plan saved before the
    /// recipe of each step was recorded is in on disk: targets, imports
    /// and materialized machines all present, the recipe table empty
    /// except for anything the player pinned by hand.
    fn strip_to_legacy_shape(db: &PlaythroughDb, factory_id: &str) {
        db.with(|c| {
            c.execute(
                "DELETE FROM factory_plan_recipe WHERE factory_id = ?",
                [factory_id],
            )
        })
        .expect("clear recorded recipes");
    }

    /// The recipe choices a plan reads back, as a sorted whole.
    fn plan_recipe_pairs(db: &PlaythroughDb, factory_id: &str) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> = plan_get_impl(db, factory_id)
            .expect("plan exists")
            .recipe_overrides
            .into_iter()
            .collect();
        pairs.sort();
        pairs
    }

    #[test]
    fn a_plan_saved_before_recipes_were_recorded_must_not_be_rewritten_either() {
        // The stability test above saves with the current code, so its
        // factory always has a full set of recorded recipes and never
        // enters the state every playthrough on disk is actually in.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");

        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");
        let as_built = machine_recipes(&db, "iron-works");
        strip_to_legacy_shape(&db, "iron-works");

        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        resave_persisted_plan(&db, &gd, "iron-works");

        assert_eq!(
            machine_recipes(&db, "iron-works"),
            as_built,
            "a plan whose recipes were never recorded is still a build sheet the player \
             has standing in the game, and a save nobody asked for must reproduce it"
        );
    }

    #[test]
    fn a_legacy_plan_reads_its_recipes_back_off_the_machines_it_built() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");
        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");

        let as_recorded = plan_recipe_pairs(&db, "iron-works");
        strip_to_legacy_shape(&db, "iron-works");

        assert_eq!(
            plan_recipe_pairs(&db, "iron-works"),
            as_recorded,
            "the whole choice set has to come back, not a subset — a step left without one \
             is a step the next solve is free to redesign"
        );
        assert_eq!(
            as_recorded,
            vec![
                ("Desc_IronIngot_C".to_string(), "Recipe_IngotIron_C".to_string()),
                ("Desc_IronRod_C".to_string(), "Recipe_IronRod_C".to_string()),
                ("Desc_IronScrew_C".to_string(), "Recipe_Screw_C".to_string()),
            ],
            "positive control: the recorded set is the tier 0 screw chain and nothing else, \
             so the comparison above is against a set with something in it"
        );
    }

    #[test]
    fn a_legacy_plan_still_gets_told_a_better_one_exists() {
        // The Home offer card diffs the saved plan against a fresh
        // solve. With nothing recorded, both sides were the fresh
        // solve, so the one plan a tier bump is about to rewrite was
        // also the one nothing warned about.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");
        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");
        strip_to_legacy_shape(&db, "iron-works");

        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        let found = offers(&db, &gd);

        assert_eq!(found.len(), 1);
        let swapped: Vec<(&str, &str)> = found[0]
            .swaps
            .iter()
            .map(|s| (s.from_recipe_id.as_str(), s.to_recipe_id.as_str()))
            .collect();
        assert_eq!(
            swapped,
            vec![("Recipe_Screw_C", "Recipe_Alternate_Screw_C")],
            "the whole diff is the screw line, and it names both sides"
        );
    }

    #[test]
    fn a_hand_placed_machine_is_never_read_back_as_a_plan_choice() {
        // A manual Iron Rod bank survives plan saves untouched and is
        // nobody's plan step. Pinning its recipe would hand the solver a
        // choice the player never made — and on a factory that imports
        // rods, would force it to build them.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "cables", "Cables v1");
        plan_save_impl(&db, &gd, save_input("cables", cable_target(), vec![]), NOW)
            .expect("save at tier 0");
        let plan_only = plan_recipe_pairs(&db, "cables");

        insert_manual_rod_bank(&db, "cables");
        strip_to_legacy_shape(&db, "cables");

        assert_eq!(
            plan_recipe_pairs(&db, "cables"),
            plan_only,
            "the read-back set must be exactly the plan's own steps"
        );
        assert!(
            !plan_only.iter().any(|(item, _)| item == "Desc_IronRod_C"),
            "positive control: cables never make rods, so the manual bank's item is one the \
             plan's own set can't contain on its own"
        );
    }

    #[test]
    fn a_plan_whose_machines_are_gone_reads_back_no_choices() {
        // Targets with nothing materialized against them: a plan whose
        // every product arrives by import, or a factory torn down
        // outside the designer. There's no standing build sheet to
        // protect, so re-solving it fresh is right — what must not
        // happen is a crash or a half-filled set.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");
        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");

        strip_to_legacy_shape(&db, "iron-works");
        db.with(|c| plan_repo::plan_machines_delete(c, "iron-works"))
            .expect("tear the machines down");

        let plan = plan_get_impl(&db, "iron-works").expect("plan still loads");
        assert_eq!(plan.recipe_overrides.len(), 0);
        assert_eq!(plan.targets.len(), 1, "the plan itself is still there");

        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        resave_persisted_plan(&db, &gd, "iron-works");
        assert_eq!(
            machine_recipes(&db, "iron-works"),
            vec![
                "Recipe_Alternate_Screw_C".to_string(),
                "Recipe_IngotIron_C".to_string(),
            ],
            "with nothing built there is nothing to reproduce, so the solver takes the \
             better tier 1 chain"
        );
    }

    #[test]
    fn collecting_alts_never_changes_a_plan() {
        // The Alts checklist is an inventory of hard drives, not an
        // input to the solver — plans are computed against every alt
        // *reachable* at the current tier, and an uncollected one comes
        // back as a shopping-list note on the graph instead. Pinned here
        // because "unlocking an alt re-planned my factory" is the
        // obvious-looking explanation for a rewrite this code can't
        // produce, and chasing it costs a session.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        insert_test_factory(&db, "iron-works", "Iron Works");

        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 1");
        let before = machine_recipes(&db, "iron-works");

        let every_alt: Vec<String> = gd
            .recipes()
            .iter()
            .filter(|r| r.is_alt)
            .map(|r| r.id.clone())
            .collect();
        db.with(|c| alts_repo::alt_set_many(c, &every_alt, true, NOW))
            .expect("collect every alt");
        resave_persisted_plan(&db, &gd, "iron-works");

        assert_eq!(machine_recipes(&db, "iron-works"), before);
    }

    #[test]
    fn a_plan_first_saved_at_a_higher_tier_takes_the_better_recipe() {
        // Positive control for the stability test above: freezing a
        // built factory's choices must not stop the solver reaching for
        // the cheaper recipe when there is no build sheet to protect.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        insert_test_factory(&db, "iron-works", "Iron Works");

        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 1");

        assert_eq!(
            machine_recipes(&db, "iron-works"),
            vec![
                "Recipe_Alternate_Screw_C".to_string(),
                "Recipe_IngotIron_C".to_string(),
            ],
            "Cast Screws is reachable at tier 1, cheaper, and drops the rod line entirely, \
             so a fresh plan must pick it"
        );
    }

    #[test]
    fn re_optimize_adopts_the_recipes_a_new_tier_opened_up() {
        // The designer's Re-optimize button clears the recipe pins and
        // saves. That's the consent the stability rule holds out for, so
        // it has to actually land the better plan.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");
        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");
        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");

        // `save_input` submits no recipe overrides — the same payload
        // the designer sends after dropping the pins.
        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("re-optimize save");

        assert_eq!(
            machine_recipes(&db, "iron-works"),
            vec![
                "Recipe_Alternate_Screw_C".to_string(),
                "Recipe_IngotIron_C".to_string(),
            ],
        );
    }

    fn offers(db: &PlaythroughDb, gd: &GameData) -> Vec<super::super::dto::ReplanOffer> {
        let factories = db.with(|c| factory_repo::factory_list(c)).expect("list");
        factories
            .iter()
            .filter_map(|f| replan_offer_impl(db, gd, f).expect("offer"))
            .collect()
    }

    #[test]
    fn a_tier_bump_offers_the_better_plan_instead_of_taking_it() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");
        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");
        assert!(
            offers(&db, &gd).is_empty(),
            "a plan saved at the tier it's read at has nothing to offer"
        );

        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        let found = offers(&db, &gd);

        assert_eq!(found.len(), 1);
        let offer = &found[0];
        assert_eq!(offer.factory_name, "Iron Works");
        assert!(
            offer.reoptimized_power_mw < offer.current_power_mw,
            "the offer has to carry both sides: {} MW now vs {} MW re-optimized",
            offer.current_power_mw,
            offer.reoptimized_power_mw,
        );
        let screws = offer
            .swaps
            .iter()
            .find(|s| s.item_id == "Desc_IronScrew_C")
            .expect("the screw line is what changes");
        assert_eq!(screws.from_recipe_id, "Recipe_Screw_C");
        assert_eq!(screws.to_recipe_id, "Recipe_Alternate_Screw_C");
        assert!(screws.to_is_alt);

        // The offer is an offer: nothing is written until it's taken.
        assert_eq!(
            machine_recipes(&db, "iron-works"),
            vec![
                "Recipe_IngotIron_C".to_string(),
                "Recipe_IronRod_C".to_string(),
                "Recipe_Screw_C".to_string(),
            ],
        );
    }

    #[test]
    fn taking_the_offer_lands_the_plan_it_advertised() {
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");
        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");
        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        let offer = offers(&db, &gd).remove(0);

        // What `factory_plan_reoptimize` does, minus the Tauri state.
        let plan = plan_get_impl(&db, "iron-works").unwrap();
        let saved = plan_save_impl(
            &db,
            &gd,
            SavePlanInput {
                factory_id: "iron-works".into(),
                targets: plan.targets,
                imports: vec![],
                recipe_overrides: Default::default(),
                options: Default::default(),
            },
            NOW,
        )
        .expect("re-optimize");

        assert_eq!(saved.graph.total_machines, offer.reoptimized_machines);
        assert_eq!(saved.graph.total_power_mw, offer.reoptimized_power_mw);
        assert_eq!(
            machine_recipes(&db, "iron-works"),
            vec![
                "Recipe_Alternate_Screw_C".to_string(),
                "Recipe_IngotIron_C".to_string(),
            ],
        );
        assert!(
            offers(&db, &gd).is_empty(),
            "the offer has to retire once it's been taken"
        );
    }

    #[test]
    fn a_taken_offer_can_be_put_back_exactly_as_it_stood() {
        // The offer rebuilds machines and links for a factory that may
        // already be standing in the game, so the recipes it drops are
        // the only way back. Restoring them has to land the original
        // build sheet, not merely something that solves.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "iron-works", "Iron Works");
        plan_save_impl(&db, &gd, save_input("iron-works", screw_target(), vec![]), NOW)
            .expect("save at tier 0");
        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 1))
            .expect("advance tier");
        let before = machine_recipes(&db, "iron-works");

        let (_, dropped) =
            plan_resave_with_recipes_impl(&db, &gd, "iron-works".into(), Default::default())
                .expect("take the offer");
        assert_ne!(
            machine_recipes(&db, "iron-works"),
            before,
            "positive control: the re-solve has to have actually changed the plan"
        );
        assert_eq!(
            dropped.get("Desc_IronScrew_C").map(String::as_str),
            Some("Recipe_Screw_C"),
            "the undo payload has to name the recipe the plan was built on"
        );

        plan_resave_with_recipes_impl(&db, &gd, "iron-works".into(), dropped)
            .expect("undo the offer");

        assert_eq!(machine_recipes(&db, "iron-works"), before);
        assert_eq!(
            offers(&db, &gd).len(),
            1,
            "and the offer comes back, because the plan it was made against is back"
        );
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

        // An automated item says nothing about hand gathering — the
        // field is there to be read, not to repeat `tier`.
        assert_eq!(iron_plate.hand_gathered_tier, None);

        // The Biomass Burner's fuels: no belt reaches them, so they
        // carry a hand-gathered tier and no automated one.
        let wood = by_id["Desc_Wood_C"];
        assert_eq!(wood.tier, None);
        assert_eq!(wood.hand_gathered_tier, Some(0));
        let biofuel = by_id["Desc_Biofuel_C"];
        assert_eq!(biofuel.tier, None);
        assert_eq!(biofuel.hand_gathered_tier, Some(2));

        // Items nothing reaches by either route are left out rather
        // than offered and then rejected by the planner.
        assert!(
            !tiers.iter().any(|t| t.tier.is_none() && t.hand_gathered_tier.is_none()),
            "an item with no reachable chain must not be listed"
        );

        // The row count is pinned, not just the four items above. This
        // list decides what a picker offers, it moved 135 → 152 when
        // hand-gathered rows started being emitted, and a
        // spot-check-only test would have said nothing at 200. If this
        // moves, read the diff and decide whether the new rows belong.
        assert_eq!(
            tiers.len(),
            152,
            "every item with an automated or hand-gathered route, and nothing else"
        );
        assert_eq!(gd.items().len(), 168, "16 items reach the player by no route at all");
        assert!(
            !by_id.contains_key("Desc_Gift_C"),
            "a FICSMAS drop is reachable by no route a playthrough can count on"
        );
    }

    #[test]
    fn item_tiers_put_a_raw_resource_on_its_extractors_tier() {
        // Three of the nine products a Tier 0 picker offered were raw
        // fluids seeded at Tier 0 because *something* extracts them,
        // never mind that the extractor is five tiers out.
        let gd = GameData::from_bundled().unwrap();
        let tiers = list_item_tiers_impl(&gd);
        let tier_of = |item_id: &str| {
            tiers.iter().find(|t| t.item_id == item_id).and_then(|t| t.tier)
        };
        assert_eq!(tier_of("Desc_Water_C"), Some(3));
        assert_eq!(tier_of("Desc_LiquidOil_C"), Some(5));
        assert_eq!(tier_of("Desc_NitrogenGas_C"), Some(8));
        assert_eq!(tier_of("Desc_OreIron_C"), Some(0), "a Miner Mk1 is Tier 0");
    }

    #[test]
    fn tier_0_offers_exactly_the_eight_products_tier_0_can_build() {
        // #115's subject, pinned as a set. The picker reads this
        // command's `tier` and drops `category: "raw"`
        // (`UNPRODUCIBLE_CATEGORIES` in `planner/options.ts`), so this
        // mirrors that filter against the real dataset — the tier
        // table and the JSON category in one assertion, which is where
        // both of this batch's regressions lived.
        let gd = GameData::from_bundled().unwrap();
        let tiers = list_item_tiers_impl(&gd);
        let mut offered: Vec<&str> = tiers
            .iter()
            .filter(|t| t.tier == Some(0))
            .filter_map(|t| gd.item(&t.item_id))
            .filter(|item| item.category != crate::shared::gamedata::types::ItemCategory::Raw)
            .map(|item| item.name.as_str())
            .collect();
        offered.sort_unstable();
        assert_eq!(
            offered,
            [
                "Cable",
                "Concrete",
                "Copper Ingot",
                "Iron Ingot",
                "Iron Plate",
                "Iron Rod",
                "Screws",
                "Wire",
            ],
            "Crude Oil, Water and Nitrogen Gas are raw and five tiers out; \
             nothing hand-gathered has an automated tier"
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

    /// A re-optimize and its Undo are both plan saves, so the promise
    /// the Undo makes is only as good as what a save leaves alone. What
    /// the player decided about a route that is still in the plan —
    /// how it's carried, the plan under it, the note beside it, the
    /// train it rides — is not the solver's to restate.
    #[test]
    fn reoptimize_and_its_undo_leave_a_configured_link_as_the_player_set_it() {
        use crate::features::trains::repo as trains_repo;

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
        let saved =
            plan_save_impl(&db, &gd, save_input("fac-cables", cable_target(), sourced), NOW)
                .unwrap();
        let link_id = saved.link_ids[0].clone();

        db.with(|c| {
            logistics_repo::link_update(
                c,
                &link_id,
                120.0,
                "train",
                r#"{"freightCars":2}"#,
                Some(750),
                Some("north line, shares the ore run"),
                NOW,
            )?;
            trains_repo::route_insert(c, "route-1", "North line", 2, 0, None, None, None, NOW)?;
            trains_repo::stops_replace(c, "route-1", &["fac-wire".into(), "fac-cables".into()])?;
            trains_repo::link_attach(c, &link_id, "route-1")
        })
        .unwrap();

        let assert_as_the_player_set_it = |stage: &str| {
            let link = db
                .with(|c| logistics_repo::link_get(c, &link_id))
                .unwrap()
                .unwrap_or_else(|| panic!("{stage}: the configured link is gone"));
            assert_eq!(link.transport_kind, "train", "{stage}: transport kind");
            assert_eq!(
                link.transport_plan_json, r#"{"freightCars":2}"#,
                "{stage}: transport plan"
            );
            assert_eq!(
                link.notes.as_deref(),
                Some("north line, shares the ore run"),
                "{stage}: notes"
            );
            // Neither factory is on the map, so there's no measurement
            // to replace the player's figure with.
            assert_eq!(link.distance_m, Some(750), "{stage}: distance");
            assert_eq!(
                db.with(|c| trains_repo::link_ids_for_route(c, "route-1")).unwrap(),
                vec![link_id.clone()],
                "{stage}: the train attachment hangs off the link id"
            );
        };

        // Re-optimize: drop every recorded recipe and re-solve.
        let (_, dropped) =
            plan_resave_with_recipes_impl(&db, &gd, "fac-cables".into(), Default::default())
                .unwrap();
        assert_as_the_player_set_it("after re-optimize");

        // ...and the Undo beside it.
        plan_resave_with_recipes_impl(&db, &gd, "fac-cables".into(), dropped).unwrap();
        assert_as_the_player_set_it("after undo");
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

        let capacity = gather_export_capacity(&db, &gd, "fac-consumer").unwrap();
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
        let capacity = gather_export_capacity(&db, &gd, "fac-cables").unwrap();
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

    // ---------- surplus exports, uncollected alts, existing producers ----------

    /// A bank the plan never asked for — one Constructor turning ingots
    /// into 15 rods/min that nothing downstream consumes. The realistic
    /// shape of an intermediate with genuine surplus.
    fn insert_manual_rod_bank(db: &PlaythroughDb, factory_id: &str) {
        db.with(|c| {
            factory_repo::machine_insert(
                c,
                "machine-rods",
                factory_id,
                "Build_ConstructorMk1_C",
                "Recipe_IronRod_C",
                1,
                100.0,
                false,
                0,
                0,
                None,
                NOW,
            )
        })
        .expect("insert manual rod bank");
    }

    #[test]
    fn a_factory_that_makes_an_item_without_a_target_for_it_is_still_offered() {
        // #100 made a producer discoverable when the item was a plan
        // target. Intermediates are the larger set — nearly every plan
        // makes several on the way to what it was told to build — and
        // they were a dead end, because the Sources panel only ever
        // looked at targets.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-rods", "Rod shop");
        insert_manual_rod_bank(&db, "fac-rods");

        let offers = export_offers_impl(&db, &gd).unwrap();
        let rod = offers
            .iter()
            .find(|o| o.factory_id == "fac-rods")
            .and_then(|o| o.products.iter().find(|p| p.item_id == "Desc_IronRod_C"))
            .expect("the rods it actually makes must be offered");
        assert!((rod.spare_ipm - 15.0).abs() < 0.1, "spare {}", rod.spare_ipm);

        // And the offer has to be a number the solve can size an import
        // against, or the picker lists a source that delivers nothing.
        let capacity = gather_export_capacity(&db, &gd, "fac-consumer").unwrap();
        let cap = capacity
            .get(&("fac-rods".to_string(), "Desc_IronRod_C".to_string()))
            .copied()
            .unwrap_or(0.0);
        assert!((cap - 15.0).abs() < 0.1, "surplus must reach the solver, got {cap}");
    }

    #[test]
    fn an_intermediate_its_own_factory_eats_is_listed_with_nothing_spare() {
        // The honest half, and the distinction that matters: "makes it,
        // none spare" and "nobody makes it" are different answers, and
        // hiding the first makes it indistinguishable from the second.
        // The screw line consumes every rod it makes, so the row's spare
        // is zero — taking any of it needs that factory to grow, which
        // is a target change and `raise_export_target`'s refusal, not
        // this. Same shape as a target with `remaining_ipm == 0`, which
        // has always kept its row.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        insert_test_factory(&db, "fac-screws", "Screw works");
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-screws",
                vec![PlanTargetSpec {
                    item_id: "Desc_IronScrew_C".into(),
                    ipm: 40.0,
                    export_ipm: None,
                }],
                vec![],
            ),
            NOW,
        )
        .unwrap();

        let offers = export_offers_impl(&db, &gd).unwrap();
        let screw_works = offers
            .iter()
            .find(|o| o.factory_id == "fac-screws")
            .expect("the factory has products to offer");
        // Ingots, not rods: the rod line's clock lands a ten-thousandth
        // of an ipm above its own draw, so it has a hair of "spare" by
        // accident and would pass this test either way. The ingot line
        // balances exactly, which is the case that was being hidden.
        let ingot = screw_works
            .products
            .iter()
            .find(|p| p.item_id == "Desc_IronIngot_C")
            .expect("it makes ingots, so it is listed as an ingot producer");
        assert!(
            ingot.spare_ipm < super::super::domain::REPORTABLE_IPM,
            "and honestly: {} spare",
            ingot.spare_ipm
        );

        // The other side of the same coin — an item nothing in this
        // factory produces must still be absent, or "listed" stops
        // carrying any information at all. Nothing here makes Copper
        // Ingot, and its ore isn't a product either.
        assert!(
            screw_works.products.iter().all(|p| p.item_id != "Desc_CopperIngot_C"),
            "a factory that doesn't make it is not a source: {:?}",
            screw_works.products.iter().map(|p| &p.item_id).collect::<Vec<_>>()
        );
        assert!(
            screw_works.products.iter().all(|p| p.item_id != "Desc_OreIron_C"),
            "an item it only consumes is not a source either"
        );
    }

    #[test]
    fn an_offer_says_whether_a_raise_is_even_possible_on_it() {
        // `raise_export_target` refuses without a plan target, so a UI
        // that offers a raise on an intermediate offers a button whose
        // only outcome is an error. The rates can't be used to tell them
        // apart: a *partial*-surplus intermediate — some spare, less
        // than the asker needs — has exactly the shape of a small
        // target, which is the case a rate-based guess gets wrong.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();

        // A target: 100/min of wire, none of it consumed here.
        insert_test_factory(&db, "fac-wire", "Wire farm");
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
                vec![],
            ),
            NOW,
        )
        .unwrap();

        // An intermediate with real spare: a manual Constructor makes
        // 15 rods/min beside a screw plan that builds its own rod line,
        // so those 15 are genuinely free — and no target names them.
        // The asker below wants 20, so the panel is in exactly the state
        // that offers a raise: a source that helps but doesn't cover it.
        insert_test_factory(&db, "fac-mixed", "Rod and screw works");
        insert_manual_rod_bank(&db, "fac-mixed");
        plan_save_impl(
            &db,
            &gd,
            save_input(
                "fac-mixed",
                vec![PlanTargetSpec {
                    item_id: "Desc_IronScrew_C".into(),
                    ipm: 40.0,
                    export_ipm: None,
                }],
                vec![],
            ),
            NOW,
        )
        .unwrap();

        let offers = export_offers_impl(&db, &gd).unwrap();
        let product = |fid: &str, item: &str| {
            offers
                .iter()
                .find(|o| o.factory_id == fid)
                .and_then(|o| o.products.iter().find(|p| p.item_id == item))
                .unwrap_or_else(|| panic!("{fid} must offer {item}"))
        };

        let wire = product("fac-wire", "Desc_Wire_C");
        assert!(wire.has_target, "a plan target can be raised");

        let rod = product("fac-mixed", "Desc_IronRod_C");
        assert!(!rod.has_target, "an intermediate cannot — a raise on it would 400");
        // The half that makes the flag necessary. Both rates are well
        // clear of zero, so this row is shaped exactly like the wire
        // target above: any signature read off the numbers alone calls
        // it a target and offers the button.
        assert!(rod.spare_ipm > 1.0, "real spare, not zero: {} spare", rod.spare_ipm);
        assert!(rod.produced_ipm > 1.0, "and a non-zero produced rate: {}", rod.produced_ipm);
        assert!(
            rod.spare_ipm < 20.0,
            "and short of the 20/min asked for below, which is what makes the panel \
             reach for a raise: {} spare",
            rod.spare_ipm
        );

        // And the refusal it protects is still there, unchanged.
        let err = raise_export_target_impl(
            &db,
            &gd,
            "fac-mixed",
            "Desc_IronRod_C",
            20.0,
            Some("fac-asker"),
            NOW,
        )
        .unwrap_err();
        assert!(
            format!("{err:?}").contains("open it and add the product first"),
            "the guard stays: {err:?}"
        );
    }

    #[test]
    fn a_plan_leaning_on_alts_nobody_scanned_says_so() {
        // A plan can be built entirely out of alternates the pioneer
        // hasn't collected and look completely buildable. "Unlocked at
        // T5" and "I have it" are different questions; only the first
        // was being asked, and Validate answered the second too late to
        // help while the recipes were being chosen.
        let db = Arc::new(open_test_db());
        let gd = GameData::from_bundled().unwrap();
        db.with(|c| crate::features::playthrough::repo::progress_set_tier(c, 9)).unwrap();
        insert_test_factory(&db, "fac-1", "Plate works");

        let alt = "Recipe_Alternate_IngotIron_C";
        let mut graph = super::super::dto::PlanGraph {
            nodes: vec![PlanNode::Recipe {
                node_key: "recipe:Desc_IronIngot_C".into(),
                item_id: "Desc_IronIngot_C".into(),
                item_name: "Iron Ingot".into(),
                recipe_id: alt.into(),
                recipe_name: "Alternate: Iron Alloy Ingot".into(),
                building_id: "Build_SmelterMk1_C".into(),
                building_name: "Smelter".into(),
                machine_count: 1,
                clock_pct: 100.0,
                power_mw: 4.0,
                output_ipm: 60.0,
                free_output_ipm: 60.0,
                is_alt: true,
                is_target: true,
                target_ipm: Some(60.0),
                inputs: vec![],
                outputs: vec![],
            }],
            ..Default::default()
        };

        let ctx = gather_plan_context(&db, &gd, "fac-1").unwrap();
        attach_uncollected_alts(&mut graph, &ctx.collected_alts, &gd);
        assert_eq!(graph.uncollected_alts.len(), 1, "{:?}", graph.uncollected_alts);

        db.with(|c| alts_repo::alt_unlock(c, alt, NOW)).unwrap();
        let ctx = gather_plan_context(&db, &gd, "fac-1").unwrap();
        attach_uncollected_alts(&mut graph, &ctx.collected_alts, &gd);
        assert!(graph.uncollected_alts.is_empty(), "scanned alts drop off the list");
    }

    #[test]
    fn a_step_somebody_else_already_makes_with_spare_is_named_on_the_graph() {
        // At Tier 9 four factories built 238 machines' worth of parts
        // three other factories already made with spare, because nothing
        // said so at the moment the local copy appeared.
        let mut graph = super::super::dto::PlanGraph {
            nodes: vec![PlanNode::Recipe {
                node_key: "recipe:Desc_IronRod_C".into(),
                item_id: "Desc_IronRod_C".into(),
                item_name: "Iron Rod".into(),
                recipe_id: "Recipe_IronRod_C".into(),
                recipe_name: "Iron Rod".into(),
                building_id: "Build_ConstructorMk1_C".into(),
                building_name: "Constructor".into(),
                machine_count: 2,
                clock_pct: 100.0,
                power_mw: 8.0,
                output_ipm: 30.0,
                free_output_ipm: 0.0,
                is_alt: false,
                is_target: false,
                target_ipm: None,
                inputs: vec![],
                outputs: vec![],
            }],
            ..Default::default()
        };
        let product = |spare: f32| super::super::dto::ExportOfferProduct {
            item_id: "Desc_IronRod_C".into(),
            item_name: "Iron Rod".into(),
            produced_ipm: spare,
            export_ipm: spare,
            drawn_ipm: 0.0,
            remaining_ipm: spare,
            spare_ipm: spare,
            has_target: false,
        };
        let offers = vec![
            super::super::dto::ExportOffer {
                factory_id: "fac-rods".into(),
                factory_name: "Rod shop".into(),
                products: vec![product(15.0)],
            },
            super::super::dto::ExportOffer {
                factory_id: "fac-more-rods".into(),
                factory_name: "Rod shop II".into(),
                products: vec![product(40.0)],
            },
            // Its own surplus is not a suggestion to import from itself.
            super::super::dto::ExportOffer {
                factory_id: "fac-self".into(),
                factory_name: "This one".into(),
                products: vec![product(99.0)],
            },
        ];
        attach_existing_producers(&mut graph, "fac-self", &offers);

        assert_eq!(graph.existing_producers.len(), 1);
        let found = &graph.existing_producers[0];
        assert_eq!(found.node_key, "recipe:Desc_IronRod_C");
        assert!((found.local_ipm - 30.0).abs() < 1e-3);
        let names: Vec<&str> =
            found.sources.iter().map(|s| s.factory_name.as_str()).collect();
        assert_eq!(names, vec!["Rod shop II", "Rod shop"], "most spare first");
    }

    #[test]
    fn an_item_this_plan_already_imports_is_not_offered_again() {
        let mut graph = super::super::dto::PlanGraph {
            nodes: vec![
                PlanNode::Recipe {
                    node_key: "recipe:Desc_IronRod_C".into(),
                    item_id: "Desc_IronRod_C".into(),
                    item_name: "Iron Rod".into(),
                    recipe_id: "Recipe_IronRod_C".into(),
                    recipe_name: "Iron Rod".into(),
                    building_id: "Build_ConstructorMk1_C".into(),
                    building_name: "Constructor".into(),
                    machine_count: 2,
                    clock_pct: 100.0,
                    power_mw: 8.0,
                    output_ipm: 30.0,
                    free_output_ipm: 0.0,
                    is_alt: false,
                    is_target: false,
                    target_ipm: None,
                    inputs: vec![],
                    outputs: vec![],
                },
                PlanNode::Import {
                    node_key: "import:Desc_IronRod_C".into(),
                    item_id: "Desc_IronRod_C".into(),
                    item_name: "Iron Rod".into(),
                    ipm: 30.0,
                    allocations: vec![],
                    unassigned_ipm: 0.0,
                },
            ],
            ..Default::default()
        };
        let offers = vec![super::super::dto::ExportOffer {
            factory_id: "fac-rods".into(),
            factory_name: "Rod shop".into(),
            products: vec![super::super::dto::ExportOfferProduct {
                item_id: "Desc_IronRod_C".into(),
                item_name: "Iron Rod".into(),
                produced_ipm: 15.0,
                export_ipm: 15.0,
                drawn_ipm: 0.0,
                remaining_ipm: 15.0,
                spare_ipm: 15.0,
                has_target: false,
            }],
        }];
        attach_existing_producers(&mut graph, "fac-self", &offers);
        assert!(
            graph.existing_producers.is_empty(),
            "the flow it would suggest is the one already there"
        );
    }

    #[test]
    fn an_offer_carries_what_the_source_actually_exports_not_just_what_it_spares() {
        // An uncapped import resolves to the export slice, never to
        // machine-side spare, so an offer that only reported spare left
        // the taker unable to tell a source it can pull from today from
        // one whose slice is still shut.
        let mut graph = super::super::dto::PlanGraph {
            nodes: vec![PlanNode::Recipe {
                node_key: "recipe:Desc_IronPlateReinforced_C".into(),
                item_id: "Desc_IronPlateReinforced_C".into(),
                item_name: "Reinforced Iron Plate".into(),
                recipe_id: "Recipe_IronPlateReinforced_C".into(),
                recipe_name: "Reinforced Iron Plate".into(),
                building_id: "Build_AssemblerMk1_C".into(),
                building_name: "Assembler".into(),
                machine_count: 1,
                clock_pct: 100.0,
                power_mw: 15.0,
                output_ipm: 5.0,
                free_output_ipm: 0.0,
                is_alt: false,
                is_target: false,
                target_ipm: None,
                inputs: vec![],
                outputs: vec![],
            }],
            ..Default::default()
        };
        let offers = vec![
            // Makes it as a product, offers none of it to anyone.
            super::super::dto::ExportOffer {
                factory_id: "fac-shut".into(),
                factory_name: "Iron Works".into(),
                products: vec![super::super::dto::ExportOfferProduct {
                    item_id: "Desc_IronPlateReinforced_C".into(),
                    item_name: "Reinforced Iron Plate".into(),
                    produced_ipm: 20.0,
                    export_ipm: 0.0,
                    drawn_ipm: 0.0,
                    remaining_ipm: 0.0,
                    spare_ipm: 5.0,
                    has_target: true,
                }],
            },
            // Same spare, already on offer.
            super::super::dto::ExportOffer {
                factory_id: "fac-open".into(),
                factory_name: "Plate Works".into(),
                products: vec![super::super::dto::ExportOfferProduct {
                    item_id: "Desc_IronPlateReinforced_C".into(),
                    item_name: "Reinforced Iron Plate".into(),
                    produced_ipm: 20.0,
                    export_ipm: 5.0,
                    drawn_ipm: 0.0,
                    remaining_ipm: 5.0,
                    spare_ipm: 5.0,
                    has_target: true,
                }],
            },
        ];
        attach_existing_producers(&mut graph, "fac-self", &offers);

        let sources = &graph.existing_producers[0].sources;
        let shut = sources.iter().find(|s| s.factory_id == "fac-shut").unwrap();
        let open = sources.iter().find(|s| s.factory_id == "fac-open").unwrap();
        assert!((shut.spare_ipm - open.spare_ipm).abs() < 1e-3, "same spare");
        assert!(shut.remaining_ipm.abs() < 1e-3, "nothing on offer yet");
        assert!((open.remaining_ipm - 5.0).abs() < 1e-3, "5/min already on offer");
        assert!(shut.has_target && open.has_target);
    }
}
