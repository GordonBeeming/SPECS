use tauri::State;

use crate::shared::error::AppResult;
use crate::shared::gamedata::types::{
    BeltTier, Building, Generator, Item, Milestone, PipeTier, Recipe, TransportVehicle,
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

#[tauri::command]
pub fn library_generators(game_data: State<GameData>) -> AppResult<Vec<Generator>> {
    Ok(game_data.generators().to_vec())
}

#[tauri::command]
pub fn library_transport_vehicles(
    game_data: State<GameData>,
) -> AppResult<Vec<TransportVehicle>> {
    Ok(game_data.transport_vehicles().to_vec())
}

/// The items the game only sources from extractors, wells and vents.
///
/// Every chain walk on either side of the IPC boundary terminates on
/// this set — it's what "you can't make this, you mine it" means. The
/// frontend's raw-demand trace needs the same answer the planner used,
/// and a second hand-written list of the same ids is the one duplicate
/// nothing would fail on: the two walks would just quietly stop at
/// different depths and report different raw totals for one factory.
#[tauri::command]
pub fn library_extracted_resources(game_data: State<GameData>) -> AppResult<Vec<String>> {
    Ok(game_data.extracted_resources().iter().map(|s| s.to_string()).collect())
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

    /// The frontend's raw-demand trace terminates on whatever this
    /// command ships, and the planner terminates on
    /// `is_extracted_resource`. Adding an id to one and not the other
    /// would fail nothing at runtime — the two walks would just stop at
    /// different depths — so the agreement is asserted here instead.
    #[test]
    fn extracted_resources_command_agrees_with_the_predicate() {
        let gd = gd();
        let shipped: Vec<String> = gd.extracted_resources().iter().map(|s| s.to_string()).collect();
        for id in &shipped {
            assert!(gd.is_extracted_resource(id), "{id} shipped but not extracted");
        }
        for item in gd.items() {
            assert_eq!(
                gd.is_extracted_resource(&item.id),
                shipped.contains(&item.id),
                "{} disagrees between the predicate and the shipped list",
                item.id
            );
        }
        // Every id has to name something the dataset knows about, or a
        // typo would sit in the set doing nothing until the resource it
        // meant to ground out started recursing. `Desc_Geyser_C` is the
        // deliberate exception: geysers feed power rather than item
        // flow, so their placeholder is a node id with no item behind
        // it (see `MapNode::resource_item_id`).
        for id in &shipped {
            assert!(
                gd.item(id).is_some() || gd.nodes().iter().any(|n| &n.resource_item_id == id),
                "{id} names neither a dataset item nor a map node's resource"
            );
        }
    }
}
