/**
 * Mirror of `src-tauri/src/shared/gamedata/types.rs`. Generated TS bindings
 * land in a later phase; until then keep the surface flat and idiomatic.
 */

export type ItemCategory =
  | "raw"
  | "ingot"
  | "part"
  | "component"
  | "fluid"
  | "ammo"
  | "equipment"
  | "special";

export type BuildingCategory =
  | "extraction"
  | "smelting"
  | "manufacturing"
  | "logistics"
  | "power"
  | "storage"
  | "special";

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  stackSize: number;
  isFluid: boolean;
  color?: string;
}

export interface Building {
  id: string;
  name: string;
  category: BuildingCategory;
  powerMw: number;
  unlockTier: number;
}

export interface RecipeIo {
  itemId: string;
  perMinute: number;
}

export interface Recipe {
  id: string;
  name: string;
  buildingId: string;
  isAlt: boolean;
  unlockTier: number;
  cycleSeconds: number;
  inputs: RecipeIo[];
  outputs: RecipeIo[];
}

export interface Milestone {
  id: string;
  tier: number;
  name: string;
  unlocks: string[];
}

export interface BeltTier {
  mark: number;
  itemsPerMinute: number;
  unlockTier: number;
}

export interface PipeTier {
  mark: number;
  cubicMetersPerMinute: number;
  unlockTier: number;
}

export interface LibrarySummary {
  datasetVersion: string;
  gameVersion: string;
  itemCount: number;
  buildingCount: number;
  recipeCount: number;
  milestoneCount: number;
}

export type GeneratorCategory = "burner" | "fluid" | "nuclear" | "geothermal";

export interface GeneratorFuel {
  fuelItemId: string;
  fuelPerMinute: number;
  supplementalItemId?: string;
  supplementalPerMinute?: number;
  powerMwOverride?: number;
}

export interface Generator {
  id: string;
  name: string;
  category: GeneratorCategory;
  powerMw: number;
  unlockTier: number;
  fuels: GeneratorFuel[];
}

export type VehicleKind = "tractor" | "truck" | "drone";

export interface TransportVehicle {
  id: string;
  name: string;
  kind: VehicleKind;
  slots: number;
  baseItemsPerMinute: number;
  batteryPerKm: number;
  unlockTier: number;
}
