import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChainPreview } from "./ChainPreview";
import type { ChainPlan } from "../types";

function plan(overrides: Partial<ChainPlan> = {}): ChainPlan {
  return {
    targetItemId: "Desc_IronPlate_C",
    targetItemName: "Iron Plate",
    targetIpm: 45,
    stages: [
      {
        recipeId: "Recipe_IngotIron_C",
        recipeName: "Iron Ingot",
        buildingId: "Desc_SmelterMk1_C",
        buildingName: "Smelter",
        outputItemId: "Desc_IronIngot_C",
        outputIpm: 45,
        machineCount: 2,
        clockPct: 75,
        inputs: [
          { itemId: "Desc_OreIron_C", itemName: "Iron Ore", perMinute: 45 },
        ],
        outputs: [
          { itemId: "Desc_IronIngot_C", itemName: "Iron Ingot", perMinute: 45 },
        ],
        isAlt: false,
        powerMw: 6,
      },
      {
        recipeId: "Recipe_IronPlate_C",
        recipeName: "Iron Plate",
        buildingId: "Desc_ConstructorMk1_C",
        buildingName: "Constructor",
        outputItemId: "Desc_IronPlate_C",
        outputIpm: 45,
        machineCount: 3,
        clockPct: 100,
        inputs: [
          { itemId: "Desc_IronIngot_C", itemName: "Iron Ingot", perMinute: 45 },
        ],
        outputs: [
          { itemId: "Desc_IronPlate_C", itemName: "Iron Plate", perMinute: 45 },
        ],
        isAlt: false,
        powerMw: 12,
      },
    ],
    totalMachines: 5,
    totalPowerMw: 18,
    rawDemand: { Desc_OreIron_C: 45 },
    imports: [],
    ...overrides,
  };
}

describe("<ChainPreview />", () => {
  it("renders one row per stage", () => {
    render(<ChainPreview plan={plan()} />);
    // Stage recipe names appear in their stage row's header and may
    // recur in upstream stages' `out` lists — getAllByText accepts both.
    expect(screen.getAllByText("Iron Ingot").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Iron Plate").length).toBeGreaterThanOrEqual(1);
    // Two stages → two clock-percent badges.
    expect(screen.getByText(/75%/)).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it("shows the Imports strip only when imports exist", () => {
    const { rerender } = render(<ChainPreview plan={plan()} />);
    expect(screen.queryByText("Imports")).not.toBeInTheDocument();

    rerender(
      <ChainPreview
        plan={plan({
          imports: [
            {
              itemId: "Desc_IronPlate_C",
              itemName: "Iron Plate",
              sourceFactoryId: "fac-plates-v1",
              resolvedIpm: 30,
            },
          ],
        })}
        factoryName={(id) => (id === "fac-plates-v1" ? "Plates v1" : undefined)}
      />,
    );
    expect(screen.getByText("Imports")).toBeInTheDocument();
    expect(screen.getByText("Plates v1")).toBeInTheDocument();
    expect(screen.getByText("30.0/min")).toBeInTheDocument();
  });

  it("colours raw-demand chips green when claimed supply covers demand", () => {
    render(
      <ChainPreview
        plan={plan()}
        nodes={[
          {
            id: "n-1",
            resourceItemId: "Desc_OreIron_C",
            purity: "Pure",
            x: 0,
            y: 0,
            z: 0,
            label: null,
            itemsPerMinute: 120,
            minerMk: 1,
            clockPct: 100,
            factoryId: null,
            notes: null,
            claim: { id: "c-1", nodeId: "n-1" } as never,
          } as never,
        ]}
      />,
    );
    // 45 ipm needed, 120 ipm supplied → green chip ("text-success").
    const chip = screen.getByTitle(/Need 45 ipm/);
    expect(chip.querySelector(".text-success")).not.toBeNull();
  });

  it("optional header surfaces target + totals", () => {
    render(<ChainPreview plan={plan()} showHeader />);
    expect(screen.getByText(/45\/min Iron Plate/)).toBeInTheDocument();
    expect(screen.getByText(/5 machines/)).toBeInTheDocument();
  });
});
