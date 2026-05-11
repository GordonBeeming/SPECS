//! Pure throughput math for resource nodes. Kept out of `commands.rs`
//! so the planner can call it without going through Tauri state.

use std::collections::HashMap;

use crate::shared::gamedata::GameData;
use crate::shared::gamedata::types::{MapNode, NodeKind, NodePurity};

use super::repo::ClaimRow;

/// Items-per-minute a single extractor produces on a node at the given
/// clock. Geysers produce nothing — they're for power.
///
/// Miner_node: looks up the miner row by id, scales by purity + clock.
///
/// Fracking_well: uses the per-resource extractor rates pinned below
/// (Resource Well Extractor outputs 60/120/240 m³ or items per minute
/// for Impure/Normal/Pure satellites at 100% clock, source: wiki).
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
    match node.kind {
        NodeKind::MinerNode => {
            let Some(id) = miner_building_id else { return 0.0 };
            let Some(miner) = game_data.miners().iter().find(|m| m.id == id) else {
                return 0.0;
            };
            miner.base_items_per_minute * purity_mult * clock
        }
        NodeKind::FrackingWell => {
            // Resource Well Extractor rates are independent of miner mark —
            // there's only one extractor building per well. Base 60 items
            // (or m³) per minute at Normal purity, scaled by purity + clock.
            // Skipping mark lookup keeps the code simple and matches the
            // wiki's "purity is the only knob" wording.
            60.0 * purity_mult * clock
        }
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

/// Aggregate ipm per item across *all* claimed nodes, regardless of
/// factory binding. The planner uses this as its raw "what could in
/// principle be supplied" pool; the bound vs. unbound split is the
/// caller's responsibility.
#[allow(dead_code)]
pub fn available_supply(
    claims: &HashMap<String, ClaimRow>,
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
    out
}

/// Supply pool fed into one factory by its bound claims. Used by the
/// factory ledger's "From nodes: X ipm" chip.
pub fn supply_for_factory(
    claims: &HashMap<String, ClaimRow>,
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
    out
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
        let supply = available_supply(&claims, &gd);
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
        let f1_supply = supply_for_factory(&claims, "F1", &gd);
        assert!(f1_supply.contains_key("Desc_OreIron_C"));
        assert!(!f1_supply.contains_key("Desc_OreCopper_C"));
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
