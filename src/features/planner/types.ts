export interface RecipeFlow {
  itemId: string;
  itemName: string;
  perMinute: number;
}

export interface ChainStage {
  recipeId: string;
  recipeName: string;
  buildingId: string;
  buildingName: string;
  outputItemId: string;
  outputIpm: number;
  machineCount: number;
  clockPct: number;
  inputs: RecipeFlow[];
  outputs: RecipeFlow[];
  isAlt: boolean;
  powerMw: number;
}

export interface ChainPlan {
  targetItemId: string;
  targetItemName: string;
  targetIpm: number;
  stages: ChainStage[];
  totalMachines: number;
  totalPowerMw: number;
  /** Raw demand by item id, ipm. */
  rawDemand: Record<string, number>;
}

export type PlannerError =
  | { kind: "unknownTarget"; itemId: string }
  | { kind: "noRecipeForTarget"; itemId: string }
  | { kind: "insufficient"; missing: Record<string, number> }
  | { kind: "cycleDetected"; itemId: string };

export type DeriveChainResult =
  | { kind: "ok"; plan: ChainPlan }
  | { kind: "err"; error: PlannerError };

export interface DeriveChainInput {
  targetItemId: string;
  targetIpm: number;
}

export interface ApplyChainPlanInput {
  plan: ChainPlan;
  namingPrefix: string;
  defaultLinkDistanceM: number;
}

export interface ApplyChainPlanResult {
  factoryIds: string[];
  linkIds: string[];
}
