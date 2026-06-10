import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

const recipeCardProps = {
  recipeOptions: [],
  exportIpm: null as number | null,
  onSwapRecipe: vi.fn(),
  onOpenSources: vi.fn(),
  onStartExport: vi.fn(),
  onSetExport: vi.fn(),
};

describe("RecipeStepNodeCard", () => {
  it("shows the bank summary and a Product badge for target items", () => {
    render(<RecipeStepNodeCard node={recipeNode} {...recipeCardProps} />);
    expect(screen.getByText("Cable")).toBeInTheDocument();
    expect(screen.getByText(/2× Constructor @ 100%/)).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
    // Targets are built here by definition — no sources affordance.
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
  });

  it("opens the sources panel for non-target steps", async () => {
    const user = userEvent.setup();
    const onOpenSources = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        onOpenSources={onOpenSources}
      />,
    );
    await user.click(screen.getByText("Sources"));
    expect(onOpenSources).toHaveBeenCalledWith("Desc_Cable_C");
  });

  it("starts an export on a non-target step at the current rate", async () => {
    const user = userEvent.setup();
    const onStartExport = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        onStartExport={onStartExport}
      />,
    );
    await user.click(screen.getByText("Export"));
    expect(onStartExport).toHaveBeenCalledWith("Desc_Cable_C", 60);
  });

  it("edits the export slice inline on exporting targets", () => {
    const onSetExport = vi.fn();
    render(
      <RecipeStepNodeCard
        node={recipeNode}
        {...recipeCardProps}
        exportIpm={30}
        onSetExport={onSetExport}
      />,
    );
    fireEvent.change(screen.getByLabelText("Export rate for Cable"), {
      target: { value: "45" },
    });
    expect(onSetExport).toHaveBeenCalledWith("Desc_Cable_C", 45);
  });

  it("swaps the recipe through the picker", async () => {
    const user = userEvent.setup();
    const onSwap = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        recipeOptions={[
          { value: "Recipe_Cable_C", label: "Cable" },
          { value: "Recipe_Alternate_Cable_C", label: "Alternate: Insulated Cable", group: "Alternate" },
        ]}
        onSwapRecipe={onSwap}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Insulated Cable/ }));
    expect(onSwap).toHaveBeenCalledWith("Desc_Cable_C", "Recipe_Alternate_Cable_C");
  });
});

describe("ImportNodeCard", () => {
  const baseProps = {
    factoryNames: new Map([["fac-wire", "Wire farm"]]),
    hasLocal: false,
    onOpenSources: vi.fn(),
    onAddLocal: vi.fn(),
  };

  it("flags unsourced demand as a warning state, not an error", () => {
    render(<ImportNodeCard node={importNode} {...baseProps} />);
    expect(screen.getByText(/Unsourced/)).toBeInTheDocument();
    expect(screen.getByText(/a future factory will supply this/)).toBeInTheDocument();
  });

  it("lists allocations with factory names and offers Build it here", async () => {
    const user = userEvent.setup();
    const onAddLocal = vi.fn();
    render(
      <ImportNodeCard
        node={{
          ...importNode,
          allocations: [{ sourceFactoryId: "fac-wire", resolvedIpm: 50 }],
          unassignedIpm: 0,
        }}
        {...baseProps}
        onAddLocal={onAddLocal}
      />,
    );
    expect(screen.getByText("Wire farm")).toBeInTheDocument();
    await user.click(screen.getByText("Build it here too"));
    expect(onAddLocal).toHaveBeenCalledWith("Desc_Wire_C");
  });

  it("labels the imported share when a local line also builds it", () => {
    render(<ImportNodeCard node={importNode} {...baseProps} hasLocal />);
    expect(screen.getByText("Imported share")).toBeInTheDocument();
    expect(screen.queryByText("Build it here too")).not.toBeInTheDocument();
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
