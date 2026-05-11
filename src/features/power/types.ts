/**
 * Mirror of `src-tauri/src/features/power/dto.rs`.
 */

export interface PowerGen {
  id: string;
  factoryId: string;
  generatorId: string;
  fuelItemId: string;
  count: number;
  /** percent — 1.0 to 250.0 */
  clockPct: number;
  notes?: string;
  /** Optional own-position; falls back to the factory's coords. */
  worldX?: number;
  worldY?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SetPowerGenPositionInput {
  id: string;
  worldX: number;
  worldY: number;
}

export interface CreatePowerGenInput {
  factoryId: string;
  generatorId: string;
  fuelItemId: string;
  count: number;
  clockPct: number;
  notes?: string;
}

export interface UpdatePowerGenInput {
  id: string;
  count: number;
  clockPct: number;
  fuelItemId: string;
  notes?: string;
}

export interface PowerFuelFlow {
  itemId: string;
  itemName: string;
  isFluid: boolean;
  perMinute: number;
}

export interface FactoryPowerBalance {
  factoryId: string;
  generatedMw: number;
  consumedMw: number;
  netMw: number;
  fuelFlows: PowerFuelFlow[];
}
