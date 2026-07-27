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
  /** Byproduct fed back into the chain — rendered distinctly. */
  isReuse: boolean;
}

export type PlanWarning =
  | { kind: "rawShort"; itemId: string; itemName: string; demandIpm: number; claimedIpm: number }
  | { kind: "importUnsourced"; itemId: string; itemName: string; ipm: number }
  | { kind: "importShort"; itemId: string; itemName: string; gapIpm: number }
  | { kind: "fluidSurplus"; itemId: string; itemName: string; ipm: number }
  | { kind: "optimizerFellBack"; reason: string }
  | {
      kind: "aboveTier";
      currentTier: number;
      /** Highest tier any above-tier step needs. */
      requiredTier: number;
      /** Item faces of the steps that are out of reach. */
      itemNames: string[];
    }
  | { kind: "targetUnplannable"; itemId: string; itemName: string; reason: string };

export interface PlanGraph {
  nodes: PlanNode[];
  edges: PlanEdge[];
  totalMachines: number;
  /** Machines plus the factory's bound extractors — the extractors
   * aren't graph nodes, so `totalMachines` alone can't account for it. */
  totalPowerMw: number;
  /** Extractors claimed for this factory, folded into `totalPowerMw`. */
  extractorCount: number;
  /** The extractors' share of `totalPowerMw`. */
  extractorPowerMw: number;
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
}

export interface SavePlanResult {
  graph: PlanGraph;
  machineIds: string[];
  linkIds: string[];
}

/**
 * The earliest tier an item is really reachable at — its whole input
 * chain, not the stamp on one recipe. A recipe's own unlock tier says
 * nothing about whether its ingredients exist yet, which is how a Tier 7
 * chain ended up offered under a Tier 5 heading.
 */
export interface ItemTier {
  itemId: string;
  /** With alts counted as available at their own unlock tier — the same
   * rule the planner plans by. */
  tier: number | null;
  /** Standard recipes only; `null` when the item is alt-only. */
  standardTier: number | null;
}

/** An input still waiting on a source factory, playthrough-wide. */
export interface UnsourcedInput {
  importId: string;
  factoryId: string;
  itemId: string;
  itemName: string;
  ipmCap: number | null;
}

/**
 * One product a factory makes for others to take, with current
 * draw-down. A factory that produces the item and has never declared an
 * export slice is still an offer: the slice is one click away, and
 * hiding those is what made a plant with 60/min spare read as "not
 * exporting this".
 */
export interface ExportOfferProduct {
  itemId: string;
  itemName: string;
  /** The target's rate — the ceiling on what any export slice could
   * offer, since the factory's own steps have already taken theirs. */
  producedIpm: number;
  exportIpm: number;
  drawnIpm: number;
  /** export − drawn, floored at 0 — 0 still means "exportable". */
  remainingIpm: number;
  /** produced − drawn, floored at 0: what opening the export slice
   * alone would free up, with no extra machines. Always ≥ remaining. */
  spareIpm: number;
}

export interface ExportOffer {
  factoryId: string;
  factoryName: string;
  products: ExportOfferProduct[];
}

/**
 * What raising an exporter's target did — the numbers that moved, and
 * what it cost that factory's own plan.
 *
 * The two warning lists are a diff, not the exporter's whole warning
 * list, and they're separate because they read as different sentences.
 * A factory that was already short on ore didn't break because of this
 * raise; the same shortfall widening is worth saying, as "widened".
 */
export interface RaiseExportTargetResult {
  factoryId: string;
  factoryName: string;
  itemId: string;
  itemName: string;
  previousTargetIpm: number;
  newTargetIpm: number;
  previousExportIpm: number;
  newExportIpm: number;
  /** Export slice minus what other factories already draw. */
  remainingIpm: number;
  /** Findings that weren't there before this raise. Reported, never
   * actioned — closing one is the user's call. */
  introducedWarnings: PlanWarning[];
  /** Findings that were already open and got bigger. */
  worsenedWarnings: PlanWarning[];
}
