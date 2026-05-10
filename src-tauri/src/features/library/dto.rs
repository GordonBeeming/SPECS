use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySummary {
    pub dataset_version: String,
    pub game_version: String,
    pub item_count: usize,
    pub building_count: usize,
    pub recipe_count: usize,
    pub milestone_count: usize,
}
