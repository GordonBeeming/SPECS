export interface RecipeFlow {
  itemId: string;
  itemName: string;
  perMinute: number;
}

/** Structural failures only — supply gaps are warnings, not errors. */
export type PlannerError =
  | { kind: "unknownTarget"; itemId: string }
  | { kind: "noRecipeForTarget"; itemId: string }
  | { kind: "cycleDetected"; itemId: string };

// ---- Production plan (graph-first designer) ----

/** "Make `ipm`/min of `itemId` in this factory." `exportIpm` is the
 * slice offered to other factories; the rest stays local. */
export interface PlanTargetSpec {
  itemId: string;
  ipm: number;
  exportIpm?: number | null;
}

/**
 * "Item `itemId` arrives from elsewhere — cut the graph here."
 * `sourceFactoryId: null` is the unsourced state: the cut still
 * happens and the demand shows as an unsourced input warning.
 */
export interface PlanImportSpec {
  itemId: string;
  sourceFactoryId: string | null;
  /** Max ipm the source can spare. `null` ≈ unbounded. */
  ipmCap: number | null;
}

export interface ImportAllocation {
  sourceFactoryId: string;
  resolvedIpm: number;
}

export type PlanNode =
  | {
      kind: "recipe";
      nodeKey: string;
      itemId: string;
      itemName: string;
      recipeId: string;
      recipeName: string;
      buildingId: string;
      buildingName: string;
      machineCount: number;
      clockPct: number;
      powerMw: number;
      outputIpm: number;
      isAlt: boolean;
      isTarget: boolean;
      targetIpm: number | null;
      inputs: RecipeFlow[];
      outputs: RecipeFlow[];
    }
  | {
      kind: "raw";
      nodeKey: string;
      itemId: string;
      itemName: string;
      ipm: number;
      claimedSupplyIpm: number;
    }
  | {
      kind: "import";
      nodeKey: string;
      itemId: string;
      itemName: string;
      ipm: number;
      allocations: ImportAllocation[];
      unassignedIpm: number;
    }
  | {
      kind: "byproduct";
      nodeKey: string;
      itemId: string;
      itemName: string;
      surplusIpm: number;
      /** Fluids can't be sunk — a fluid surplus stalls the line. */
      isFluid: boolean;
    };

export interface PlanEdge {
  id: string;
  fromNode: string;
  toNode: string;
  itemId: string;
  itemName: string;
  ipm: number;
}

export type PlanWarning =
  | { kind: "rawShort"; itemId: string; itemName: string; demandIpm: number; claimedIpm: number }
  | { kind: "importUnsourced"; itemId: string; itemName: string; ipm: number }
  | { kind: "importShort"; itemId: string; itemName: string; gapIpm: number }
  | { kind: "fluidSurplus"; itemId: string; itemName: string; ipm: number }
  | { kind: "optimizerFellBack"; reason: string };

export interface PlanGraph {
  nodes: PlanNode[];
  edges: PlanEdge[];
  totalMachines: number;
  totalPowerMw: number;
  rawDemand: Record<string, number>;
  warnings: PlanWarning[];
  /** A target needs SAM, so the per-plan toggle was forced on. */
  samForced: boolean;
}

/** Per-compute knobs sent alongside the plan inputs. */
export interface PlanComputeOptions {
  /** Allow recipes whose chain needs SAM (per plan, default off). */
  includeSam: boolean;
  /** Global optimizer guard; overruns fall back to the greedy chain. */
  solverBudgetMs: number;
}

export interface PlanLayoutEntry {
  nodeKey: string;
  x: number;
  y: number;
}

/** A saved import row — spec plus its row id for map-side gestures. */
export interface PlanImportRow {
  id: string;
  itemId: string;
  sourceFactoryId: string | null;
  ipmCap: number | null;
}

/** Persisted plan inputs, as loaded by `factory_plan_get`. */
export interface FactoryPlan {
  factoryId: string;
  targets: PlanTargetSpec[];
  /** Per-plan SAM toggle, persisted with the plan. */
  includeSam: boolean;
  recipeOverrides: Record<string, string>;
  imports: PlanImportRow[];
  layout: PlanLayoutEntry[];
}

export interface ComputePlanInput {
  factoryId: string;
  targets: PlanTargetSpec[];
  imports?: PlanImportSpec[];
  recipeOverrides?: Record<string, string>;
  options?: PlanComputeOptions;
}

export type ComputePlanResult =
  | { kind: "ok"; graph: PlanGraph }
  | { kind: "err"; error: PlannerError };

export interface SavePlanInput {
  factoryId: string;
  targets: PlanTargetSpec[];
  imports?: PlanImportSpec[];
  recipeOverrides?: Record<string, string>;
  options?: PlanComputeOptions;
  defaultLinkDistanceM?: number;
}

export interface SavePlanResult {
  graph: PlanGraph;
  machineIds: string[];
  linkIds: string[];
}

/** An input still waiting on a source factory, playthrough-wide. */
export interface UnsourcedInput {
  importId: string;
  factoryId: string;
  itemId: string;
  itemName: string;
  ipmCap: number | null;
}

/** One product a factory offers for export, with current draw-down. */
export interface ExportOfferProduct {
  itemId: string;
  itemName: string;
  exportIpm: number;
  drawnIpm: number;
  /** export − drawn, floored at 0 — 0 still means "exportable". */
  remainingIpm: number;
}

export interface ExportOffer {
  factoryId: string;
  factoryName: string;
  products: ExportOfferProduct[];
}
