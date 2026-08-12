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
      /** What's left of `outputIpm` after this factory's own steps have
       * taken their share — the rate an export is actually worth
       * declaring. Same derivation as `ExportOfferProduct.spareIpm`. */
      freeOutputIpm: number;
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
  /** Alt recipes this solve leans on that the playthrough hasn't
   * collected yet, by display name, sorted. Deliberately not a
   * `PlanWarning` — the chain is sound and buildable in principle; being
   * able to build it *today* is a separate, softer fact. */
  uncollectedAlts: string[];
  /** Items this plan builds locally that another factory already makes
   * with capacity to spare — offered at the point the local copy
   * appears, instead of waiting for the Sources panel to be asked. */
  existingProducers: ExistingProducer[];
}

/** One item a plan is about to build locally that somebody else already
 * makes, with who and how much they have going spare. */
export interface ExistingProducer {
  /** The local step this is an alternative to. */
  nodeKey: string;
  itemId: string;
  itemName: string;
  /** What this plan builds locally, for the "…instead of N/min here"
   * half of the sentence. */
  localIpm: number;
  /** Sorted by spare capacity, most first. */
  sources: ExistingProducerSource[];
}

export interface ExistingProducerSource {
  factoryId: string;
  factoryName: string;
  /** `ExportOfferProduct.spareIpm` — what widening the export slice
   * alone would free up, no extra machines at the source. */
  spareIpm: number;
  /** `ExportOfferProduct.remainingIpm` — the export slice already open,
   * minus what others draw. This, not `spareIpm`, is what an uncapped
   * import from this source resolves to. */
  remainingIpm: number;
  /** Whether the source has a plan *target* for this item — the only
   * case with an export slice to open and a target to raise. An
   * intermediate's surplus is capacity as it stands. */
  hasTarget: boolean;
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
  /**
   * Earliest tier the item can be *had* once hand-gathered pickups
   * count — Wood off a tree, and the Biomass and Solid Biofuel it
   * feeds. Absent when it matches `tier`, so read it through
   * `obtainableTier` rather than on its own.
   *
   * A hand-gathered item is deliberately not a `tier`: no belt carries
   * Wood, so a factory can't be planned around it even though a
   * Biomass Burner is meant to be fed it by hand.
   */
  handGatheredTier?: number | null;
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
  /** True when the exporter has a plan target for this item; false when
   * it only makes it as an intermediate.
   *
   * This is the "can raising this exporter's target ever succeed?"
   * flag — `raise_export_target` refuses without one, deliberately,
   * since giving another factory a new product target changes what
   * that factory is. The rates can't answer this on their own: a zero
   * `producedIpm` happens to imply an intermediate today, but a
   * partial-surplus intermediate is indistinguishable from a small
   * target by its numbers alone. */
  hasTarget: boolean;
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

/** One recipe a re-optimize would swap out, named on both sides so the
 * trade can be judged without opening the factory. */
export interface RecipeSwap {
  itemId: string;
  itemName: string;
  fromRecipeId: string;
  fromRecipeName: string;
  toRecipeId: string;
  toRecipeName: string;
  /** The incoming recipe is an alt — the one a hard drive paid for. */
  toIsAlt: boolean;
}

/**
 * A standing factory whose plan would come out different if it were
 * re-optimized against the recipes reachable at the current tier.
 *
 * A saved plan holds the recipes it was saved with, so reaching a new
 * tier no longer redesigns anything on its own — this is what tells the
 * player the better plan exists. Both sides of every figure are here
 * because a prompt that only names the improvement asks them to accept
 * a redesign of machines they've already placed on faith.
 */
export interface ReplanOffer {
  factoryId: string;
  factoryName: string;
  currentMachines: number;
  currentPowerMw: number;
  reoptimizedMachines: number;
  reoptimizedPowerMw: number;
  swaps: RecipeSwap[];
}
