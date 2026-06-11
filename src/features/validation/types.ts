import type { PlanWarning } from "@/features/planner/types";

export type Severity = "error" | "warning";

export type Category = "tierGating" | "lockedAlts" | "flow" | "supplyPower";

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
