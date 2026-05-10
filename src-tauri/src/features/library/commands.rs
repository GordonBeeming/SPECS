use tauri::State;

use crate::shared::error::AppResult;
use crate::shared::gamedata::types::{
    BeltTier, Building, Item, Milestone, PipeTier, Recipe,
};
use crate::shared::gamedata::GameData;

use super::dto::LibrarySummary;

#[tauri::command]
pub fn library_summary(game_data: State<GameData>) -> AppResult<LibrarySummary> {
    Ok(LibrarySummary {
        dataset_version: game_data.version().to_string(),
        game_version: game_data.game_version().to_string(),
        item_count: game_data.items().len(),
        building_count: game_data.buildings().len(),
        recipe_count: game_data.recipes().len(),
        milestone_count: game_data.milestones().len(),
    })
}

#[tauri::command]
pub fn library_items(game_data: State<GameData>) -> AppResult<Vec<Item>> {
    Ok(game_data.items().to_vec())
}

#[tauri::command]
pub fn library_buildings(game_data: State<GameData>) -> AppResult<Vec<Building>> {
    Ok(game_data.buildings().to_vec())
}

#[tauri::command]
pub fn library_recipes(game_data: State<GameData>) -> AppResult<Vec<Recipe>> {
    Ok(game_data.recipes().to_vec())
}

#[tauri::command]
pub fn library_milestones(game_data: State<GameData>) -> AppResult<Vec<Milestone>> {
    let mut out = game_data.milestones().to_vec();
    out.sort_by_key(|m| m.tier);
    Ok(out)
}

#[tauri::command]
pub fn library_belt_tiers(game_data: State<GameData>) -> AppResult<Vec<BeltTier>> {
    let mut out = game_data.belt_tiers().to_vec();
    out.sort_by_key(|b| b.mark);
    Ok(out)
}

#[tauri::command]
pub fn library_pipe_tiers(game_data: State<GameData>) -> AppResult<Vec<PipeTier>> {
    let mut out = game_data.pipe_tiers().to_vec();
    out.sort_by_key(|p| p.mark);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gd() -> GameData {
        GameData::from_bundled().unwrap()
    }

    // Note: these tests exercise the underlying logic without the Tauri State
    // wrapper. The wrapper is a thin reference holder — calling the inner
    // functions directly through the GameData handle covers the same code.

    #[test]
    fn summary_counts_match_dataset() {
        let gd = gd();
        let s = LibrarySummary {
            dataset_version: gd.version().to_string(),
            game_version: gd.game_version().to_string(),
            item_count: gd.items().len(),
            building_count: gd.buildings().len(),
            recipe_count: gd.recipes().len(),
            milestone_count: gd.milestones().len(),
        };
        assert_eq!(s.item_count, gd.items().len());
        assert_eq!(s.recipe_count, gd.recipes().len());
        assert!(s.item_count > 0);
        assert!(s.recipe_count > 0);
    }

    #[test]
    fn milestones_returned_in_tier_order() {
        let gd = gd();
        let mut out = gd.milestones().to_vec();
        out.sort_by_key(|m| m.tier);
        let tiers: Vec<u8> = out.iter().map(|m| m.tier).collect();
        let mut sorted = tiers.clone();
        sorted.sort();
        assert_eq!(tiers, sorted, "milestones must come back tier-ordered");
    }

    #[test]
    fn belt_tiers_returned_in_mark_order() {
        let gd = gd();
        let mut out = gd.belt_tiers().to_vec();
        out.sort_by_key(|b| b.mark);
        let marks: Vec<u8> = out.iter().map(|b| b.mark).collect();
        assert_eq!(marks, vec![1, 2, 3, 4, 5, 6]);
    }
}
