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
