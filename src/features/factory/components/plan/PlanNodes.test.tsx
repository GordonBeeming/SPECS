import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ExistingProducerSource, PlanNode } from "@/features/planner/types";
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
  // No internal consumer in these fixtures — free matches gross unless
  // a test overrides it to exercise the gap.
  freeOutputIpm: 60,
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

// The same producer in the two states the click has to tell apart:
// exporting enough of its spare already, and exporting none of it.
const openSource: ExistingProducerSource = {
  factoryId: "fac-rocket",
  factoryName: "Rocket Works",
  spareIpm: 40,
  remainingIpm: 40,
  hasTarget: true,
};
const shutSource: ExistingProducerSource = { ...openSource, remainingIpm: 0 };

const recipeCardProps = {
  recipeOptions: [],
  exportIpm: null as number | null,
  uncollected: false,
  onSwapRecipe: vi.fn(),
  onOpenSources: vi.fn(),
  onStartExport: vi.fn(),
  onSetExport: vi.fn(),
  onImportFromProducer: vi.fn(),
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

  it("prefills a fractional production rate without rounding it", async () => {
    // A Motor line runs 2.5/min; the prefill used to round to 3 and
    // offer more than the factory makes.
    const user = userEvent.setup();
    const onStartExport = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null, outputIpm: 2.5, freeOutputIpm: 2.5 }}
        {...recipeCardProps}
        onStartExport={onStartExport}
      />,
    );
    await user.click(screen.getByText("Export"));
    expect(onStartExport).toHaveBeenCalledWith("Desc_Cable_C", 2.5);
  });

  it("prefills an export from free output, not gross production", async () => {
    // A Screws node offering 519/min gross, almost all of it eaten by
    // other steps here — accepting the old prefill declared an export
    // the factory couldn't honour (#88).
    const user = userEvent.setup();
    const onStartExport = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{
          ...recipeNode,
          isTarget: false,
          targetIpm: null,
          outputIpm: 519,
          freeOutputIpm: 12,
        }}
        {...recipeCardProps}
        onStartExport={onStartExport}
      />,
    );
    await user.click(screen.getByText("Export"));
    expect(onStartExport).toHaveBeenCalledWith("Desc_Cable_C", 12);
  });

  it("shows both gross production and what's actually free", () => {
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, outputIpm: 519, freeOutputIpm: 12 }}
        {...recipeCardProps}
      />,
    );
    expect(screen.getByText(/519\/min/)).toBeInTheDocument();
    expect(screen.getByText(/12\/min free/)).toBeInTheDocument();
  });

  it("doesn't repeat the free figure when nothing local consumes it", () => {
    render(<RecipeStepNodeCard node={recipeNode} {...recipeCardProps} />);
    expect(screen.queryByText(/free/)).not.toBeInTheDocument();
  });

  it("badges a recipe that's an uncollected alt", () => {
    render(<RecipeStepNodeCard node={recipeNode} {...recipeCardProps} uncollected />);
    expect(screen.getByText("Not collected")).toBeInTheDocument();
  });

  it("surfaces an existing producer with spare capacity instead of waiting to be asked", async () => {
    // #107: nothing prompted the user toward Rocket Works' spare
    // capacity, so Warp Drive Final quietly rebuilt the same part.
    const user = userEvent.setup();
    const onImportFromProducer = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        onImportFromProducer={onImportFromProducer}
        existingProducer={{
          nodeKey: "recipe:Desc_Cable_C",
          itemId: "Desc_Cable_C",
          itemName: "Cable",
          localIpm: 60,
          sources: [openSource],
        }}
      />,
    );
    expect(screen.getByText(/Rocket Works/)).toBeInTheDocument();
    expect(screen.getByText(/40\/min spare/)).toBeInTheDocument();
    await user.click(screen.getByText("import instead"));
    // The whole source, not just its id: what the click has to do first
    // depends on how much of it the producer already exports.
    expect(onImportFromProducer).toHaveBeenCalledWith("Desc_Cable_C", openSource, 60);
  });

  it("says the producer's export slice will be opened before it's clicked", () => {
    // A producer that makes the item but exports none of it supplies
    // 0/min to an uncapped source row, so the click has to open its
    // slice — a consequence in somebody else's factory, and the offer
    // is the only place it can be read before it happens.
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        existingProducer={{
          nodeKey: "recipe:Desc_Cable_C",
          itemId: "Desc_Cable_C",
          itemName: "Cable",
          localIpm: 60,
          sources: [shutSource],
        }}
      />,
    );
    expect(screen.getByText(/opens a 40\/min export slice/)).toBeInTheDocument();
  });

  it("says the slice is being widened when the producer already exports some", () => {
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        existingProducer={{
          nodeKey: "recipe:Desc_Cable_C",
          itemId: "Desc_Cable_C",
          itemName: "Cable",
          localIpm: 60,
          sources: [{ ...openSource, remainingIpm: 12 }],
        }}
      />,
    );
    expect(screen.getByText(/Only 12\/min of it is on offer/)).toBeInTheDocument();
  });

  it("stays quiet about the export slice when the producer already offers enough", () => {
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        existingProducer={{
          nodeKey: "recipe:Desc_Cable_C",
          itemId: "Desc_Cable_C",
          itemName: "Cable",
          localIpm: 60,
          sources: [openSource],
        }}
      />,
    );
    expect(screen.queryByText(/export slice/)).not.toBeInTheDocument();
  });

  it("disables the offer while the import is being set up", () => {
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        importPending
        existingProducer={{
          nodeKey: "recipe:Desc_Cable_C",
          itemId: "Desc_Cable_C",
          itemName: "Cable",
          localIpm: 60,
          sources: [shutSource],
        }}
      />,
    );
    // Opening the slice is a round-trip; a live-looking button through
    // it invites the second click that reads as "still nothing".
    expect(screen.getByText("import instead")).toBeDisabled();
  });

  it("doesn't offer an existing-producer import for a target — the target is the product", () => {
    render(
      <RecipeStepNodeCard
        node={recipeNode}
        {...recipeCardProps}
        existingProducer={{
          nodeKey: "recipe:Desc_Cable_C",
          itemId: "Desc_Cable_C",
          itemName: "Cable",
          localIpm: 60,
          sources: [openSource],
        }}
      />,
    );
    expect(screen.queryByText("import instead")).not.toBeInTheDocument();
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

  it("accepts a fractional export slice", () => {
    // 2.5/min Computers is an ordinary rate in this game; the field
    // used to mark it invalid on a whole-number step.
    const onSetExport = vi.fn();
    render(
      <RecipeStepNodeCard
        node={recipeNode}
        {...recipeCardProps}
        exportIpm={30}
        onSetExport={onSetExport}
      />,
    );
    const field = screen.getByLabelText("Export rate for Cable");
    fireEvent.change(field, { target: { value: "2.5" } });
    expect(field).toBeValid();
    expect(onSetExport).toHaveBeenCalledWith("Desc_Cable_C", 2.5);
  });

  it("swaps the recipe through the picker", async () => {
    const user = userEvent.setup();
    const onSwap = vi.fn();
    render(
      <RecipeStepNodeCard
        node={{ ...recipeNode, isTarget: false, targetIpm: null }}
        {...recipeCardProps}
        recipeOptions={[
          {
            value: "Recipe_Cable_C",
            label: "Cable",
            io: {
              inputs: [{ itemId: "Desc_Wire_C", perMinute: 60 }],
              outputs: [{ itemId: "Desc_Cable_C", perMinute: 30 }],
            },
          },
          {
            value: "Recipe_Alternate_Cable_C",
            label: "Alternate: Insulated Cable",
            group: "Alternate",
            io: {
              inputs: [
                { itemId: "Desc_Wire_C", perMinute: 45 },
                { itemId: "Desc_Rubber_C", perMinute: 30 },
              ],
              outputs: [{ itemId: "Desc_Cable_C", perMinute: 100 }],
            },
          },
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
    factoryIcons: new Map([["fac-wire", "Desc_Wire_C"]]),
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
  it("marks a stranded fluid as a stall risk", () => {
    render(
      <ByproductNodeCard
        node={{
          kind: "byproduct",
          nodeKey: "byproduct:Desc_HeavyOilResidue_C",
          itemId: "Desc_HeavyOilResidue_C",
          itemName: "Heavy Oil Residue",
          surplusIpm: 20,
          isFluid: true,
        }}
      />,
    );
    expect(screen.getByText("Heavy Oil Residue")).toBeInTheDocument();
    expect(screen.getByText("20/min")).toBeInTheDocument();
    expect(screen.getByText(/will stall/i)).toBeInTheDocument();
  });

  it("labels a solid surplus as sinkable", () => {
    render(
      <ByproductNodeCard
        node={{
          kind: "byproduct",
          nodeKey: "byproduct:Desc_Silica_C",
          itemId: "Desc_Silica_C",
          itemName: "Silica",
          surplusIpm: 25,
          isFluid: false,
        }}
      />,
    );
    expect(screen.getByText(/Byproduct → sink/i)).toBeInTheDocument();
  });

  it("gives the sink node contrast rather than muting it", () => {
    // What's being thrown away is a number the player has to be able
    // to see: the sink node was the dimmest card on the canvas and a
    // refinery sinking 145/min went unnoticed.
    const { container } = render(
      <ByproductNodeCard
        node={{
          kind: "byproduct",
          nodeKey: "byproduct:Desc_PetroleumCoke_C",
          itemId: "Desc_PetroleumCoke_C",
          itemName: "Petroleum Coke",
          surplusIpm: 145.5,
          isFluid: false,
        }}
      />,
    );
    const card = container.firstElementChild;
    expect(card?.className).toContain("border-warning/70");
    expect(card?.className).not.toContain("bg-bg-raised/60");
    expect(screen.getByText("145.5/min")).toBeInTheDocument();
  });
});
