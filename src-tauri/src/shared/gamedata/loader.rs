//! Game-data JSON loader + validator.
//!
//! The dataset is `include_str!`-baked into the binary at compile time (see
//! [`BUNDLED_JSON`]) so production builds never read from disk. Tests hit the
//! same parser via [`parse_str`] with fixture strings.

use std::collections::HashSet;

use anyhow::{Context, Result, anyhow, bail};

use super::types::GameDataFile;

/// Bundled dataset — compiled into the binary so prod doesn't touch the FS.
pub const BUNDLED_JSON: &str = include_str!("../../../game-data/v0.1.json");

/// Parse and validate the bundled dataset.
pub fn load_bundled() -> Result<GameDataFile> {
    parse_str(BUNDLED_JSON).context("loading bundled game data")
}

/// Parse and validate a JSON string.
pub fn parse_str(json: &str) -> Result<GameDataFile> {
    let data: GameDataFile = serde_json::from_str(json).context("parsing game data JSON")?;
    validate(&data)?;
    Ok(data)
}

/// Cross-check internal references and uniqueness invariants. Slices rely on
/// these holding so we surface violations at load time, not at first use.
pub fn validate(data: &GameDataFile) -> Result<()> {
    // Unique IDs.
    let mut item_ids: HashSet<&str> = HashSet::with_capacity(data.items.len());
    for item in &data.items {
        if !item_ids.insert(&item.id) {
            bail!("duplicate item id: {}", item.id);
        }
    }

    let mut building_ids: HashSet<&str> = HashSet::with_capacity(data.buildings.len());
    for b in &data.buildings {
        if !building_ids.insert(&b.id) {
            bail!("duplicate building id: {}", b.id);
        }
    }

    let mut recipe_ids: HashSet<&str> = HashSet::with_capacity(data.recipes.len());
    for r in &data.recipes {
        if !recipe_ids.insert(&r.id) {
            bail!("duplicate recipe id: {}", r.id);
        }
    }

    let mut milestone_ids: HashSet<&str> = HashSet::with_capacity(data.milestones.len());
    for m in &data.milestones {
        if !milestone_ids.insert(&m.id) {
            bail!("duplicate milestone id: {}", m.id);
        }
    }

    // Recipe references resolve.
    for r in &data.recipes {
        if !building_ids.contains(r.building_id.as_str()) {
            return Err(anyhow!(
                "recipe {} references unknown building {}",
                r.id,
                r.building_id
            ));
        }
        for io in r.inputs.iter().chain(r.outputs.iter()) {
            if !item_ids.contains(io.item_id.as_str()) {
                return Err(anyhow!(
                    "recipe {} references unknown item {}",
                    r.id,
                    io.item_id
                ));
            }
            if io.per_minute <= 0.0 {
                return Err(anyhow!(
                    "recipe {} has non-positive per-minute on {}",
                    r.id,
                    io.item_id
                ));
            }
        }
        if r.cycle_seconds <= 0.0 {
            return Err(anyhow!("recipe {} has non-positive cycle_seconds", r.id));
        }
        if r.outputs.is_empty() {
            return Err(anyhow!("recipe {} has no outputs", r.id));
        }
    }

    // Belt + pipe tier marks unique.
    let mut belt_marks: HashSet<u8> = HashSet::new();
    for b in &data.belt_tiers {
        if !belt_marks.insert(b.mark) {
            bail!("duplicate belt tier mark: Mk{}", b.mark);
        }
        if b.items_per_minute == 0 {
            bail!("belt Mk{} has zero throughput", b.mark);
        }
    }
    let mut pipe_marks: HashSet<u8> = HashSet::new();
    for p in &data.pipe_tiers {
        if !pipe_marks.insert(p.mark) {
            bail!("duplicate pipe tier mark: Mk{}", p.mark);
        }
        if p.cubic_meters_per_minute == 0 {
            bail!("pipe Mk{} has zero throughput", p.mark);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_dataset_parses_and_validates() {
        let data = load_bundled().expect("bundled JSON should parse + validate");
        assert!(!data.items.is_empty(), "bundled items should not be empty");
        assert!(!data.buildings.is_empty(), "bundled buildings should not be empty");
        assert!(!data.recipes.is_empty(), "bundled recipes should not be empty");
        assert!(!data.milestones.is_empty(), "bundled milestones should not be empty");
        assert!(!data.belt_tiers.is_empty(), "bundled belt tiers should not be empty");
        assert!(!data.pipe_tiers.is_empty(), "bundled pipe tiers should not be empty");
    }

    #[test]
    fn bundled_dataset_has_six_belt_tiers() {
        let data = load_bundled().unwrap();
        assert_eq!(data.belt_tiers.len(), 6, "Mk1 through Mk6");
    }

    #[test]
    fn bundled_dataset_belt_throughputs_match_research() {
        let data = load_bundled().unwrap();
        let by_mark: std::collections::HashMap<u8, u32> = data
            .belt_tiers
            .iter()
            .map(|b| (b.mark, b.items_per_minute))
            .collect();
        // Throughputs verified against satisfactory.wiki.gg during the Phase 2 research.
        assert_eq!(by_mark[&1], 60);
        assert_eq!(by_mark[&2], 120);
        assert_eq!(by_mark[&3], 270);
        assert_eq!(by_mark[&4], 480);
        assert_eq!(by_mark[&5], 780);
        assert_eq!(by_mark[&6], 1200);
    }

    #[test]
    fn bundled_dataset_pipe_throughputs_match_research() {
        let data = load_bundled().unwrap();
        let by_mark: std::collections::HashMap<u8, u32> = data
            .pipe_tiers
            .iter()
            .map(|p| (p.mark, p.cubic_meters_per_minute))
            .collect();
        assert_eq!(by_mark[&1], 300);
        assert_eq!(by_mark[&2], 600);
    }

    #[test]
    fn validate_rejects_duplicate_item_ids() {
        let bad = r#"{
          "version":"x","gameVersion":"1.1",
          "items":[
            {"id":"i","name":"a","category":"raw","stackSize":1,"isFluid":false},
            {"id":"i","name":"b","category":"raw","stackSize":1,"isFluid":false}
          ],
          "buildings":[],"recipes":[],"milestones":[],"beltTiers":[],"pipeTiers":[]
        }"#;
        let err = parse_str(bad).unwrap_err();
        assert!(format!("{:#}", err).contains("duplicate item id"));
    }

    #[test]
    fn validate_rejects_recipe_referencing_unknown_item() {
        let bad = r#"{
          "version":"x","gameVersion":"1.1",
          "items":[{"id":"i","name":"i","category":"raw","stackSize":1,"isFluid":false}],
          "buildings":[{"id":"b","name":"b","category":"smelting","powerMw":1,"unlockTier":0}],
          "recipes":[{
            "id":"r","name":"r","buildingId":"b","isAlt":false,"unlockTier":0,"cycleSeconds":2,
            "inputs":[],"outputs":[{"itemId":"NOT_EXIST","perMinute":1}]
          }],
          "milestones":[],"beltTiers":[],"pipeTiers":[]
        }"#;
        let err = parse_str(bad).unwrap_err();
        assert!(format!("{:#}", err).contains("unknown item"));
    }

    #[test]
    fn validate_rejects_recipe_referencing_unknown_building() {
        let bad = r#"{
          "version":"x","gameVersion":"1.1",
          "items":[{"id":"i","name":"i","category":"raw","stackSize":1,"isFluid":false}],
          "buildings":[],
          "recipes":[{
            "id":"r","name":"r","buildingId":"NOT_EXIST","isAlt":false,"unlockTier":0,"cycleSeconds":2,
            "inputs":[],"outputs":[{"itemId":"i","perMinute":1}]
          }],
          "milestones":[],"beltTiers":[],"pipeTiers":[]
        }"#;
        let err = parse_str(bad).unwrap_err();
        assert!(format!("{:#}", err).contains("unknown building"));
    }

    #[test]
    fn validate_rejects_recipe_with_zero_per_minute() {
        let bad = r#"{
          "version":"x","gameVersion":"1.1",
          "items":[{"id":"i","name":"i","category":"raw","stackSize":1,"isFluid":false}],
          "buildings":[{"id":"b","name":"b","category":"smelting","powerMw":1,"unlockTier":0}],
          "recipes":[{
            "id":"r","name":"r","buildingId":"b","isAlt":false,"unlockTier":0,"cycleSeconds":2,
            "inputs":[],"outputs":[{"itemId":"i","perMinute":0}]
          }],
          "milestones":[],"beltTiers":[],"pipeTiers":[]
        }"#;
        let err = parse_str(bad).unwrap_err();
        assert!(format!("{:#}", err).contains("non-positive per-minute"));
    }

    #[test]
    fn validate_rejects_recipe_with_no_outputs() {
        let bad = r#"{
          "version":"x","gameVersion":"1.1",
          "items":[{"id":"i","name":"i","category":"raw","stackSize":1,"isFluid":false}],
          "buildings":[{"id":"b","name":"b","category":"smelting","powerMw":1,"unlockTier":0}],
          "recipes":[{
            "id":"r","name":"r","buildingId":"b","isAlt":false,"unlockTier":0,"cycleSeconds":2,
            "inputs":[{"itemId":"i","perMinute":1}],"outputs":[]
          }],
          "milestones":[],"beltTiers":[],"pipeTiers":[]
        }"#;
        let err = parse_str(bad).unwrap_err();
        assert!(format!("{:#}", err).contains("no outputs"));
    }

    #[test]
    fn validate_rejects_duplicate_belt_marks() {
        let bad = r#"{
          "version":"x","gameVersion":"1.1",
          "items":[],"buildings":[],"recipes":[],"milestones":[],
          "beltTiers":[
            {"mark":1,"itemsPerMinute":60,"unlockTier":0},
            {"mark":1,"itemsPerMinute":120,"unlockTier":0}
          ],
          "pipeTiers":[]
        }"#;
        let err = parse_str(bad).unwrap_err();
        assert!(format!("{:#}", err).contains("duplicate belt tier mark"));
    }
}
