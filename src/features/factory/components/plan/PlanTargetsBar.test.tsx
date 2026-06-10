import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { libraryApi } from "@/features/library/api";
import { PlanTargetsBar } from "./PlanTargetsBar";

const items = [
  { id: "Desc_Cable_C", name: "Cable", category: "part" as const, stackSize: 200, isFluid: false },
  { id: "Desc_Wire_C", name: "Wire", category: "part" as const, stackSize: 500, isFluid: false },
  { id: "Desc_OreCopper_C", name: "Copper Ore", category: "raw" as const, stackSize: 100, isFluid: false },
];

const recipes = [
  {
    id: "Recipe_Cable_C", name: "Cable",
    buildingId: "Desc_ConstructorMk1_C", isAlt: false, unlockTier: 0, cycleSeconds: 2,
    inputs: [{ itemId: "Desc_Wire_C", perMinute: 60 }],
    outputs: [{ itemId: "Desc_Cable_C", perMinute: 30 }],
  },
  {
    id: "Recipe_Wire_C", name: "Wire",
    buildingId: "Desc_ConstructorMk1_C", isAlt: false, unlockTier: 0, cycleSeconds: 4,
    inputs: [{ itemId: "Desc_CopperIngot_C", perMinute: 15 }],
    outputs: [{ itemId: "Desc_Wire_C", perMinute: 30 }],
  },
];

beforeEach(() => {
  vi.spyOn(libraryApi, "items").mockResolvedValue(items);
  vi.spyOn(libraryApi, "recipes").mockResolvedValue(recipes);
});

afterEach(() => vi.restoreAllMocks());

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const itemNames = new Map(items.map((i) => [i.id, i.name]));

describe("<PlanTargetsBar />", () => {
  it("renders a chip per target with an editable rate", async () => {
    const onSetTargetIpm = vi.fn();
    renderWithProviders(
      <PlanTargetsBar
        targets={[{ itemId: "Desc_Cable_C", ipm: 60 }]}
        itemNames={itemNames}
        onAddTarget={() => {}}
        onRemoveTarget={() => {}}
        onSetTargetIpm={onSetTargetIpm}
      />,
    );
    expect(screen.getByText("Cable")).toBeInTheDocument();
    // The input is controlled by the parent's working state, so a
    // single change event (not per-keystroke typing) models the edit.
    fireEvent.change(screen.getByLabelText("Rate for Cable"), { target: { value: "90" } });
    expect(onSetTargetIpm).toHaveBeenCalledWith("Desc_Cable_C", 90);
  });

  it("adds a product through the picker, excluding existing targets", async () => {
    const onAddTarget = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PlanTargetsBar
        targets={[{ itemId: "Desc_Cable_C", ipm: 60 }]}
        itemNames={itemNames}
        onAddTarget={onAddTarget}
        onRemoveTarget={() => {}}
        onSetTargetIpm={() => {}}
      />,
    );
    await user.click(screen.getByText("Add product"));
    await user.click(await screen.findByRole("combobox"));
    // Cable is already a target → only Wire offered.
    expect(screen.queryByRole("option", { name: /Cable/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: /Wire/ }));
    expect(onAddTarget).toHaveBeenCalledWith("Desc_Wire_C");
  });

  it("removes a target", async () => {
    const onRemoveTarget = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PlanTargetsBar
        targets={[{ itemId: "Desc_Cable_C", ipm: 60 }]}
        itemNames={itemNames}
        onAddTarget={() => {}}
        onRemoveTarget={onRemoveTarget}
        onSetTargetIpm={() => {}}
      />,
    );
    await user.click(screen.getByLabelText("Remove Cable"));
    expect(onRemoveTarget).toHaveBeenCalledWith("Desc_Cable_C");
  });
});
