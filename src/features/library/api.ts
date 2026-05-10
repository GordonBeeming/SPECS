import { invoke } from "@/shared/tauri/invoke";
import type {
  BeltTier,
  Building,
  Item,
  LibrarySummary,
  Milestone,
  PipeTier,
  Recipe,
} from "./types";

export const libraryApi = {
  summary: () => invoke<LibrarySummary>("library_summary"),
  items: () => invoke<Item[]>("library_items"),
  buildings: () => invoke<Building[]>("library_buildings"),
  recipes: () => invoke<Recipe[]>("library_recipes"),
  milestones: () => invoke<Milestone[]>("library_milestones"),
  beltTiers: () => invoke<BeltTier[]>("library_belt_tiers"),
  pipeTiers: () => invoke<PipeTier[]>("library_pipe_tiers"),
};
