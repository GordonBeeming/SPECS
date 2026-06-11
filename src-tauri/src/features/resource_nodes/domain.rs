//! Pure throughput math for resource nodes. Kept out of `commands.rs`
//! so the planner can call it without going through Tauri state.

use std::collections::HashMap;

use serde::Deserialize;

use crate::shared::gamedata::GameData;
use crate::shared::gamedata::types::{MapNode, Miner, NodeKind, NodePurity};

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

/// The extractor buildings a node can legally take. Single source of
/// truth for the pickers (NodeRow, map popover, placement loadout) and
/// for `set_node_claim` validation — they must never disagree again.
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

/// Aggregate ipm per item across *all* claimed nodes plus water
/// extractor groups, regardless of factory binding. The planner uses
/// this as its raw "what could in principle be supplied" pool; the
/// bound vs. unbound split is the caller's responsibility.
#[allow(dead_code)]
pub fn available_supply(
    claims: &HashMap<String, ClaimRow>,
    water_groups: &[WaterGroupRow],
    game_data: &GameData,
) -> HashMap<String, f32> {
    let mut out: HashMap<String, f32> = HashMap::new();
    for (node_id, claim) in claims {
        let Some(node) = game_data.node(node_id) else {
            continue;
        };
        let ipm = extractor_output_ipm(node, claim.miner_id.as_deref(), claim.clock_pct, game_data);
        if ipm <= 0.0 {
            continue;
        }
        *out.entry(node.resource_item_id.clone()).or_insert(0.0) += ipm;
    }
    for group in water_groups {
        let ipm = water_group_output_ipm(group);
        if ipm <= 0.0 {
            continue;
        }
        *out.entry("Desc_Water_C".to_string()).or_insert(0.0) += ipm;
    }
    out
}

/// Supply pool fed into one factory by its bound claims and bound
/// water extractor groups. Used by the factory ledger's "From nodes:
/// X ipm" chip.
pub fn supply_for_factory(
    claims: &HashMap<String, ClaimRow>,
    water_groups: &[WaterGroupRow],
    factory_id: &str,
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
        let ipm = extractor_output_ipm(node, claim.miner_id.as_deref(), claim.clock_pct, game_data);
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
    fn available_supply_sums_claimed_ipm_by_item() {
        let gd = GameData::from_bundled().unwrap();
        // Use real node ids from the bundled catalog so the lookup
        // resolves. Pick three known iron nodes.
        let iron_nodes: Vec<&MapNode> = gd
            .nodes()
            .iter()
            .filter(|n| n.resource_item_id == "Desc_OreIron_C")
            .take(3)
            .collect();
        assert_eq!(iron_nodes.len(), 3);

        let mut claims = HashMap::new();
        for n in &iron_nodes {
            claims.insert(
                n.id.clone(),
                ClaimRow {
                    node_id: n.id.clone(),
                    miner_id: Some("Build_MinerMk1_C".into()),
                    clock_pct: 100.0,
                    factory_id: None,
                    notes: None,
                    created_at: "n".into(),
                    updated_at: "n".into(),
                },
            );
        }
        let supply = available_supply(&claims, &[], &gd);
        // Mk1 = 60 ipm Normal; three claims of mixed purity should yield
        // a positive total. We don't pin the exact value (varies with
        // which three nodes the catalog enumerates first) but the
        // bookkeeping must roll up under Desc_OreIron_C.
        assert!(supply["Desc_OreIron_C"] > 0.0);
        assert_eq!(supply.len(), 1);
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
        let f1_supply = supply_for_factory(&claims, &[], "F1", &gd);
        assert!(f1_supply.contains_key("Desc_OreIron_C"));
        assert!(!f1_supply.contains_key("Desc_OreCopper_C"));
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
    fn available_supply_folds_water_groups_into_water() {
        let gd = GameData::from_bundled().unwrap();
        let groups = vec![water_group(4, 100.0, None, None)];
        let supply = available_supply(&HashMap::new(), &groups, &gd);
        assert!((supply["Desc_Water_C"] - 480.0).abs() < 0.01);
    }

    #[test]
    fn supply_for_factory_only_counts_bound_water_groups() {
        let gd = GameData::from_bundled().unwrap();
        let groups = vec![
            water_group(4, 100.0, None, Some("F1")),
            water_group(10, 100.0, None, None), // unbound
        ];
        let f1 = supply_for_factory(&HashMap::new(), &groups, "F1", &gd);
        assert!((f1["Desc_Water_C"] - 480.0).abs() < 0.01, "only the bound group counts");
        let f2 = supply_for_factory(&HashMap::new(), &groups, "F2", &gd);
        assert!(!f2.contains_key("Desc_Water_C"));
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
