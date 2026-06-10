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

/**
 * What the planner actually consumed from a user-pinned input source.
 * Emitted only for `Factory` sources — those become logistics links on
 * apply. Node sources are parsed but ignored at the planning layer in
 * this PR (apply path doesn't yet rebind nodes).
 */
export interface ResolvedImport {
  itemId: string;
  itemName: string;
  sourceFactoryId: string;
  resolvedIpm: number;
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
  /** Factory-kind imports the planner resolved against pinned sources. */
  imports: ResolvedImport[];
  /**
   * Total demand the chain places on each pinned item (before capping).
   * Compare against `sum(imports.where(itemId).resolvedIpm)` to surface
   * "you pinned at cap 60 but the chain needs 100" warnings without the
   * planner having to error out.
   */
  pinnedDemand: Record<string, number>;
}

/**
 * User-pinned source for a single item. `Factory` cuts the chain at
 * the named item and binds a real logistics link on apply. `Node` is
 * forward-compat — declared so the React side can already emit it,
 * but treated as plain raw supply for now.
 */
export type InputSourceKind =
  | { kind: "factory"; id: string }
  | { kind: "node"; id: string };

export interface InputSource {
  itemId: string;
  source: InputSourceKind;
  /** Items-per-minute cap on this source. `undefined` ≈ unbounded. */
  ipmCap?: number;
}

export type PlannerError =
  | { kind: "unknownTarget"; itemId: string }
  | { kind: "noRecipeForTarget"; itemId: string }
  | {
      kind: "insufficient";
      missing: Record<string, number>;
      /** Per-item gap for pinned sources whose combined cap fell short. */
      imports: Record<string, number>;
    }
  | { kind: "cycleDetected"; itemId: string };

export type DeriveChainResult =
  | { kind: "ok"; plan: ChainPlan }
  | { kind: "err"; error: PlannerError };

export interface DeriveChainInput {
  targetItemId: string;
  targetIpm: number;
  /** Build the plan even with insufficient supply — pins land first, supply bound after. */
  bypassSupply?: boolean;
  /** User-pinned input sources. Omit or empty for default back-to-raw behaviour. */
  sources?: InputSource[];
  /**
   * The recipes the user has chosen for each item, keyed by item id
   * → recipe id. Omit (or set empty) for the planner's auto-pick.
   * Invalid entries are silently ignored by the Rust side.
   */
  recipes?: Record<string, string>;
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

export interface ApplyChainToFactoryInput {
  factoryId: string;
  plan: ChainPlan;
  defaultLinkDistanceM: number;
}

export interface ApplyChainToFactoryResult {
  machineIds: string[];
  linkIds: string[];
}

// ---- Production plan (graph-first designer) ----

/** "Make `ipm`/min of `itemId` in this factory." */
export interface PlanTargetSpec {
  itemId: string;
  ipm: number;
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
  | { kind: "importShort"; itemId: string; itemName: string; gapIpm: number };

export interface PlanGraph {
  nodes: PlanNode[];
  edges: PlanEdge[];
  totalMachines: number;
  totalPowerMw: number;
  rawDemand: Record<string, number>;
  warnings: PlanWarning[];
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
  recipeOverrides: Record<string, string>;
  imports: PlanImportRow[];
  layout: PlanLayoutEntry[];
}

export interface ComputePlanInput {
  targets: PlanTargetSpec[];
  imports?: PlanImportSpec[];
  recipeOverrides?: Record<string, string>;
}

export type ComputePlanResult =
  | { kind: "ok"; graph: PlanGraph }
  | { kind: "err"; error: PlannerError };

export interface SavePlanInput {
  factoryId: string;
  targets: PlanTargetSpec[];
  imports?: PlanImportSpec[];
  recipeOverrides?: Record<string, string>;
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
