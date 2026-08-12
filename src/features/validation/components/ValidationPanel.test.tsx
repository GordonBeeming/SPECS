import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ValidationPanel } from "./ValidationPanel";
import { validationApi } from "../api";
import { playthroughApi } from "@/features/playthrough/api";
import { useNavStore } from "@/shared/nav-store";
import { nodeDisplayLabel } from "@/features/resources/display";
import type { ValidationReport } from "../types";

const cleanReport: ValidationReport = {
  currentTier: 4,
  findings: [],
  altShoppingList: [],
  grid: { generatedMw: 100, consumedMw: 60, netMw: 40 },
  checkedAt: "2026-06-11T00:00:00Z",
};

const messyReport: ValidationReport = {
  currentTier: 2,
  findings: [
    {
      severity: "error",
      category: "tierGating",
      kind: "machineRecipeAboveTier",
      factoryId: "f1",
      factoryName: "Compute Hall",
      recipeId: "Recipe_Computer_C",
      recipeName: "Computer",
      unlockTier: 6,
    },
    {
      severity: "error",
      category: "flow",
      kind: "linkOverdraw",
      fromFactoryId: "f2",
      fromFactoryName: "Plate Source",
      itemId: "Desc_IronPlate_C",
      itemName: "Iron Plate",
      drawnIpm: 25,
      availableIpm: 10,
    },
    {
      severity: "warning",
      category: "lockedAlts",
      kind: "lockedAltInUse",
      factoryId: "f1",
      factoryName: "Compute Hall",
      recipeId: "Recipe_Alternate_Computer_1_C",
      recipeName: "Crystal Computer",
      inPlan: true,
      inMachines: false,
    },
  ],
  altShoppingList: [
    {
      recipeId: "Recipe_Alternate_Computer_1_C",
      recipeName: "Crystal Computer",
      unlockTier: 2,
      wantedBy: [{ factoryId: "f1", factoryName: "Compute Hall" }],
    },
  ],
  grid: { generatedMw: 30, consumedMw: 90, netMw: -60 },
  checkedAt: "2026-06-11T00:00:00Z",
};

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  useNavStore.setState({ pendingFactoryId: null, pendingRoute: null });
  // useValidation now gates on an open playthrough (the sweep is
  // playthrough-scoped), so every test needs one in the cache.
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p", displayName: "Run", gameVersion: "1.2",
    createdAt: "2026-06-10T00:00:00Z", currentTier: 4, currentMilestoneProgress: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<ValidationPanel />", () => {
  it("shows the all-clear state when the sweep finds nothing", async () => {
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanReport);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(
      await screen.findByText(/No findings — everything checks out at T4/),
    ).toBeInTheDocument();
    expect(screen.getByText(/100 MW gen \/ 60 MW draw/)).toBeInTheDocument();
  });

  it("keeps a hand-fed burner out of the warning count and still says it needs feeding", async () => {
    // A Tier 0 playthrough's only generator burns Wood, which has no
    // node to claim — the player must be told the burner is hungry
    // without being told they have a shortfall to close.
    const report: ValidationReport = {
      currentTier: 0,
      findings: [
        {
          severity: "info",
          category: "supplyPower",
          kind: "generatorFuelHandGathered",
          factoryId: "f1",
          factoryName: "Iron Works",
          itemId: "Desc_Wood_C",
          itemName: "Wood",
          demandIpm: 18,
        },
      ],
      altShoppingList: [],
      grid: { generatedMw: 60, consumedMw: 49, netMw: 11 },
      checkedAt: "2026-06-11T00:00:00Z",
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);

    expect(await screen.findByText("0 errors")).toBeInTheDocument();
    expect(screen.getByText("0 warnings")).toBeInTheDocument();
    expect(screen.getByText("1 note")).toBeInTheDocument();
    // The all-clear survives: nothing here is a problem.
    expect(screen.getByText(/Nothing to fix at T0/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /generators burn 18\.0\/min of Wood — every route to it starts with hand-gathered pickups, so no build removes the gathering$/,
      ),
    ).toBeInTheDocument();
  });

  it("never tells the player to hand-feed a fluid", async () => {
    // Liquid Biofuel earns the same note as Wood — its chain grounds
    // out in pickups too — but it reaches the generator through a pipe,
    // so a row about feeding it by hand asks for something impossible.
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "info",
          category: "supplyPower",
          kind: "generatorFuelHandGathered",
          factoryId: "f1",
          factoryName: "Biofuel Plant",
          itemId: "Desc_LiquidBiofuel_C",
          itemName: "Liquid Biofuel",
          demandIpm: 270,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);

    const row = await screen.findByText(
      /Biofuel Plant: generators burn 270\.0\/min of Liquid Biofuel — every route to it starts with hand-gathered pickups, so no build removes the gathering$/,
    );
    expect(row.textContent).not.toMatch(/fed by hand|hand-feed|no belt/);
    expect(screen.getByText("0 warnings")).toBeInTheDocument();
    expect(screen.getByText("1 note")).toBeInTheDocument();
  });

  it("groups findings by category with severity counts and the alt shopping list", async () => {
    vi.spyOn(validationApi, "validate").mockResolvedValue(messyReport);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(await screen.findByText("2 errors")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(screen.getByText("Above your tier")).toBeInTheDocument();
    expect(screen.getByText("Cross-factory flows")).toBeInTheDocument();
    expect(
      screen.getByText(/Compute Hall: machines run Computer \(unlocks T6\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/links draw 25\.0\/min of Iron Plate, exports cover 10\.0/),
    ).toBeInTheDocument();
    // The shopping list rolls the locked alt up with its wanters.
    expect(screen.getByText("Hard drives to collect")).toBeInTheDocument();
    expect(screen.getByText("Crystal Computer")).toBeInTheDocument();
  });

  it("deep-links a tier finding to its factory's plan and closes the panel", async () => {
    vi.spyOn(validationApi, "validate").mockResolvedValue(messyReport);
    const onClose = vi.fn();
    renderWithProviders(<ValidationPanel onClose={onClose} />);
    const row = await screen.findByText(/machines run Computer/);
    fireEvent.click(row.closest("button")!);
    await waitFor(() => {
      expect(useNavStore.getState().pendingFactoryId).toBe("f1");
      // Machine-tier findings now open the plan designer, not the old detail pane.
      expect(useNavStore.getState().pendingRoute).toBe("plan");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("surfaces a failed sweep as an alert", async () => {
    vi.spyOn(validationApi, "validate").mockRejectedValue(new Error("no active playthrough"));
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/no active playthrough/);
  });

  it("shows an above-tier unlocked alt as a warning and deep-links to the Alts screen", async () => {
    // Regression for #47: ticking a T7 alt at T0 must not read as clean.
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "warning",
          category: "tierGating",
          kind: "unlockedAltAboveTier",
          recipeId: "Recipe_Alternate_AlcladCasing_C",
          recipeName: "Alternate: Alclad Casing",
          unlockTier: 7,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    const onClose = vi.fn();
    renderWithProviders(<ValidationPanel onClose={onClose} />);
    expect(await screen.findByText("1 warning")).toBeInTheDocument();
    const row = screen.getByText(
      /Alternate: Alclad Casing is ticked unlocked but unlocks at T7/,
    );
    expect(row).toBeInTheDocument();
    fireEvent.click(row.closest("button")!);
    await waitFor(() => {
      expect(useNavStore.getState().pendingRoute).toBe("alts");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows a generator fuel shortfall and deep-links to Power", async () => {
    // Regression: a coal generator bank's fuel/water draw never got
    // checked against claimed supply — this is the wired-up finding.
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "warning",
          category: "supplyPower",
          kind: "generatorFuelShort",
          factoryId: "f1",
          factoryName: "Coal Power",
          itemId: "Desc_Coal_C",
          itemName: "Coal",
          demandIpm: 210,
          claimedIpm: 180,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    const onClose = vi.fn();
    renderWithProviders(<ValidationPanel onClose={onClose} />);
    const row = await screen.findByText(
      /Coal Power: generators need 210\.0\/min of Coal, claims cover 180\.0/,
    );
    fireEvent.click(row.closest("button")!);
    await waitFor(() => {
      expect(useNavStore.getState().pendingRoute).toBe("power");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows a belt-capacity note and a no-pipe-yet warning under a dedicated category", async () => {
    // Regression for #48/#76: a plan-graph segment over the best
    // unlocked belt/pipe tier used to render identically to a
    // compliant one. The two land at different severities on purpose —
    // parallel belts carry the aggregate rate and the segment still
    // reads it afterwards, while "no pipe yet" clears at Tier 3.
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "info",
          category: "capacity",
          kind: "segmentOverBeltCapacity",
          factoryId: "f1",
          factoryName: "Ingot Works",
          itemId: "Desc_OreIron_C",
          itemName: "Iron Ore",
          ipm: 90,
          beltMark: 1,
          beltCapacityIpm: 60,
          beltsNeeded: 2,
        },
        {
          severity: "warning",
          category: "capacity",
          kind: "fluidSegmentNoPipeAtTier",
          factoryId: "f1",
          factoryName: "Ingot Works",
          itemId: "Desc_Water_C",
          itemName: "Water",
          ipm: 30,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(await screen.findByText("Belt & pipe capacity")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ingot Works: Iron Ore segment runs 90\.0\/min — needs 2 belts at Mk\.1 \(60\/min each\)$/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ingot Works: Water segment runs 30\.0 m³\/min — no pipe is unlocked yet/),
    ).toBeInTheDocument();
    // The counts are the contract: the belt row must not land in the
    // warning tally it can never be cleared from.
    expect(screen.getByText("0 errors")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(screen.getByText("1 note")).toBeInTheDocument();
  });

  it("counts a machine over its own output port as a warning and offers the clock, not belts", async () => {
    // The reported repro: one Constructor on Steel Screws at 225/min
    // against a 120/min Mk.2 belt. There is one output port, so the
    // "needs 2 belts" phrasing describes a build nobody can lay, and a
    // note would let a plan that cannot be built pass a clean sweep.
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "warning",
          category: "capacity",
          kind: "machineOverPortCapacity",
          factoryId: "f1",
          factoryName: "Iron Works",
          nodeKey: "recipe:Desc_IronScrew_C",
          recipeName: "Alternate: Steel Screws",
          buildingName: "Constructor",
          itemId: "Desc_IronScrew_C",
          itemName: "Screws",
          machineCount: 1,
          perMachineIpm: 225,
          capacityIpm: 120,
          capacityMark: 2,
          isFluid: false,
          maxFittingClockPct: 46.153846,
          machinesNeeded: 2,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    const onClose = vi.fn();
    renderWithProviders(<ValidationPanel onClose={onClose} />);
    const row = await screen.findByText(
      /Iron Works: each Constructor on Alternate: Steel Screws pushes 225\.0\/min of Screws through one output port, over the Mk\.2 belt's 120\.0\/min — clock to 46% or spread the bank over 2 machines$/,
    );
    // Floored, never rounded: 47% still overshoots the port.
    expect(row.textContent).not.toMatch(/clock to 47%/);
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ notes?$/)).not.toBeInTheDocument();

    fireEvent.click(row.closest("button")!);
    await waitFor(() => {
      expect(useNavStore.getState().pendingRoute).toBe("plan");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("counts an over-capacity pipe segment as a note too", async () => {
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "info",
          category: "capacity",
          kind: "segmentOverPipeCapacity",
          factoryId: "f1",
          factoryName: "Refinery",
          itemId: "Desc_Water_C",
          itemName: "Water",
          ipm: 630,
          pipeMark: 1,
          pipeCapacityIpm: 300,
          pipesNeeded: 3,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(
      await screen.findByText(
        /Refinery: Water segment runs 630\.0 m³\/min — needs 3 pipe headers at Mk\.1 \(300 m³\/min each\)$/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("0 warnings")).toBeInTheDocument();
    expect(screen.getByText("1 note")).toBeInTheDocument();
  });

  it("shows a port-over-capacity claim with the fitting clock, the node label, and deep-links to Resources", async () => {
    // Regression for #93: this finding used to render as a blank row —
    // no TS union member, no findingText case.
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "warning",
          category: "capacity",
          kind: "claimOverPortCapacity",
          nodeId: "n1",
          resourceItemName: "Pure Iron Ore",
          nodeIndex: 5,
          nodePurity: "Pure",
          nodeX: -170000,
          nodeY: -150000,
          extractorName: "Miner Mk.2",
          outputIpm: 240,
          capacityIpm: 60,
          isFluid: false,
          capacityMark: 1,
          maxFittingClockPct: 25,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    const onClose = vi.fn();
    renderWithProviders(<ValidationPanel onClose={onClose} />);
    const row = await screen.findByText(
      /Pure Iron Ore node #P6 · 1\.7km W · 1\.5km N: Miner Mk\.2 outputs 240\.0\/min — its port caps at 60\.0\/min \(Mk\.1 belt\), clock to 25% to fit/,
    );
    fireEvent.click(row.closest("button")!);
    await waitFor(() => {
      expect(useNavStore.getState().pendingRoute).toBe("resources");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("floors the advised clock instead of rounding it up (#101)", async () => {
    // The reported loop: a Miner Mk.3 on Pure Raw Quartz at 250% needs
    // 780/1200 × 250% = 162.5% to fit exactly. `toFixed(0)` used to
    // round that to 163%, which still overshoots the port (782.4/min)
    // and repeats the identical warning — the Tier 1 case above (25%)
    // divides evenly and would pass either way, so it never caught this.
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "warning",
          category: "capacity",
          kind: "claimOverPortCapacity",
          nodeId: "n2",
          resourceItemName: "Pure Raw Quartz",
          nodeIndex: 0,
          nodePurity: "Pure",
          nodeX: 37926,
          nodeY: 120939,
          extractorName: "Miner Mk.3",
          outputIpm: 1200,
          capacityIpm: 780,
          isFluid: false,
          capacityMark: 5,
          maxFittingClockPct: 162.5,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(
      await screen.findByText(/clock to 162% to fit/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/clock to 163% to fit/)).not.toBeInTheDocument();
  });

  it("names a node exactly as the Resources row does, purity initial included", async () => {
    // The node index restarts at 1 within each purity, so `#1` alone
    // names either a Pure or a Normal node. Resources rows carry the
    // initial (`#N1`); this panel used to build its own `#${index + 1}`,
    // so the same node read `#1` here and `#N1` there — two labels, one
    // node, and no way to tell they matched.
    const nodeX = -170000;
    const nodeY = -150000;
    const report: ValidationReport = {
      ...cleanReport,
      findings: [
        {
          severity: "warning",
          category: "capacity",
          kind: "claimOverPortCapacity",
          nodeId: "n3",
          resourceItemName: "Iron Ore",
          nodeIndex: 0,
          nodePurity: "Normal",
          nodeX,
          nodeY,
          extractorName: "Miner Mk.1",
          outputIpm: 120,
          capacityIpm: 60,
          isFluid: false,
          capacityMark: 1,
          maxFittingClockPct: 50,
        },
      ],
    };
    vi.spyOn(validationApi, "validate").mockResolvedValue(report);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    const rowLabel = nodeDisplayLabel({ x: nodeX, y: nodeY, purity: "Normal" }, 0);
    expect(rowLabel).toContain("#N1");
    expect(
      await screen.findByText(new RegExp(`Iron Ore node ${escapeRegExp(rowLabel)}:`)),
    ).toBeInTheDocument();
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
