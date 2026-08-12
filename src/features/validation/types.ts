import type { PlanWarning } from "@/features/planner/types";
import type { Purity } from "@/features/resources/types";

/** `info` is a finding with nothing to fix — a hand-fed Biomass Burner
 * works exactly as intended, and no claim will ever cover its Wood. It
 * stays out of the error and warning counts and renders quietly. */
export type Severity = "error" | "warning" | "info";

export type Category = "tierGating" | "lockedAlts" | "flow" | "supplyPower" | "capacity";

/** Mirrors the Rust `FindingKind` tagged enum (`kind` discriminator). */
export type FindingKind =
  | {
      kind: "machineRecipeAboveTier";
      factoryId: string;
      factoryName: string;
      recipeId: string;
      recipeName: string;
      unlockTier: number;
    }
  | {
      kind: "machineBuildingAboveTier";
      factoryId: string;
      factoryName: string;
      buildingId: string;
      buildingName: string;
      unlockTier: number;
    }
  | {
      kind: "planRecipeAboveTier";
      factoryId: string;
      factoryName: string;
      recipeId: string;
      recipeName: string;
      unlockTier: number;
    }
  | {
      kind: "planDoesNotCompute";
      factoryId: string;
      factoryName: string;
      reason: string;
    }
  | {
      kind: "claimExtractorAboveTier";
      nodeId: string;
      resourceItemName: string;
      extractorId: string;
      extractorName: string;
      unlockTier: number;
    }
  | {
      kind: "claimInvalidExtractor";
      nodeId: string;
      resourceItemName: string;
      extractorId: string;
      allowedNames: string[];
    }
  | {
      kind: "unlockedAltAboveTier";
      recipeId: string;
      recipeName: string;
      unlockTier: number;
    }
  | {
      kind: "linkTransportAboveTier";
      linkId: string;
      fromFactoryName: string;
      toFactoryName: string;
      itemName: string;
      transportKind: string;
      minUnlockTier: number;
    }
  | {
      kind: "lockedAltInUse";
      factoryId: string;
      factoryName: string;
      recipeId: string;
      recipeName: string;
      inPlan: boolean;
      inMachines: boolean;
    }
  | {
      kind: "linkOverdraw";
      fromFactoryId: string;
      fromFactoryName: string;
      itemId: string;
      itemName: string;
      drawnIpm: number;
      availableIpm: number;
    }
  | {
      kind: "linkSourceMissingProduct";
      linkId: string;
      fromFactoryId: string;
      fromFactoryName: string;
      toFactoryName: string;
      itemId: string;
      itemName: string;
    }
  | {
      kind: "planIssue";
      factoryId: string;
      factoryName: string;
      warning: PlanWarning;
    }
  | {
      kind: "powerDeficit";
      factoryId: string;
      factoryName: string;
      netMw: number;
    }
  | { kind: "gridDeficit"; generatedMw: number; consumedMw: number }
  | {
      kind: "generatorFuelShort";
      factoryId: string;
      factoryName: string;
      itemId: string;
      itemName: string;
      demandIpm: number;
      claimedIpm: number;
    }
  | {
      kind: "generatorFuelHandGathered";
      factoryId: string;
      factoryName: string;
      itemId: string;
      itemName: string;
      demandIpm: number;
    }
  | {
      /** One machine of a bank pushes more through its single output
       * port than a belt/pipe carries. The same wall as
       * `claimOverPortCapacity` one layer in, so it warns rather than
       * notes: parallel belts don't help, but a lower clock or more
       * machines do, and the app reads both as fixed. */
      kind: "machineOverPortCapacity";
      factoryId: string;
      factoryName: string;
      nodeKey: string;
      recipeName: string;
      buildingName: string;
      itemId: string;
      itemName: string;
      machineCount: number;
      perMachineIpm: number;
      capacityIpm: number;
      capacityMark: number;
      isFluid: boolean;
      maxFittingClockPct: number;
      machinesNeeded: number;
    }
  | {
      kind: "segmentOverBeltCapacity";
      factoryId: string;
      factoryName: string;
      itemId: string;
      itemName: string;
      ipm: number;
      beltMark: number;
      beltCapacityIpm: number;
      beltsNeeded: number;
    }
  | {
      kind: "segmentOverPipeCapacity";
      factoryId: string;
      factoryName: string;
      itemId: string;
      itemName: string;
      ipm: number;
      pipeMark: number;
      pipeCapacityIpm: number;
      pipesNeeded: number;
    }
  | {
      kind: "fluidSegmentNoPipeAtTier";
      factoryId: string;
      factoryName: string;
      itemId: string;
      itemName: string;
      ipm: number;
    }
  | {
      kind: "claimOverPortCapacity";
      nodeId: string;
      resourceItemName: string;
      /** Position within this node's (resource, purity) bucket — pairs
       * with `nodePurity` and `nodeX`/`nodeY` to reproduce the Resources
       * screen's "#P1 · 1.7km W · 1.5km N" label. */
      nodeIndex: number;
      nodePurity: Purity;
      nodeX: number;
      nodeY: number;
      extractorName: string;
      outputIpm: number;
      capacityIpm: number;
      isFluid: boolean;
      capacityMark: number;
      maxFittingClockPct: number;
    }
  | {
      kind: "checkFailed";
      area: string;
      factoryName?: string | null;
      reason: string;
    };

export type Finding = FindingKind & {
  severity: Severity;
  category: Category;
};

export interface FactoryRef {
  factoryId: string;
  factoryName: string;
}

export interface AltToUnlock {
  recipeId: string;
  recipeName: string;
  unlockTier: number;
  wantedBy: FactoryRef[];
}

export interface GridSummary {
  generatedMw: number;
  consumedMw: number;
  netMw: number;
}

export interface ValidationReport {
  currentTier: number;
  findings: Finding[];
  altShoppingList: AltToUnlock[];
  grid: GridSummary;
  checkedAt: string;
}
