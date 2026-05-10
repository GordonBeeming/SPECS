use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnlockedAltRecipe {
    pub recipe_id: String,
    pub unlocked_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleAltRecipeInput {
    pub recipe_id: String,
    /// `true` to unlock; `false` to lock back. Toggle-style API keeps the
    /// React side simple: a single endpoint covers the checkbox both ways.
    pub unlocked: bool,
}
