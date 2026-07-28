//! Pure throughput math for resource nodes. Kept out of `commands.rs`
//! so the planner can call it without going through Tauri state.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use crate::features::factory::domain::machine_power_mw_amp;
use crate::shared::gamedata::GameData;
use crate::shared::gamedata::types::{BeltTier, MapNode, Miner, NodeKind, NodePurity, PipeTier};

use super::dto::{ExtractorOption, PurityCount, ResourceBudget, ResourceBudgetRow};
use super::repo::{ClaimRow, WaterGroupRow};

/// Water Extractor output at 100% clock (m³/min) — game constant, the
/// open-water counterpart of the fracking 60 base below.
pub const WATER_PUMP_IPM: f32 = 120.0;

/// Oil Extractor output at 100% clock on a Normal node (m³/min).
/// Standard crude-oil seeps take exactly one of these — no miner marks;
/// purity and clock are the only knobs (60/120/240 by purity).
pub const OIL_EXTRACTOR_IPM: f32 = 120.0;

/// Resource Well Extractor output per satellite at 100% clock on a
/// Normal satellite (30/60/120 by purity).
pub const WELL_EXTRACTOR_IPM: f32 = 60.0;

/// Standard oil seeps live in the catalog as `miner_node` (that's their
/// map shape), but their extractor family is the Oil Extractor, not the
/// miner marks. This is the one resource where node kind alone doesn't
/// pick the extractor.
pub fn is_oil_node(node: &MapNode) -> bool {
    node.kind == NodeKind::MinerNode && node.resource_item_id == "Desc_LiquidOil_C"
}

/// Total m³/min a group of free-placed water extractors produces —
/// both banks summed, each `count × 120 × clock`.
pub fn water_group_output_ipm(group: &WaterGroupRow) -> f32 {
    let bank = |count: i64, clock_pct: f32| -> f32 {
        if clock_pct <= 0.0 || !clock_pct.is_finite() || count < 1 {
            return 0.0;
        }
        count as f32 * WATER_PUMP_IPM * (clock_pct / 100.0)
    };
    bank(group.count, group.clock_pct)
        + match (group.count2, group.clock2_pct) {
            (Some(c), Some(p)) => bank(c, p),
            _ => 0.0,
        }
}

/// MW a group of free-placed water extractors draws — both banks
/// summed, each on the same overclock curve as every other extractor.
pub fn water_group_power_mw(group: &WaterGroupRow, game_data: &GameData) -> f32 {
    let base_power_mw = game_data
        .building("Build_WaterPump_C")
        .map(|b| b.power_mw)
        .unwrap_or(0.0);
    let bank = |count: i64, clock_pct: f32| -> f32 {
        if clock_pct <= 0.0 || !clock_pct.is_finite() || count < 1 {
            return 0.0;
        }
        machine_power_mw_amp(base_power_mw, count, clock_pct, 0, 0)
    };
    bank(group.count, group.clock_pct)
        + match (group.count2, group.clock2_pct) {
            (Some(c), Some(p)) => bank(c, p),
            _ => 0.0,
        }
}

/// The extractor buildings a node's *family* can legally take, tier
/// aside. Single source of truth for `set_node_claim`'s family check
/// and `validation::check_claims` — they must never disagree on what
/// counts as the right building for a node. Pickers (NodeRow, map
/// popover, placement loadout) get this narrowed further by
/// `tier_eligible_extractors` before it reaches the UI.
pub fn allowed_extractors(node: &MapNode, game_data: &GameData) -> Vec<ExtractorOption> {
    // One lookup per building; the fallbacks (catalog names) only fire
    // if the dataset somehow drops the building.
    let single = |id: &str, fallback_name: &str, base_ipm: f32, fallback_tier: u8| {
        let building = game_data.building(id);
        vec![ExtractorOption {
            id: id.to_string(),
            name: building
                .map(|b| b.name.clone())
                .unwrap_or_else(|| fallback_name.to_string()),
            base_ipm,
            unlock_tier: building.map(|b| b.unlock_tier).unwrap_or(fallback_tier),
        }]
    };
    if is_oil_node(node) {
        return single("Build_OilPump_C", "Oil Extractor", OIL_EXTRACTOR_IPM, 5);
    }
    match node.kind {
        NodeKind::MinerNode => game_data
            .miners()
            .iter()
            .map(|m| ExtractorOption {
                id: m.id.clone(),
                name: game_data
                    .building(&m.id)
                    .map(|b| b.name.clone())
                    .unwrap_or_else(|| format!("Miner Mk{}", m.mark)),
                base_ipm: m.base_items_per_minute,
                unlock_tier: m.unlock_tier,
            })
            .collect(),
        NodeKind::FrackingWell => {
            // The stored id stays Build_FrackingSmasher_C — it's the
            // clocked building and what every existing claim row holds —
            // but players place a Resource Well Extractor on each
            // satellite, so the label comes from that building. Changing
            // the stored id would invalidate every saved well claim for
            // zero rate difference.
            let extractor = game_data.building("Build_FrackingExtractor_C");
            vec![ExtractorOption {
                id: "Build_FrackingSmasher_C".to_string(),
                name: extractor
                    .map(|b| b.name.clone())
                    .unwrap_or_else(|| "Resource Well Extractor".to_string()),
                base_ipm: WELL_EXTRACTOR_IPM,
                unlock_tier: extractor.map(|b| b.unlock_tier).unwrap_or(8),
            }]
        }
        NodeKind::Geyser => Vec::new(),
    }
}

/// Narrows a node's `allowed_extractors` to what a *fresh pick* should
/// offer: only marks unlocked at `tier`. This is presentation-only —
/// `set_node_claim`'s family check and `validation::check_claims` both
/// keep calling `allowed_extractors` directly (unfiltered), so an
/// existing above-tier claim is still recognised as the right building
/// family and reported as `ClaimExtractorAboveTier`, not misfiled as
/// `ClaimInvalidExtractor`. Called for every family alike — miner marks
/// and the single-option oil/well families both go through this, so a
/// well satellite's Tier 8 extractor carries the same tier-gating
/// contract a Miner Mk2 does instead of an exemption reserved for
/// families with more than one mark to choose between.
///
/// Never returns empty: the lowest-tier option survives even when
/// nothing in the family is unlocked yet, so the picker always has a
/// starting choice (mirrors `best_miner_for_tier`'s tier-0 fallback).
/// For a single-option family this means the one extractor keeps
/// showing up below its unlock tier too — there's nothing else in the
/// family to fall back to — so the picker's `unlock_tier` field is what
/// tells the UI it isn't buildable yet, not the option's presence or
/// absence in the list.
pub fn tier_eligible_extractors(options: &[ExtractorOption], tier: u8) -> Vec<ExtractorOption> {
    let eligible: Vec<ExtractorOption> =
        options.iter().filter(|e| e.unlock_tier <= tier).cloned().collect();
    if !eligible.is_empty() {
        return eligible;
    }
    let mut sorted = options.to_vec();
    sorted.sort_by_key(|e| e.unlock_tier);
    sorted.into_iter().take(1).collect()
}

/// Items-per-minute a single extractor produces on a node at the given
/// clock. Geysers produce nothing — they're for power.
///
/// Miner_node (solid ore): looks up the miner row by id, scales by
/// purity + clock.
///
/// Oil nodes: Oil Extractor math (120 base × purity × clock) for ANY
/// set extractor id — claims saved before oil nodes got their own
/// extractor family may still carry a Mk* id, and lying about the rate
/// would be worse than coercing it (warn, don't block; the row flags
/// the stale id separately).
///
/// Fracking_well: Resource Well Extractor, 60 base × purity × clock,
/// mark-independent — there's only one extractor building per well.
pub fn extractor_output_ipm(
    node: &MapNode,
    miner_building_id: Option<&str>,
    clock_pct: f32,
    game_data: &GameData,
) -> f32 {
    if clock_pct <= 0.0 || !clock_pct.is_finite() {
        return 0.0;
    }
    let clock = clock_pct / 100.0;
    let purity_mult = node.purity.multiplier();
    if is_oil_node(node) {
        // `None` still means "claimed but no extractor built yet".
        if miner_building_id.is_none() {
            return 0.0;
        }
        return OIL_EXTRACTOR_IPM * purity_mult * clock;
    }
    match node.kind {
        NodeKind::MinerNode => {
            let Some(id) = miner_building_id else { return 0.0 };
            let Some(miner) = game_data.miners().iter().find(|m| m.id == id) else {
                return 0.0;
            };
            miner.base_items_per_minute * purity_mult * clock
        }
        NodeKind::FrackingWell => WELL_EXTRACTOR_IPM * purity_mult * clock,
        NodeKind::Geyser => 0.0,
    }
}

/// Highest-capacity belt unlocked at `tier`, ranked by capacity rather
/// than by mark: mark order and capacity order agree in the current
/// dataset, and nothing guarantees they always will. Always resolves —
/// Mk1 lands at Tier 0.
pub fn best_belt_tier(tier: u8, game_data: &GameData) -> Option<&BeltTier> {
    game_data
        .belt_tiers()
        .iter()
        .filter(|t| t.unlock_tier <= tier)
        .max_by_key(|t| t.items_per_minute)
}

/// Highest-capacity pipe unlocked at `tier`. `None` below Tier 3, and
/// that `None` means "no pipe exists yet", never a capacity of zero —
/// collapsing it to `0.0` would read as "every fluid line is over
/// capacity".
pub fn best_pipe_tier(tier: u8, game_data: &GameData) -> Option<&PipeTier> {
    game_data
        .pipe_tiers()
        .iter()
        .filter(|t| t.unlock_tier <= tier)
        .max_by_key(|t| t.cubic_meters_per_minute)
}

/// What one extractor's output port can pass at `tier`.
pub struct PortCapacity {
    pub ipm: f32,
    /// Belt/pipe mark the capacity came from, for advice text.
    pub mark: u8,
    pub is_fluid: bool,
}

/// The hard ceiling on what a single extractor can deliver at `tier`:
/// its one output port is one belt (or pipe) connection, so a splitter
/// downstream can only divide what already made it through. This is the
/// **port** question, not the segment one — aggregate flow inside a
/// factory is genuinely fixed by running belts in parallel and must
/// never be capped this way.
///
/// `None` means nothing in the carrier family is unlocked yet (fluids
/// below Tier 3). Deliberately not a zero and deliberately not a
/// fallback to Mk1: with no pipe there is no cap to state and no advice
/// to give, so both this function's callers stay silent instead of
/// inventing one. `check_claim_port_capacity` and
/// `extractor_deliverable_ipm` share this resolution precisely so the
/// warning and the arithmetic can never disagree about where the
/// ceiling is.
pub fn port_capacity(node: &MapNode, tier: u8, game_data: &GameData) -> Option<PortCapacity> {
    let is_fluid = game_data
        .item(&node.resource_item_id)
        .map(|i| i.is_fluid)
        .unwrap_or(false);
    if is_fluid {
        best_pipe_tier(tier, game_data).map(|p| PortCapacity {
            ipm: p.cubic_meters_per_minute as f32,
            mark: p.mark,
            is_fluid,
        })
    } else {
        best_belt_tier(tier, game_data).map(|b| PortCapacity {
            ipm: b.items_per_minute as f32,
            mark: b.mark,
            is_fluid,
        })
    }
}

/// What one extractor actually puts on a belt: `extractor_output_ipm`
/// clamped to what its output port can carry at `tier`. Clock a miner
/// past its belt in game and it backs up, idles, and settles at belt
/// rate — so this, not the raw arithmetic, is the number a factory can
/// plan against.
///
/// **This does not replace `extractor_output_ipm`, and the two are not
/// interchangeable.** The raw figure is what the player is paying
/// hardware and power for, and it's what `check_claim_port_capacity`
/// compares against the cap to raise `ClaimOverPortCapacity`. Capping
/// in place would turn that comparison into `cap > cap`, silently
/// retiring the warning: the plan would then quietly balance on 60/min
/// while the player believes they bought 300, which is strictly worse
/// than an unbalanced plan that says so. Cap the supply, keep the
/// warning.
pub fn extractor_deliverable_ipm(
    node: &MapNode,
    miner_building_id: Option<&str>,
    clock_pct: f32,
    tier: u8,
    game_data: &GameData,
) -> f32 {
    let raw = extractor_output_ipm(node, miner_building_id, clock_pct, game_data);
    match port_capacity(node, tier, game_data) {
        Some(cap) => raw.min(cap.ipm),
        None => raw,
    }
}

/// MW a single extractor draws on `node` at the given clock. Extractors
/// overclock on the same curve as manufacturing machines (there's no
/// Somersloop slot on an extractor, so amp is always 0/0) — reuses
/// `machine_power_mw_amp` rather than a fourth power formula.
///
/// Mirrors `extractor_output_ipm`'s node-kind dispatch for oil: the Oil
/// Extractor always charges its one building regardless of what a legacy
/// claim's `miner_id` says, for the same reason the ipm side does —
/// there's only one building per family. Purity doesn't affect power,
/// only throughput, so it's absent here.
///
/// A Resource Well satellite is unpowered — only the well's shared
/// Pressuriser draws power, once per well rather than once per
/// satellite — so this always returns 0 for `FrackingWell`. Callers that
/// aggregate a factory's claimed satellites (`power_for_factory`) add
/// the Pressuriser's draw themselves, once per distinct `core_id`.
pub fn extractor_power_mw(
    node: &MapNode,
    miner_building_id: Option<&str>,
    clock_pct: f32,
    game_data: &GameData,
) -> f32 {
    if clock_pct <= 0.0 || !clock_pct.is_finite() {
        return 0.0;
    }
    let base_power_mw = if is_oil_node(node) {
        // `None` still means "claimed but no extractor built yet".
        if miner_building_id.is_none() {
            return 0.0;
        }
        game_data
            .building("Build_OilPump_C")
            .map(|b| b.power_mw)
            .unwrap_or(0.0)
    } else {
        match node.kind {
            NodeKind::MinerNode => {
                let Some(id) = miner_building_id else { return 0.0 };
                game_data.building(id).map(|b| b.power_mw).unwrap_or(0.0)
            }
            NodeKind::FrackingWell => return 0.0,
            NodeKind::Geyser => 0.0,
        }
    };
    machine_power_mw_amp(base_power_mw, 1, clock_pct, 0, 0)
}

/// Convenience for callers that just have a purity + clock + miner
/// reference (e.g. the planner picking a hypothetical Mk2 setup
/// without an actual claim row).
#[allow(dead_code)]
pub fn miner_node_ipm(
    purity: NodePurity,
    miner_base_ipm: f32,
    clock_pct: f32,
) -> f32 {
    miner_base_ipm * purity.multiplier() * (clock_pct / 100.0)
}

/// Supply pool fed into one factory by its bound claims and bound
/// water extractor groups. Used by the factory ledger's "From nodes:
/// X ipm" chip, and by the planner's per-factory raw-supply figures
/// (`gather_plan_context`) so a claim never silently feeds a factory
/// it isn't bound to.
///
/// A claim with no `factory_id` counts toward nobody, not "everybody"
/// or some default factory — crediting an unbound claim to any factory
/// would just reintroduce a global pool from a different angle, which
/// is the exact bug this function exists to prevent.
///
/// Each claim contributes its **deliverable** rate: what leaves the
/// node's single output port at `tier`, not the theoretical clock rate.
/// A plan that balanced on the raw figure balanced against ore that
/// couldn't physically reach the machines. `check_claim_port_capacity`
/// still reports the gap between the two, so an over-clock stays
/// visible rather than being silently corrected here.
///
/// Water groups are **not** port-capped: a group is a bank of N pumps,
/// each with its own port, so its total is an aggregate — and an
/// aggregate is fixed by running another pipe, which is normal play.
pub fn supply_for_factory(
    claims: &HashMap<String, ClaimRow>,
    water_groups: &[WaterGroupRow],
    factory_id: &str,
    tier: u8,
    game_data: &GameData,
) -> HashMap<String, f32> {
    let mut out: HashMap<String, f32> = HashMap::new();
    for (node_id, claim) in claims {
        if claim.factory_id.as_deref() != Some(factory_id) {
            continue;
        }
        let Some(node) = game_data.node(node_id) else {
            continue;
        };
        let ipm = extractor_deliverable_ipm(
            node,
            claim.miner_id.as_deref(),
            claim.clock_pct,
            tier,
            game_data,
        );
        if ipm <= 0.0 {
            continue;
        }
        *out.entry(node.resource_item_id.clone()).or_insert(0.0) += ipm;
    }
    for group in water_groups {
        if group.factory_id.as_deref() != Some(factory_id) {
            continue;
        }
        let ipm = water_group_output_ipm(group);
        if ipm <= 0.0 {
            continue;
        }
        *out.entry("Desc_Water_C".to_string()).or_insert(0.0) += ipm;
    }
    out
}

/// For each fracking well (keyed by `core_id`, or a satellite's own id
/// for the rare one the map data never grouped), the one factory whose
/// claimed satellite owns that well's shared Pressuriser charge.
///
/// Deterministic and independent of `HashMap` iteration order —
/// whichever active (`clock_pct > 0`), factory-bound satellite has the
/// lexicographically smallest node id wins. Any single, stable rule
/// works here; the only thing that matters is that every caller picks
/// the same one, so the charge lands on exactly one factory instead of
/// being split by iteration order or omitted entirely.
fn fracking_core_owners(
    claims: &HashMap<String, ClaimRow>,
    game_data: &GameData,
) -> HashMap<String, String> {
    // core -> (best node id seen so far, its factory)
    let mut best: HashMap<String, (String, String)> = HashMap::new();
    for (node_id, claim) in claims {
        let Some(claim_factory_id) = claim.factory_id.as_deref() else {
            continue;
        };
        if claim.clock_pct <= 0.0 || !claim.clock_pct.is_finite() {
            continue;
        }
        let Some(node) = game_data.node(node_id) else {
            continue;
        };
        if node.kind != NodeKind::FrackingWell {
            continue;
        }
        let core = node.core_id.clone().unwrap_or_else(|| node.id.clone());
        best.entry(core)
            .and_modify(|(best_node_id, best_factory)| {
                if node_id < best_node_id {
                    *best_node_id = node_id.clone();
                    *best_factory = claim_factory_id.to_string();
                }
            })
            .or_insert_with(|| (node_id.clone(), claim_factory_id.to_string()));
    }
    best.into_iter().map(|(core, (_, factory_id))| (core, factory_id)).collect()
}

/// Total MW drawn by one factory's bound extractor claims and bound
/// water extractor groups — the extractor-side counterpart to
/// `supply_for_factory`'s ipm.
///
/// `factory::commands::compose_ledger_with_supply` already calls this
/// internally and folds the result onto `power_mw`, so a caller building
/// a real `FactoryLedger` never needs to call it directly — pass the raw
/// `claims`/`water_groups` through and the total comes back correct.
/// This function stays public for the few callers that need the raw MW
/// figure without a full ledger (the planner's `PlanGraph` total).
pub fn power_for_factory(
    claims: &HashMap<String, ClaimRow>,
    water_groups: &[WaterGroupRow],
    factory_id: &str,
    game_data: &GameData,
) -> f32 {
    let mut total = 0.0_f32;
    // A well's satellites share one Pressuriser, so claiming N satellites
    // from the same well must charge its power once, not N times —
    // `extractor_power_mw` already returns 0 for a `FrackingWell` node.
    // Satellites of the same well can be bound to *different* factories
    // though, and this function only ever sees one `factory_id` at a
    // time — deduping per call still let two factories each own one
    // satellite and each charge the Pressuriser once, for two charges
    // total once `list_power_balances` sums every factory's balance.
    // `fracking_core_owners` picks one deterministic owning factory per
    // well across the *whole* claims table (not just this factory's
    // slice), so only that factory ever adds the charge.
    let well_owners = fracking_core_owners(claims, game_data);
    let mut fracking_cores_seen: HashSet<String> = HashSet::new();
    for (node_id, claim) in claims {
        if claim.factory_id.as_deref() != Some(factory_id) {
            continue;
        }
        let Some(node) = game_data.node(node_id) else {
            continue;
        };
        total += extractor_power_mw(node, claim.miner_id.as_deref(), claim.clock_pct, game_data);
        if node.kind == NodeKind::FrackingWell
            && claim.clock_pct > 0.0
            && claim.clock_pct.is_finite()
        {
            let core = node.core_id.clone().unwrap_or_else(|| node.id.clone());
            let owns_this_well = well_owners.get(&core).map(String::as_str) == Some(factory_id);
            if owns_this_well && fracking_cores_seen.insert(core) {
                total += game_data
                    .building("Build_FrackingSmasher_C")
                    .map(|b| b.power_mw)
                    .unwrap_or(0.0);
            }
        }
    }
    for group in water_groups {
        if group.factory_id.as_deref() != Some(factory_id) {
            continue;
        }
        total += water_group_power_mw(group, game_data);
    }
    total
}

// ---- Resource budget ("how much of the map is left?") ----

/// The miner/clock assumption a "max extractable" number is stated at.
/// The map's resources are finite but the ceiling depends on hardware:
/// 600 iron at Mk1s is 2400 at Mk3 250%. Every surfaced number carries
/// its assumption label so "remaining" can't read as an absolute.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetAssumption {
    /// Best miner unlocked at the playthrough's current tier, 100%.
    CurrentTierBest,
    /// Endgame baseline: Mk3 miners at 100% clock.
    Mk3At100,
    /// Absolute ceiling: Mk3 miners at 250% (belt caps out of scope).
    Mk3At250,
}

/// Highest-throughput miner unlocked at `tier`. Falls back to the
/// lowest-tier miner when nothing is unlocked yet (tier 0 play still
/// wants a non-zero budget — Mk1 is the first thing anyone builds).
pub fn best_miner_for_tier(tier: u8, game_data: &GameData) -> Option<&Miner> {
    let unlocked = game_data
        .miners()
        .iter()
        .filter(|m| m.unlock_tier <= tier)
        .max_by(|a, b| {
            a.base_items_per_minute
                .partial_cmp(&b.base_items_per_minute)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    unlocked.or_else(|| {
        game_data
            .miners()
            .iter()
            .min_by_key(|m| m.unlock_tier)
    })
}

/// Human label for the assumption ("Mk2 @ 100%"), shown next to every
/// max/remaining number so the basis is always visible.
pub fn assumption_label(
    assumption: BudgetAssumption,
    tier: u8,
    game_data: &GameData,
) -> String {
    match assumption {
        BudgetAssumption::CurrentTierBest => best_miner_for_tier(tier, game_data)
            .map(|m| format!("Mk{} @ 100%", m.mark))
            .unwrap_or_else(|| "no miner".to_string()),
        BudgetAssumption::Mk3At100 => "Mk3 @ 100%".to_string(),
        BudgetAssumption::Mk3At250 => "Mk3 @ 250%".to_string(),
    }
}

/// Max ipm one node could yield at the stated assumption.
pub fn node_max_ipm(
    node: &MapNode,
    assumption: BudgetAssumption,
    tier: u8,
    game_data: &GameData,
) -> f32 {
    let (miner_base, clock) = match assumption {
        BudgetAssumption::CurrentTierBest => (
            best_miner_for_tier(tier, game_data).map(|m| m.base_items_per_minute),
            1.0,
        ),
        BudgetAssumption::Mk3At100 => (
            game_data
                .miners()
                .iter()
                .find(|m| m.mark == 3)
                .map(|m| m.base_items_per_minute),
            1.0,
        ),
        BudgetAssumption::Mk3At250 => (
            game_data
                .miners()
                .iter()
                .find(|m| m.mark == 3)
                .map(|m| m.base_items_per_minute),
            2.5,
        ),
    };
    let purity_mult = node.purity.multiplier();
    if is_oil_node(node) {
        // One Oil Extractor per seep, mark-independent — like wells,
        // clock is the only knob the assumption moves.
        return OIL_EXTRACTOR_IPM * purity_mult * clock;
    }
    match node.kind {
        NodeKind::MinerNode => miner_base.unwrap_or(0.0) * purity_mult * clock,
        // One extractor per well satellite, mark-independent — clock is
        // the only knob the assumption moves.
        NodeKind::FrackingWell => WELL_EXTRACTOR_IPM * purity_mult * clock,
        NodeKind::Geyser => 0.0,
    }
}

/// Whole-map budget per resource: what the world can still yield at the
/// stated assumption vs what's already claimed. "Remaining" is the
/// unclaimed nodes' max — actual claim clocks don't pollute it; upgrade
/// headroom on claimed nodes shows separately via `claimed_max_ipm`.
///
/// Every figure here is the theoretical `extractor_output_ipm` /
/// `node_max_ipm` rate, **not** the port-capped deliverable one that
/// factory supply uses. Two reasons, and both matter: the assumption
/// this panel is stated at (`Mk3At250`, say) already declares belt caps
/// out of scope, and `overcommitted` compares `claimed_ipm` against
/// `world_max_ipm` — capping one side and not the other would silence
/// the flag for exactly the hot claims it exists to catch. This panel
/// answers "how much is left in the ground", which is a hardware
/// question; the port ceiling is a logistics one.
pub fn resource_budget(
    claims: &HashMap<String, ClaimRow>,
    game_data: &GameData,
    tier: u8,
    assumption: BudgetAssumption,
) -> ResourceBudget {
    let mut rows: HashMap<String, ResourceBudgetRow> = HashMap::new();

    for node in game_data.nodes() {
        let row = rows
            .entry(node.resource_item_id.clone())
            .or_insert_with(|| ResourceBudgetRow {
                resource_item_id: node.resource_item_id.clone(),
                resource_item_name: game_data
                    .item(&node.resource_item_id)
                    .map(|i| i.name.clone())
                    .unwrap_or_else(|| node.resource_item_id.clone()),
                kind: node.kind,
                world_max_ipm: 0.0,
                claimed_ipm: 0.0,
                bound_ipm: 0.0,
                claimed_max_ipm: 0.0,
                remaining_ipm: 0.0,
                pure: PurityCount::default(),
                normal: PurityCount::default(),
                impure: PurityCount::default(),
                overcommitted: false,
            });

        let max = node_max_ipm(node, assumption, tier, game_data);
        row.world_max_ipm += max;

        let claim = claims.get(&node.id);
        let counts = match node.purity {
            NodePurity::Pure => &mut row.pure,
            NodePurity::Normal => &mut row.normal,
            NodePurity::Impure => &mut row.impure,
        };
        counts.total += 1;
        if let Some(claim) = claim {
            counts.claimed += 1;
            row.claimed_max_ipm += max;
            let actual =
                extractor_output_ipm(node, claim.miner_id.as_deref(), claim.clock_pct, game_data);
            row.claimed_ipm += actual;
            if claim.factory_id.is_some() {
                row.bound_ipm += actual;
            }
        } else {
            row.remaining_ipm += max;
        }
    }

    for row in rows.values_mut() {
        // Possible when real claims run hotter than the assumption
        // (Mk3 250% claims against a Mk1 100% budget) — flagged, never
        // an error (warn, don't block).
        row.overcommitted = row.claimed_ipm > row.world_max_ipm + 1e-3;
    }

    let mut out: Vec<ResourceBudgetRow> = rows.into_values().collect();
    out.sort_by(|a, b| a.resource_item_id.cmp(&b.resource_item_id));
    ResourceBudget {
        assumption_label: assumption_label(assumption, tier, game_data),
        rows: out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::gamedata::types::{MapNode, NodeKind, NodePurity};

    fn iron_node(p: NodePurity) -> MapNode {
        MapNode {
            id: format!("iron-{:?}", p),
            resource_item_id: "Desc_OreIron_C".into(),
            purity: p,
            kind: NodeKind::MinerNode,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            core_id: None,
        }
    }

    #[test]
    fn miner_mk2_on_pure_iron_at_100_pct_yields_240_ipm() {
        let gd = GameData::from_bundled().unwrap();
        // Mk2 miners are 120 ipm at Normal; Pure doubles to 240.
        let ipm = extractor_output_ipm(
            &iron_node(NodePurity::Pure),
            Some("Build_MinerMk2_C"),
            100.0,
            &gd,
        );
        assert!((ipm - 240.0).abs() < 0.01, "got {ipm}");
    }

    #[test]
    fn miner_mk1_on_impure_iron_at_100_pct_yields_30_ipm() {
        let gd = GameData::from_bundled().unwrap();
        // Mk1 = 60 ipm on Normal; Impure halves to 30.
        let ipm = extractor_output_ipm(
            &iron_node(NodePurity::Impure),
            Some("Build_MinerMk1_C"),
            100.0,
            &gd,
        );
        assert!((ipm - 30.0).abs() < 0.01, "got {ipm}");
    }

    #[test]
    fn unclaimed_or_unset_miner_yields_zero() {
        let gd = GameData::from_bundled().unwrap();
        assert_eq!(
            extractor_output_ipm(&iron_node(NodePurity::Pure), None, 100.0, &gd),
            0.0
        );
        // Unknown miner id also resolves to zero — the catalog is the
        // source of truth, not the caller's spelling.
        assert_eq!(
            extractor_output_ipm(
                &iron_node(NodePurity::Pure),
                Some("Build_MadeUpMiner_C"),
                100.0,
                &gd,
            ),
            0.0
        );
    }

    fn oil_node(p: NodePurity) -> MapNode {
        MapNode {
            id: format!("oil-{:?}", p),
            resource_item_id: "Desc_LiquidOil_C".into(),
            purity: p,
            kind: NodeKind::MinerNode,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            core_id: None,
        }
    }

    #[test]
    fn oil_nodes_use_oil_extractor_rates_not_miner_curves() {
        let gd = GameData::from_bundled().unwrap();
        // 120 base: Impure 60, Normal 120, Pure 240 at 100% clock.
        for (purity, want) in [
            (NodePurity::Impure, 60.0),
            (NodePurity::Normal, 120.0),
            (NodePurity::Pure, 240.0),
        ] {
            let ipm = extractor_output_ipm(
                &oil_node(purity),
                Some("Build_OilPump_C"),
                100.0,
                &gd,
            );
            assert!((ipm - want).abs() < 0.01, "{purity:?}: got {ipm}, want {want}");
        }
    }

    #[test]
    fn stale_miner_claim_on_oil_node_coerces_to_oil_extractor_math() {
        let gd = GameData::from_bundled().unwrap();
        // A claim saved before oil nodes got their own extractor family
        // may carry a Mk* id — the rate must not lie. Mk1 on Normal would
        // read 60; the Oil Extractor's correct 120 proves the coercion.
        let ipm = extractor_output_ipm(
            &oil_node(NodePurity::Normal),
            Some("Build_MinerMk1_C"),
            100.0,
            &gd,
        );
        assert!((ipm - 120.0).abs() < 0.01, "got {ipm}, want oil-extractor 120");
        // Unset extractor still reads as "claimed but not built" → 0.
        assert_eq!(extractor_output_ipm(&oil_node(NodePurity::Normal), None, 100.0, &gd), 0.0);
    }

    #[test]
    fn allowed_extractors_match_node_family() {
        let gd = GameData::from_bundled().unwrap();
        let iron = allowed_extractors(&iron_node(NodePurity::Normal), &gd);
        assert_eq!(
            iron.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["Build_MinerMk1_C", "Build_MinerMk2_C", "Build_MinerMk3_C"]
        );
        let oil = allowed_extractors(&oil_node(NodePurity::Normal), &gd);
        assert_eq!(
            oil.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            ["Build_OilPump_C"]
        );
        assert!((oil[0].base_ipm - 120.0).abs() < 0.01);
        let well = MapNode {
            id: "w".into(),
            resource_item_id: "Desc_NitrogenGas_C".into(),
            purity: NodePurity::Normal,
            kind: NodeKind::FrackingWell,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            core_id: None,
        };
        assert_eq!(
            allowed_extractors(&well, &gd)
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["Build_FrackingSmasher_C"]
        );
        let geyser = MapNode {
            id: "g".into(),
            resource_item_id: "Desc_Geyser_C".into(),
            purity: NodePurity::Normal,
            kind: NodeKind::Geyser,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            core_id: None,
        };
        assert!(allowed_extractors(&geyser, &gd).is_empty());
    }

    #[test]
    fn tier_eligible_extractors_hides_marks_the_playthrough_hasnt_reached() {
        let gd = GameData::from_bundled().unwrap();
        let all = allowed_extractors(&iron_node(NodePurity::Normal), &gd);
        // Mk1 = T0, Mk2 = T4, Mk3 = T8 in the bundled catalog.
        assert_eq!(
            tier_eligible_extractors(&all, 0)
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["Build_MinerMk1_C"],
            "a fresh Tier 0 playthrough must not offer Mk2/Mk3 as a pick"
        );
        assert_eq!(
            tier_eligible_extractors(&all, 4)
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["Build_MinerMk1_C", "Build_MinerMk2_C"]
        );
        assert_eq!(
            tier_eligible_extractors(&all, 9)
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["Build_MinerMk1_C", "Build_MinerMk2_C", "Build_MinerMk3_C"]
        );
    }

    #[test]
    fn tier_eligible_extractors_never_returns_empty() {
        // A hypothetical family with no tier-0 entry still yields the
        // lowest-tier option rather than leaving the picker with nothing.
        let hypothetical = vec![
            ExtractorOption { id: "b".into(), name: "B".into(), base_ipm: 1.0, unlock_tier: 4 },
            ExtractorOption { id: "a".into(), name: "A".into(), base_ipm: 1.0, unlock_tier: 2 },
        ];
        let picked = tier_eligible_extractors(&hypothetical, 0);
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].id, "a", "falls back to the lowest-tier option, not just the first");
    }

    // ---------- extractor power tests ----------

    #[test]
    fn extractor_power_mw_pins_the_dump_wattage_per_mark_at_100_pct() {
        let gd = GameData::from_bundled().unwrap();
        // Mk1 5 MW, Mk2 15 MW, Mk3 45 MW — the same building wattage the
        // Power view already charges, so a claimed miner stops being a
        // free lunch. These come from the game dump's own `powerUsed`,
        // which the converter now validates the dataset against; the
        // 12/30 this once asserted were 1.0-era figures that survived
        // into a 1.2 dataset.
        for (miner_id, want) in [
            ("Build_MinerMk1_C", 5.0),
            ("Build_MinerMk2_C", 15.0),
            ("Build_MinerMk3_C", 45.0),
        ] {
            let mw = extractor_power_mw(&iron_node(NodePurity::Normal), Some(miner_id), 100.0, &gd);
            assert!((mw - want).abs() < 0.01, "{miner_id}: got {mw}, want {want}");
        }
    }

    #[test]
    fn extractor_power_mw_is_purity_independent_unlike_ipm() {
        // Purity changes throughput, never wattage — a Pure node doesn't
        // make the miner draw more power.
        let gd = GameData::from_bundled().unwrap();
        let pure = extractor_power_mw(&iron_node(NodePurity::Pure), Some("Build_MinerMk1_C"), 100.0, &gd);
        let impure = extractor_power_mw(&iron_node(NodePurity::Impure), Some("Build_MinerMk1_C"), 100.0, &gd);
        assert!((pure - 5.0).abs() < 0.01);
        assert!((impure - 5.0).abs() < 0.01);
    }

    #[test]
    fn extractor_power_mw_uses_the_1_321928_curve_when_underclocked() {
        // Mirrors the planner/machine regression: 50% clock is 0.4× base
        // under the real curve, not 0.25× (square) or 0.5× (linear).
        // 5 MW Mk1 miner at 50% = 2.0 MW.
        let gd = GameData::from_bundled().unwrap();
        let mw = extractor_power_mw(&iron_node(NodePurity::Normal), Some("Build_MinerMk1_C"), 50.0, &gd);
        assert!((mw - 2.0).abs() < 0.01, "got {mw}");
    }

    #[test]
    fn extractor_power_mw_zero_for_unclaimed_geyser_and_invalid_clock() {
        let gd = GameData::from_bundled().unwrap();
        assert_eq!(
            extractor_power_mw(&iron_node(NodePurity::Normal), None, 100.0, &gd),
            0.0
        );
        assert_eq!(
            extractor_power_mw(&iron_node(NodePurity::Normal), Some("Build_MinerMk1_C"), 0.0, &gd),
            0.0
        );
        let geyser = MapNode {
            id: "g".into(),
            resource_item_id: "Desc_Geyser_C".into(),
            purity: NodePurity::Normal,
            kind: NodeKind::Geyser,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            core_id: None,
        };
        assert_eq!(extractor_power_mw(&geyser, None, 100.0, &gd), 0.0);
    }

    #[test]
    fn extractor_power_mw_charges_oil_extractor_wattage_even_for_a_stale_miner_claim() {
        // Same coercion the ipm side does: a legacy claim's Mk* id still
        // charges the Oil Extractor's 40 MW, not a miner's wattage.
        let gd = GameData::from_bundled().unwrap();
        let mw = extractor_power_mw(&oil_node(NodePurity::Normal), Some("Build_MinerMk1_C"), 100.0, &gd);
        assert!((mw - 40.0).abs() < 0.01, "got {mw}");
    }

    #[test]
    fn extractor_power_mw_charges_no_wattage_for_a_resource_well_satellite() {
        // Codex P1: a Resource Well satellite is unpowered — only the
        // well's shared Pressuriser draws power, and only once per well.
        // `power_for_factory` adds that separately, keyed by `core_id`.
        let gd = GameData::from_bundled().unwrap();
        let well = MapNode {
            id: "w".into(),
            resource_item_id: "Desc_Water_C".into(),
            purity: NodePurity::Normal,
            kind: NodeKind::FrackingWell,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            core_id: None,
        };
        let mw = extractor_power_mw(&well, None, 100.0, &gd);
        assert_eq!(mw, 0.0);
    }

    #[test]
    fn oil_budget_independent_of_miner_assumption() {
        let gd = GameData::from_bundled().unwrap();
        let at_tier0 = resource_budget(&HashMap::new(), &gd, 0, BudgetAssumption::CurrentTierBest);
        let at_mk3 = resource_budget(&HashMap::new(), &gd, 9, BudgetAssumption::Mk3At100);
        let oil = |b: &ResourceBudget| {
            b.rows
                .iter()
                .find(|r| r.resource_item_id == "Desc_LiquidOil_C")
                .map(|r| r.world_max_ipm)
                .expect("oil row")
        };
        assert!(
            (oil(&at_tier0) - oil(&at_mk3)).abs() < 0.5,
            "oil seeps take one Oil Extractor — miner mark must not move the budget"
        );
    }

    #[test]
    fn fracking_well_uses_60_ipm_base_independent_of_miner_arg() {
        let gd = GameData::from_bundled().unwrap();
        let water_pure = MapNode {
            id: "w1".into(),
            resource_item_id: "Desc_Water_C".into(),
            purity: NodePurity::Pure,
            kind: NodeKind::FrackingWell,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            core_id: None,
        };
        // 60 × 2.0 (Pure) × 1.0 (clock) = 120.
        let ipm = extractor_output_ipm(&water_pure, None, 100.0, &gd);
        assert!((ipm - 120.0).abs() < 0.01, "got {ipm}");
    }

    #[test]
    fn deliverable_caps_at_the_best_belt_unlocked_while_raw_output_keeps_the_full_rate() {
        // The #82 table's worst row: a Miner Mk.1 on a Pure node at 250%
        // is 60 × 2 × 2.5 = 300/min of arithmetic, but at Tier 1 the only
        // belt is Mk.1 at 60/min and that's what leaves the port. Both
        // numbers have to stay reachable — the raw one is what
        // `check_claim_port_capacity` compares against the cap, so if
        // deliverable ever replaces it the warning goes silent.
        let gd = GameData::from_bundled().unwrap();
        let node = iron_node(NodePurity::Pure);
        let raw = extractor_output_ipm(&node, Some("Build_MinerMk1_C"), 250.0, &gd);
        assert!((raw - 300.0).abs() < 0.01, "got {raw}");
        let at_t1 = extractor_deliverable_ipm(&node, Some("Build_MinerMk1_C"), 250.0, 1, &gd);
        assert!((at_t1 - 60.0).abs() < 0.01, "Mk1 belt caps the port at 60, got {at_t1}");
        // Mk2 belts (120/min, T2) lift the ceiling without touching the
        // miner — same claim, more delivered.
        let at_t2 = extractor_deliverable_ipm(&node, Some("Build_MinerMk1_C"), 250.0, 2, &gd);
        assert!((at_t2 - 120.0).abs() < 0.01, "got {at_t2}");
    }

    #[test]
    fn deliverable_leaves_an_under_cap_extractor_untouched() {
        // The cap is a ceiling, never a target: a claim that already
        // fits its belt reports exactly what it produces.
        let gd = GameData::from_bundled().unwrap();
        let node = iron_node(NodePurity::Normal);
        let raw = extractor_output_ipm(&node, Some("Build_MinerMk1_C"), 50.0, &gd);
        let deliverable =
            extractor_deliverable_ipm(&node, Some("Build_MinerMk1_C"), 50.0, 0, &gd);
        assert!((raw - 30.0).abs() < 0.01, "got {raw}");
        assert!((deliverable - raw).abs() < 0.01, "got {deliverable}");
    }

    #[test]
    fn deliverable_leaves_fluids_uncapped_while_no_pipe_is_unlocked() {
        // Below Tier 3 there is no pipe, so there's no ceiling to state
        // and `check_claim_port_capacity` stays silent — the rate must
        // stay uncapped too, or supply would drop against a cap the app
        // never told the player about.
        let gd = GameData::from_bundled().unwrap();
        let node = oil_node(NodePurity::Pure);
        // 240 base on Pure × 250% = 600, well past the Mk1 pipe's 300.
        let raw = extractor_output_ipm(&node, Some("Build_OilPump_C"), 250.0, &gd);
        assert!((raw - 600.0).abs() < 0.01, "got {raw}");
        assert!(port_capacity(&node, 2, &gd).is_none(), "no pipe below T3");
        let no_pipe = extractor_deliverable_ipm(&node, Some("Build_OilPump_C"), 250.0, 2, &gd);
        assert!((no_pipe - raw).abs() < 0.01, "got {no_pipe}");
        // Once Mk1 pipes exist the same claim caps at their 300 m³/min.
        let piped = extractor_deliverable_ipm(&node, Some("Build_OilPump_C"), 250.0, 3, &gd);
        assert!((piped - 300.0).abs() < 0.01, "got {piped}");
    }

    #[test]
    fn supply_for_factory_reports_the_deliverable_rate_not_the_clock_rate() {
        // #90's whole point: a plan used to balance on ore that couldn't
        // physically leave the node. One Pure iron node, Mk1 miner at
        // 250%, bound to F1, at Tier 1 — supply is the 60/min the belt
        // carries, not the 300/min the clock claims.
        let gd = GameData::from_bundled().unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C" && n.purity == NodePurity::Pure)
            .unwrap();
        let mut claims = HashMap::new();
        claims.insert(iron.id.clone(), claim(&iron.id, "Build_MinerMk1_C", 250.0, Some("F1")));
        let supply = supply_for_factory(&claims, &[], "F1", 1, &gd);
        assert!(
            (supply["Desc_OreIron_C"] - 60.0).abs() < 0.01,
            "got {}",
            supply["Desc_OreIron_C"]
        );
        // The same claim delivers more once Mk2 belts land at T2.
        let later = supply_for_factory(&claims, &[], "F1", 2, &gd);
        assert!((later["Desc_OreIron_C"] - 120.0).abs() < 0.01, "got {}", later["Desc_OreIron_C"]);
    }

    #[test]
    fn supply_for_factory_never_port_caps_a_water_group() {
        // A group is a bank of N pumps, each with its own port, so its
        // total is an aggregate — and an aggregate is fixed by running
        // another pipe, which is normal play. Capping it to one pipe's
        // capacity would report a 40-pump farm as a single header.
        let gd = GameData::from_bundled().unwrap();
        let groups = vec![water_group(40, 100.0, None, Some("F1"))];
        let supply = supply_for_factory(&HashMap::new(), &groups, "F1", 9, &gd);
        assert!(
            (supply["Desc_Water_C"] - 4800.0).abs() < 0.01,
            "got {}",
            supply["Desc_Water_C"]
        );
    }

    #[test]
    fn resource_budget_stays_on_theoretical_rates_so_overcommit_still_fires() {
        // `overcommitted` compares `claimed_ipm` against `world_max_ipm`,
        // and `world_max_ipm` is the assumption's theoretical ceiling
        // with belts explicitly out of scope. Capping only the claimed
        // side would silence the flag for exactly the hot claims it
        // exists to catch: every iron node on Mk3 @ 250% against a Tier 0
        // Mk1 @ 100% budget is 4× over, but belt-capped at Tier 0 it
        // would read as 60/min per node and look comfortable.
        let gd = GameData::from_bundled().unwrap();
        let mut claims = HashMap::new();
        for n in gd.nodes().iter().filter(|n| n.resource_item_id == "Desc_OreIron_C") {
            claims.insert(n.id.clone(), claim(&n.id, "Build_MinerMk3_C", 250.0, Some("F1")));
        }
        let budget = resource_budget(&claims, &gd, 0, BudgetAssumption::CurrentTierBest);
        let iron = budget
            .rows
            .iter()
            .find(|r| r.resource_item_id == "Desc_OreIron_C")
            .unwrap();
        assert!(iron.overcommitted, "hot claims under a cold assumption must still flag");
        let deliverable_at_t0: f32 = claims
            .keys()
            .map(|id| {
                extractor_deliverable_ipm(
                    gd.node(id).unwrap(),
                    Some("Build_MinerMk3_C"),
                    250.0,
                    0,
                    &gd,
                )
            })
            .sum();
        assert!(
            iron.claimed_ipm > deliverable_at_t0,
            "the budget panel must report the theoretical rate ({}), not the Tier 0 \
             deliverable one ({deliverable_at_t0})",
            iron.claimed_ipm
        );
    }

    #[test]
    fn supply_for_factory_only_returns_bound_claims() {
        let gd = GameData::from_bundled().unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C" && n.purity == NodePurity::Pure)
            .unwrap();
        let copper = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreCopper_C")
            .unwrap();
        let mut claims = HashMap::new();
        // Iron is bound to F1; copper is claimed but unbound.
        claims.insert(
            iron.id.clone(),
            ClaimRow {
                node_id: iron.id.clone(),
                miner_id: Some("Build_MinerMk1_C".into()),
                clock_pct: 100.0,
                factory_id: Some("F1".into()),
                notes: None,
                created_at: "n".into(),
                updated_at: "n".into(),
            },
        );
        claims.insert(
            copper.id.clone(),
            ClaimRow {
                node_id: copper.id.clone(),
                miner_id: Some("Build_MinerMk1_C".into()),
                clock_pct: 100.0,
                factory_id: None,
                notes: None,
                created_at: "n".into(),
                updated_at: "n".into(),
            },
        );
        let f1_supply = supply_for_factory(&claims, &[], "F1", 9, &gd);
        assert!(f1_supply.contains_key("Desc_OreIron_C"));
        assert!(!f1_supply.contains_key("Desc_OreCopper_C"));
    }

    #[test]
    fn power_for_factory_only_counts_bound_claims() {
        // Extractors bound to F1 contribute their wattage; an unbound
        // claim on the same map contributes nothing to F1 — the same
        // binding rule `supply_for_factory` already enforces for ipm.
        let gd = GameData::from_bundled().unwrap();
        let iron = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreIron_C")
            .unwrap();
        let copper = gd
            .nodes()
            .iter()
            .find(|n| n.resource_item_id == "Desc_OreCopper_C")
            .unwrap();
        let mut claims = HashMap::new();
        claims.insert(iron.id.clone(), claim(&iron.id, "Build_MinerMk1_C", 100.0, Some("F1")));
        claims.insert(copper.id.clone(), claim(&copper.id, "Build_MinerMk1_C", 100.0, None));
        let f1_mw = power_for_factory(&claims, &[], "F1", &gd);
        assert!((f1_mw - 5.0).abs() < 0.01, "only the bound Mk1 counts, got {f1_mw}");
        let f2_mw = power_for_factory(&claims, &[], "F2", &gd);
        assert_eq!(f2_mw, 0.0);
    }

    #[test]
    fn power_for_factory_charges_one_pressuriser_per_well_not_per_satellite() {
        // Codex P1: claiming N satellites off the same well used to add N
        // Resource Well Extractor loads (150 MW each). Satellites are
        // unpowered; the well's shared Pressuriser (300 MW) is charged
        // once per distinct `core_id`, however many of its satellites
        // this factory has claimed.
        let gd = GameData::from_bundled().unwrap();
        let satellites: Vec<_> = gd
            .nodes()
            .iter()
            .filter(|n| n.kind == NodeKind::FrackingWell && n.core_id.is_some())
            .fold(std::collections::HashMap::<String, Vec<&crate::shared::gamedata::types::MapNode>>::new(), |mut acc, n| {
                acc.entry(n.core_id.clone().unwrap()).or_default().push(n);
                acc
            })
            .into_values()
            .find(|group| group.len() >= 3)
            .expect("bundled map data has a well with at least 3 satellites");

        let mut claims = HashMap::new();
        for sat in satellites.iter().take(3) {
            claims.insert(
                sat.id.clone(),
                claim(&sat.id, "Build_FrackingSmasher_C", 100.0, Some("F1")),
            );
        }
        let pressuriser_mw = gd.building("Build_FrackingSmasher_C").unwrap().power_mw;
        let mw = power_for_factory(&claims, &[], "F1", &gd);
        assert!(
            (mw - pressuriser_mw).abs() < 0.01,
            "3 satellites off one well should charge the Pressuriser once ({pressuriser_mw} MW), got {mw}"
        );
    }

    #[test]
    fn power_for_factory_never_double_charges_a_well_split_across_two_factories() {
        // Codex P2: the round-1 fix deduped satellites *within* one
        // `power_for_factory` call, but a well's satellites can be bound
        // to different factories — each factory's own call then sees "I
        // have one satellite of this well" and adds the Pressuriser once
        // each, for two charges total once a caller like
        // `list_power_balances` sums every factory's balance. One
        // satellite bound to F1, another satellite of the *same well* to
        // F2: only one of the two factories may ever charge the shared
        // Pressuriser, and neither factory's charge (0 or the full
        // wattage) may depend on `HashMap` iteration order.
        let gd = GameData::from_bundled().unwrap();
        let core_groups: std::collections::HashMap<String, Vec<&crate::shared::gamedata::types::MapNode>> = gd
            .nodes()
            .iter()
            .filter(|n| n.kind == NodeKind::FrackingWell && n.core_id.is_some())
            .fold(std::collections::HashMap::new(), |mut acc, n| {
                acc.entry(n.core_id.clone().unwrap()).or_default().push(n);
                acc
            });
        let satellites = core_groups
            .into_values()
            .find(|group| group.len() >= 2)
            .expect("bundled map data has a well with at least 2 satellites");

        let mut claims = HashMap::new();
        claims.insert(
            satellites[0].id.clone(),
            claim(&satellites[0].id, "Build_FrackingSmasher_C", 100.0, Some("F1")),
        );
        claims.insert(
            satellites[1].id.clone(),
            claim(&satellites[1].id, "Build_FrackingSmasher_C", 100.0, Some("F2")),
        );
        let pressuriser_mw = gd.building("Build_FrackingSmasher_C").unwrap().power_mw;

        let f1_mw = power_for_factory(&claims, &[], "F1", &gd);
        let f2_mw = power_for_factory(&claims, &[], "F2", &gd);
        let total = f1_mw + f2_mw;
        assert!(
            (total - pressuriser_mw).abs() < 0.01,
            "one well split across two factories must charge the Pressuriser once in total \
             ({pressuriser_mw} MW), got F1={f1_mw} + F2={f2_mw} = {total}"
        );
    }

    // ---------- water extractor group tests ----------

    fn water_group(count: i64, clock: f32, bank2: Option<(i64, f32)>, factory: Option<&str>) -> WaterGroupRow {
        WaterGroupRow {
            id: "wg".into(),
            world_x: 0.0,
            world_y: 0.0,
            count,
            clock_pct: clock,
            count2: bank2.map(|b| b.0),
            clock2_pct: bank2.map(|b| b.1),
            factory_id: factory.map(str::to_string),
            notes: None,
            locked: false,
            created_at: "n".into(),
            updated_at: "n".into(),
        }
    }

    #[test]
    fn water_group_output_sums_both_banks() {
        // 40 @ 100% = 4800, plus 2 @ 45% = 108 → 4908 m³/min.
        let g = water_group(40, 100.0, Some((2, 45.0)), None);
        assert!((water_group_output_ipm(&g) - 4908.0).abs() < 0.01);
        // Single bank with a decimal clock: 4 × 120 × 1.505 = 722.4.
        let g = water_group(4, 150.5, None, None);
        assert!((water_group_output_ipm(&g) - 722.4).abs() < 0.01);
    }

    #[test]
    fn supply_for_factory_only_counts_bound_water_groups() {
        let gd = GameData::from_bundled().unwrap();
        let groups = vec![
            water_group(4, 100.0, None, Some("F1")),
            water_group(10, 100.0, None, None), // unbound
        ];
        let f1 = supply_for_factory(&HashMap::new(), &groups, "F1", 9, &gd);
        assert!((f1["Desc_Water_C"] - 480.0).abs() < 0.01, "only the bound group counts");
        let f2 = supply_for_factory(&HashMap::new(), &groups, "F2", 9, &gd);
        assert!(!f2.contains_key("Desc_Water_C"));
    }

    #[test]
    fn water_group_power_mw_uses_water_extractor_wattage_for_both_banks() {
        // Water Extractor is 20 MW. Bank 1: 4 × 20 × 100% = 80. Bank 2:
        // 2 × 20 × 0.5^1.321928 (≈0.4) = 16. Total 96 — not 100, which is
        // what a linear (non-curved) clock model would give.
        let gd = GameData::from_bundled().unwrap();
        let g = water_group(4, 100.0, Some((2, 50.0)), None);
        let mw = water_group_power_mw(&g, &gd);
        assert!((mw - 96.0).abs() < 0.01, "got {mw}");
    }

    #[test]
    fn power_for_factory_only_counts_bound_water_groups() {
        let gd = GameData::from_bundled().unwrap();
        let groups = vec![
            water_group(4, 100.0, None, Some("F1")), // 4 × 20 = 80 MW
            water_group(10, 100.0, None, None),      // unbound
        ];
        let f1_mw = power_for_factory(&HashMap::new(), &groups, "F1", &gd);
        assert!((f1_mw - 80.0).abs() < 0.01, "only the bound group counts, got {f1_mw}");
        let f2_mw = power_for_factory(&HashMap::new(), &groups, "F2", &gd);
        assert_eq!(f2_mw, 0.0);
    }

    // ---------- resource budget tests ----------

    fn claim(node_id: &str, miner: &str, clock: f32, factory: Option<&str>) -> ClaimRow {
        ClaimRow {
            node_id: node_id.to_string(),
            miner_id: Some(miner.to_string()),
            clock_pct: clock,
            factory_id: factory.map(str::to_string),
            notes: None,
            created_at: "n".into(),
            updated_at: "n".into(),
        }
    }

    #[test]
    fn best_miner_tracks_unlock_tier() {
        let gd = GameData::from_bundled().unwrap();
        let early = best_miner_for_tier(0, &gd).expect("a starter miner exists");
        assert_eq!(early.mark, 1, "tier 0 should resolve to Mk1");
        let late = best_miner_for_tier(9, &gd).expect("endgame miner exists");
        assert_eq!(late.mark, 3, "high tier should resolve to Mk3");
    }

    #[test]
    fn world_max_matches_hand_computed_purity_sum_for_iron_at_mk3() {
        let gd = GameData::from_bundled().unwrap();
        let budget = resource_budget(&HashMap::new(), &gd, 9, BudgetAssumption::Mk3At100);
        let iron = budget
            .rows
            .iter()
            .find(|r| r.resource_item_id == "Desc_OreIron_C")
            .expect("iron row");
        // Mk3 base 240: Pure 480, Normal 240, Impure 120 per node.
        let expected = iron.pure.total as f32 * 480.0
            + iron.normal.total as f32 * 240.0
            + iron.impure.total as f32 * 120.0;
        assert!(
            (iron.world_max_ipm - expected).abs() < 0.5,
            "got {} want {expected}",
            iron.world_max_ipm
        );
        // Nothing claimed → remaining is the whole world.
        assert!((iron.remaining_ipm - iron.world_max_ipm).abs() < 0.5);
        assert_eq!(iron.claimed_ipm, 0.0);
    }

    #[test]
    fn remaining_equals_world_minus_claimed_max_invariant() {
        let gd = GameData::from_bundled().unwrap();
        let iron_nodes: Vec<&MapNode> = gd
            .nodes()
            .iter()
            .filter(|n| n.resource_item_id == "Desc_OreIron_C")
            .take(4)
            .collect();
        let mut claims = HashMap::new();
        claims.insert(iron_nodes[0].id.clone(), claim(&iron_nodes[0].id, "Build_MinerMk1_C", 50.0, Some("F1")));
        claims.insert(iron_nodes[1].id.clone(), claim(&iron_nodes[1].id, "Build_MinerMk2_C", 100.0, None));

        let budget = resource_budget(&claims, &gd, 9, BudgetAssumption::Mk3At100);
        let iron = budget
            .rows
            .iter()
            .find(|r| r.resource_item_id == "Desc_OreIron_C")
            .unwrap();
        assert!(
            (iron.remaining_ipm - (iron.world_max_ipm - iron.claimed_max_ipm)).abs() < 0.5,
            "remaining must be world max minus claimed nodes' max"
        );
        let claimed_count = iron.pure.claimed + iron.normal.claimed + iron.impure.claimed;
        assert_eq!(claimed_count, 2);
        assert!(iron.claimed_ipm > 0.0);
        assert!(iron.bound_ipm > 0.0 && iron.bound_ipm < iron.claimed_ipm);
        // Mk1 @ 50% + Mk2 @ 100% can't out-produce the Mk3 ceiling.
        assert!(!iron.overcommitted);
    }

    #[test]
    fn fracking_wells_budget_independent_of_miner_assumption() {
        let gd = GameData::from_bundled().unwrap();
        let at_tier0 = resource_budget(&HashMap::new(), &gd, 0, BudgetAssumption::CurrentTierBest);
        let at_mk3 = resource_budget(&HashMap::new(), &gd, 9, BudgetAssumption::Mk3At100);
        let nitrogen = |b: &ResourceBudget| {
            b.rows
                .iter()
                .find(|r| r.resource_item_id == "Desc_NitrogenGas_C")
                .map(|r| r.world_max_ipm)
                .expect("nitrogen row")
        };
        assert!(
            (nitrogen(&at_tier0) - nitrogen(&at_mk3)).abs() < 0.5,
            "well extraction has one extractor type — miner mark must not move it"
        );
        // 250% clock DOES move it.
        let at_250 = resource_budget(&HashMap::new(), &gd, 9, BudgetAssumption::Mk3At250);
        assert!(nitrogen(&at_250) > nitrogen(&at_mk3) * 2.0);
    }

    #[test]
    fn geysers_count_in_totals_but_contribute_zero_ipm() {
        let gd = GameData::from_bundled().unwrap();
        let budget = resource_budget(&HashMap::new(), &gd, 9, BudgetAssumption::Mk3At100);
        let geysers = budget
            .rows
            .iter()
            .find(|r| r.kind == NodeKind::Geyser)
            .expect("geyser row");
        assert_eq!(geysers.world_max_ipm, 0.0);
        assert!(geysers.pure.total + geysers.normal.total + geysers.impure.total > 0);
    }

    #[test]
    fn overcommit_flags_hot_claims_against_a_cold_assumption() {
        let gd = GameData::from_bundled().unwrap();
        // Claim every iron node with Mk3 @ 250%, then state the budget
        // at tier-0 best (Mk1 @ 100%) — claims exceed the ceiling.
        let mut claims = HashMap::new();
        for n in gd.nodes().iter().filter(|n| n.resource_item_id == "Desc_OreIron_C") {
            claims.insert(n.id.clone(), claim(&n.id, "Build_MinerMk3_C", 250.0, None));
        }
        let budget = resource_budget(&claims, &gd, 0, BudgetAssumption::CurrentTierBest);
        assert_eq!(budget.assumption_label, "Mk1 @ 100%");
        let iron = budget
            .rows
            .iter()
            .find(|r| r.resource_item_id == "Desc_OreIron_C")
            .unwrap();
        assert!(iron.overcommitted, "hot claims under a cold assumption must flag");
        assert_eq!(iron.remaining_ipm, 0.0, "everything claimed → nothing remaining");
    }

    #[test]
    fn geysers_yield_zero_item_flow() {
        let gd = GameData::from_bundled().unwrap();
        let g = MapNode {
            id: "g1".into(),
            resource_item_id: "Desc_Geyser_C".into(),
            purity: NodePurity::Pure,
            kind: NodeKind::Geyser,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            core_id: None,
        };
        assert_eq!(extractor_output_ipm(&g, None, 250.0, &gd), 0.0);
    }
}
