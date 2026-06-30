export interface UnlockedAltRecipe {
  recipeId: string;
  unlockedAt: string;
}

export interface ToggleAltRecipeInput {
  recipeId: string;
  unlocked: boolean;
}

export interface SetAltRecipesInput {
  recipeIds: string[];
  unlocked: boolean;
}
