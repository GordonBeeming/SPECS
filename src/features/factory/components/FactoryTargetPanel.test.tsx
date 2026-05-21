import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { FactoryTargetPanel } from "./FactoryTargetPanel";
import { libraryApi } from "@/features/library/api";
import { playthroughApi } from "@/features/playthrough/api";
import { resourcesApi } from "@/features/resources/api";
import { factoryApi } from "../api";
import { plannerApi } from "@/features/planner/api";
import type {
  ChainPlan,
  DeriveChainResult,
} from "@/features/planner/types";

const items = [
  { id: "Desc_IronPlate_C", name: "Iron Plate", category: "part" as const, unlockTier: 0 },
  { id: "Desc_IronIngot_C", name: "Iron Ingot", category: "part" as const, unlockTier: 0 },
  { id: "Desc_ModularFrame_C", name: "Modular Frame", category: "part" as const, unlockTier: 1 },
  { id: "Desc_OreIron_C", name: "Iron Ore", category: "raw" as const, unlockTier: 0 },
];

const recipes = [
  {
    id: "Recipe_IngotIron_C", name: "Iron Ingot",
    buildingId: "Desc_SmelterMk1_C", isAlt: false, unlockTier: 0, cycleSeconds: 2,
    inputs: [{ itemId: "Desc_OreIron_C", perMinute: 30 }],
    outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 30 }],
  },
  {
    id: "Recipe_IronPlate_C", name: "Iron Plate",
    buildingId: "Desc_ConstructorMk1_C", isAlt: false, unlockTier: 0, cycleSeconds: 6,
    inputs: [{ itemId: "Desc_IronIngot_C", perMinute: 30 }],
    outputs: [{ itemId: "Desc_IronPlate_C", perMinute: 20 }],
  },
  {
    id: "Recipe_ModularFrame_C", name: "Modular Frame",
    buildingId: "Desc_AssemblerMk1_C", isAlt: false, unlockTier: 1, cycleSeconds: 60,
    inputs: [
      { itemId: "Desc_IronPlate_C", perMinute: 12 },
      { itemId: "Desc_IronRod_C", perMinute: 12 },
    ],
    outputs: [{ itemId: "Desc_ModularFrame_C", perMinute: 2 }],
  },
];

const factories = [
  {
    id: "fac-frames",
    name: "Frames v1",
    color: null, notes: null, iconId: null,
    createdAt: "2026-05-21T00:00:00Z", updatedAt: "2026-05-21T00:00:00Z",
  },
  {
    id: "fac-plates",
    name: "Plates v1",
    color: null, notes: null, iconId: null,
    createdAt: "2026-05-21T00:00:00Z", updatedAt: "2026-05-21T00:00:00Z",
  },
];

const okPlan: ChainPlan = {
  targetItemId: "Desc_ModularFrame_C",
  targetItemName: "Modular Frame",
  targetIpm: 30,
  stages: [
    {
      recipeId: "Recipe_IngotIron_C",
      recipeName: "Iron Ingot",
      buildingId: "Desc_SmelterMk1_C",
      buildingName: "Smelter",
      outputItemId: "Desc_IronIngot_C",
      outputIpm: 180,
      machineCount: 6,
      clockPct: 100,
      inputs: [{ itemId: "Desc_OreIron_C", itemName: "Iron Ore", perMinute: 180 }],
      outputs: [{ itemId: "Desc_IronIngot_C", itemName: "Iron Ingot", perMinute: 180 }],
      isAlt: false, powerMw: 24,
    },
    {
      recipeId: "Recipe_IronPlate_C",
      recipeName: "Iron Plate",
      buildingId: "Desc_ConstructorMk1_C",
      buildingName: "Constructor",
      outputItemId: "Desc_IronPlate_C",
      outputIpm: 180,
      machineCount: 9,
      clockPct: 100,
      inputs: [{ itemId: "Desc_IronIngot_C", itemName: "Iron Ingot", perMinute: 180 }],
      outputs: [{ itemId: "Desc_IronPlate_C", itemName: "Iron Plate", perMinute: 180 }],
      isAlt: false, powerMw: 36,
    },
    {
      recipeId: "Recipe_ModularFrame_C",
      recipeName: "Modular Frame",
      buildingId: "Desc_AssemblerMk1_C",
      buildingName: "Assembler",
      outputItemId: "Desc_ModularFrame_C",
      outputIpm: 30,
      machineCount: 15,
      clockPct: 100,
      inputs: [
        { itemId: "Desc_IronPlate_C", itemName: "Iron Plate", perMinute: 180 },
        { itemId: "Desc_IronRod_C", itemName: "Iron Rod", perMinute: 180 },
      ],
      outputs: [{ itemId: "Desc_ModularFrame_C", itemName: "Modular Frame", perMinute: 30 }],
      isAlt: false, powerMw: 225,
    },
  ],
  totalMachines: 30,
  totalPowerMw: 285,
  rawDemand: { Desc_OreIron_C: 180 },
  imports: [],
};

const plannedWithImport: ChainPlan = {
  ...okPlan,
  stages: okPlan.stages.filter((s) => s.outputItemId !== "Desc_IronPlate_C"),
  imports: [
    {
      itemId: "Desc_IronPlate_C",
      itemName: "Iron Plate",
      sourceFactoryId: "fac-plates",
      resolvedIpm: 180,
    },
  ],
  totalMachines: 21,
};

beforeEach(() => {
  vi.spyOn(libraryApi, "items").mockResolvedValue(items);
  vi.spyOn(libraryApi, "recipes").mockResolvedValue(recipes);
  vi.spyOn(libraryApi, "buildings").mockResolvedValue([]);
  vi.spyOn(factoryApi, "list").mockResolvedValue(factories);
  vi.spyOn(resourcesApi, "list").mockResolvedValue([]);
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p", displayName: "Run", gameVersion: "1.1",
    createdAt: "2026-05-21T00:00:00Z", currentTier: 9, currentMilestoneProgress: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

async function pickModularFrameTarget(user: ReturnType<typeof userEvent.setup>) {
  const combobox = await screen.findByRole("combobox");
  await user.click(combobox);
  await user.keyboard("{ArrowDown}");
  const option = await screen.findByRole("option", { name: /Modular Frame/i });
  await user.click(option);
}

describe("<FactoryTargetPanel />", () => {
  it("derives a chain for the configured target", async () => {
    const deriveSpy = vi
      .spyOn(plannerApi, "derive")
      .mockResolvedValue({ kind: "ok", plan: okPlan } satisfies DeriveChainResult);
    const user = userEvent.setup();
    renderWithProviders(
      <FactoryTargetPanel factoryId="fac-frames" onClose={() => {}} />,
    );
    await pickModularFrameTarget(user);
    await user.click(screen.getByRole("button", { name: /Derive/i }));
    await waitFor(() => {
      expect(deriveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          targetItemId: "Desc_ModularFrame_C",
          targetIpm: 60,
          sources: [],
        }),
      );
    });
    expect(await screen.findByText(/Items, Input/)).toBeInTheDocument();
    // Iron Plate appears in both the Items, Input list (intermediate
    // item the user could pin) and the preview's stage list. Use
    // getAllByText so multiple matches don't error.
    expect(screen.getAllByText(/Iron Plate/).length).toBeGreaterThan(0);
  });

  it("re-derives with sources when a pin is added", async () => {
    const deriveSpy = vi
      .spyOn(plannerApi, "derive")
      .mockResolvedValueOnce({ kind: "ok", plan: okPlan } satisfies DeriveChainResult)
      .mockResolvedValueOnce({ kind: "ok", plan: plannedWithImport } satisfies DeriveChainResult);
    const user = userEvent.setup();
    renderWithProviders(
      <FactoryTargetPanel factoryId="fac-frames" onClose={() => {}} />,
    );
    await pickModularFrameTarget(user);
    await user.click(screen.getByRole("button", { name: /Derive/i }));
    await waitFor(() => expect(deriveSpy).toHaveBeenCalledTimes(1));

    // Add a pin source for Iron Plate. The "+ Pin source" button lands
    // inside the Iron Plate row in the Items, Input list.
    const pinButtons = await screen.findAllByRole("button", { name: /Pin source/i });
    await user.click(pinButtons[0]);
    // The factory FilterSelect appears; pick fac-plates.
    const sourceCombo = await screen.findByRole("combobox", {
      name: /Source factory/i,
    });
    await user.click(sourceCombo);
    await user.keyboard("{ArrowDown}");
    const plateOption = await screen.findByRole("option", { name: /Plates v1/i });
    await user.click(plateOption);

    await waitFor(() => expect(deriveSpy).toHaveBeenCalledTimes(2));
    expect(deriveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            source: { kind: "factory", id: "fac-plates" },
          }),
        ]),
      }),
    );
  });

  it("surfaces import shortfall when the planner returns Insufficient::imports", async () => {
    vi.spyOn(plannerApi, "derive").mockResolvedValue({
      kind: "err",
      error: {
        kind: "insufficient",
        missing: {},
        imports: { Desc_IronPlate_C: 12.5 },
      },
    } satisfies DeriveChainResult);
    const user = userEvent.setup();
    renderWithProviders(
      <FactoryTargetPanel factoryId="fac-frames" onClose={() => {}} />,
    );
    await pickModularFrameTarget(user);
    await user.click(screen.getByRole("button", { name: /Derive/i }));
    expect(await screen.findByText(/pinned source short 12.5/)).toBeInTheDocument();
  });

  it("calls applyToFactory with the resolved plan on Apply", async () => {
    vi.spyOn(plannerApi, "derive").mockResolvedValue({
      kind: "ok",
      plan: okPlan,
    } satisfies DeriveChainResult);
    const applySpy = vi
      .spyOn(plannerApi, "applyToFactory")
      .mockResolvedValue({ machineIds: ["m1", "m2", "m3"], linkIds: [] });
    const user = userEvent.setup();
    renderWithProviders(
      <FactoryTargetPanel factoryId="fac-frames" onClose={() => {}} />,
    );
    await pickModularFrameTarget(user);
    await user.click(screen.getByRole("button", { name: /Derive/i }));
    const applyBtn = await screen.findByRole("button", {
      name: /Apply to this factory/i,
    });
    await user.click(applyBtn);
    await waitFor(() => {
      expect(applySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          factoryId: "fac-frames",
          plan: okPlan,
        }),
      );
    });
    expect(await screen.findByText(/Added 3 machines/)).toBeInTheDocument();
  });
});
