import { invoke } from "@/shared/tauri/invoke";
import type { ToggleAltRecipeInput, UnlockedAltRecipe } from "./types";

export const altsApi = {
  list: () => invoke<UnlockedAltRecipe[]>("list_unlocked_alt_recipes"),
  toggle: (input: ToggleAltRecipeInput) =>
    invoke<void>("toggle_alt_recipe", { input }),
};
