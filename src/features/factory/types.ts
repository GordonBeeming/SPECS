/**
 * Mirror of `src-tauri/src/features/factory/dto.rs`.
 */

export interface Factory {
  id: string;
  name: string;
  worldX: number;
  worldY: number;
  color?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  machineCount: number;
}

export interface FactoryMachine {
  id: string;
  factoryId: string;
  buildingId: string;
  recipeId: string;
  count: number;
  /** percent — 1.0 to 250.0 */
  clockPct: number;
  createdAt: string;
  updatedAt: string;
}

export interface ItemFlow {
  itemId: string;
  itemName: string;
  isFluid: boolean;
  producedPerMinute: number;
  consumedPerMinute: number;
  netPerMinute: number;
}

export interface FactoryLedger {
  factoryId: string;
  flows: ItemFlow[];
  powerMw: number;
}

export interface FactoryDetail {
  factory: Factory;
  machines: FactoryMachine[];
  ledger: FactoryLedger;
}

export interface CreateFactoryInput {
  name: string;
  notes?: string;
  color?: string;
}

export interface RenameFactoryInput {
  id: string;
  name: string;
}

export interface AddMachineInput {
  factoryId: string;
  buildingId: string;
  recipeId: string;
  count: number;
  clockPct: number;
}

export interface UpdateMachineInput {
  id: string;
  count: number;
  clockPct: number;
}
