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
  /** Phase 8: opt-in amplification. Both default false/0 on existing rows. */
  useSomersloop: boolean;
  somersloopSlotsFilled: number;
  powerShardCount: number;
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
  /** Defaults to false on the Rust side; omit when not amplifying. */
  useSomersloop?: boolean;
  somersloopSlotsFilled?: number;
  powerShardCount?: number;
}

export interface UpdateMachineInput {
  id: string;
  count: number;
  clockPct: number;
  useSomersloop?: boolean;
  somersloopSlotsFilled?: number;
  powerShardCount?: number;
}
