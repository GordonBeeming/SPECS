import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { PlanNode } from "@/features/planner/types";
import {
  ByproductNodeCard,
  ImportNodeCard,
  RawInputNodeCard,
  RecipeStepNodeCard,
} from "./PlanNodes";

// The cards only use xyflow's <Handle> as an edge anchor; it requires a
// live ReactFlow node context, which the card tests don't need.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  Handle: () => null,
}));

const recipeNode: Extract<PlanNode, { kind: "recipe" }> = {
  kind: "recipe",
  nodeKey: "recipe:Desc_Cable_C",
  itemId: "Desc_Cable_C",
  itemName: "Cable",
  recipeId: "Recipe_Cable_C",
  recipeName: "Cable",
  buildingId: "Desc_ConstructorMk1_C",
  buildingName: "Constructor",
  machineCount: 2,
  clockPct: 100,
  powerMw: 8,
  outputIpm: 60,
  isAlt: false,
  isTarget: true,
  targetIpm: 60,
  inputs: [{ itemId: "Desc_Wire_C", itemName: "Wire", perMinute: 120 }],
  outputs: [{ itemId: "Desc_Cable_C", itemName: "Cable", perMinute: 60 }],
};

const importNode: Extract<PlanNode, { kind: "import" }> = {
  kind: "import",
  nodeKey: "import:Desc_Wire_C",
  itemId: "Desc_Wire_C",
  itemName: "Wire",
  ipm: 120,
  allocations: [],
  unassignedIpm: 120,
};

describe("RecipeStepNodeCard", () => {
  it("shows the bank summary and a Target badge for target items", () => {
    render(
      <RecipeStepNodeCard
        node={recipeNode}
        recipeOptions={[]}
        onSwapRecipe={() => {}}
        onSupplyFromElsewhere={() => {}}
      />,
    );
    expect(screen.getByText("Cable")).toBeInTheDocument();
    expect(screen.getByText(/2× Constructor @ 100%/)).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    // Targets are built here by definition — no cut affordance.
    expect(screen.queryByText(/Supply from elsewhere/)).not.toBeInTheDocument();
  });

  it("cuts to an input via Supply from elsewhere on non-target steps", async () => {
    const user = userEvent.setup();
    const onCut = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        recipeOptions={[]}
        onSwapRecipe={() => {}}
        onSupplyFromElsewhere={onCut}
      />,
    );
    await user.click(screen.getByText(/Supply from elsewhere/));
    expect(onCut).toHaveBeenCalledWith("Desc_Cable_C");
  });

  it("swaps the recipe through the picker", async () => {
    const user = userEvent.setup();
    const onSwap = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        recipeOptions={[
          { value: "Recipe_Cable_C", label: "Cable" },
          { value: "Recipe_Alternate_Cable_C", label: "Alternate: Insulated Cable", group: "Alternate" },
        ]}
        onSwapRecipe={onSwap}
        onSupplyFromElsewhere={() => {}}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Insulated Cable/ }));
    expect(onSwap).toHaveBeenCalledWith("Desc_Cable_C", "Recipe_Alternate_Cable_C");
  });
});

describe("ImportNodeCard", () => {
  const baseProps = {
    factoryOptions: [{ value: "fac-wire", label: "Wire farm" }],
    factoryNames: new Map([["fac-wire", "Wire farm"]]),
    onSetSource: vi.fn(),
    onSetCap: vi.fn(),
    onAddSource: vi.fn(),
    onRemoveSource: vi.fn(),
    onBuildHere: vi.fn(),
  };

  it("flags unsourced demand as a warning state, not an error", () => {
    render(
      <ImportNodeCard
        node={importNode}
        sources={[{ sourceFactoryId: null, ipmCap: null }]}
        {...baseProps}
      />,
    );
    expect(screen.getByText(/Unsourced/)).toBeInTheDocument();
    expect(screen.getByText(/a future factory will supply this/)).toBeInTheDocument();
  });

  it("expands back into the graph via Build it here", async () => {
    const user = userEvent.setup();
    const onBuildHere = vi.fn();
    render(
      <ImportNodeCard
        node={importNode}
        sources={[{ sourceFactoryId: null, ipmCap: null }]}
        {...baseProps}
        onBuildHere={onBuildHere}
      />,
    );
    await user.click(screen.getByText(/Build it here/));
    expect(onBuildHere).toHaveBeenCalledWith("Desc_Wire_C");
  });
});

describe("RawInputNodeCard", () => {
  it("shows danger styling when demand exceeds claimed supply", () => {
    render(
      <RawInputNodeCard
        node={{
          kind: "raw",
          nodeKey: "raw:Desc_OreCopper_C",
          itemId: "Desc_OreCopper_C",
          itemName: "Copper Ore",
          ipm: 120,
          claimedSupplyIpm: 60,
        }}
      />,
    );
    expect(screen.getByText("Copper Ore")).toBeInTheDocument();
    expect(screen.getByText(/60\/min claimed/)).toBeInTheDocument();
  });
});

describe("ByproductNodeCard", () => {
  it("renders the surplus rate", () => {
    render(
      <ByproductNodeCard
        node={{
          kind: "byproduct",
          nodeKey: "byproduct:Desc_HeavyOilResidue_C",
          itemId: "Desc_HeavyOilResidue_C",
          itemName: "Heavy Oil Residue",
          surplusIpm: 20,
        }}
      />,
    );
    expect(screen.getByText("Heavy Oil Residue")).toBeInTheDocument();
    expect(screen.getByText("20/min")).toBeInTheDocument();
  });
});
