import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { libraryApi } from "@/features/library/api";
import { plannerApi } from "@/features/planner/api";
import { playthroughApi } from "@/features/playthrough/api";
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

// Chain tiers come from the Rust side now: Wire is buildable at Tier 0,
// Cable's chain only grounds out at Tier 4 — above the playthrough's
// Tier 1 below, which is what the picker has to say out loud.
const itemTiers = [
  { itemId: "Desc_Wire_C", tier: 0, standardTier: 0 },
  { itemId: "Desc_Cable_C", tier: 4, standardTier: 4 },
];

const playthrough = {
  id: "pt-1",
  displayName: "Run",
  gameVersion: "1.2",
  createdAt: "2026-07-26T00:00:00Z",
  currentTier: 1,
  currentMilestoneProgress: 0,
};

beforeEach(() => {
  vi.spyOn(libraryApi, "items").mockResolvedValue(items);
  vi.spyOn(libraryApi, "recipes").mockResolvedValue(recipes);
  vi.spyOn(plannerApi, "listItemTiers").mockResolvedValue(itemTiers);
  vi.spyOn(playthroughApi, "current").mockResolvedValue(playthrough);
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
    // Picking the item doesn't commit it — the rate comes first, same as
    // the first-run modal, so a deep-tree item can't blow the factory out
    // to hundreds of machines before the rate is edited down.
    expect(onAddTarget).not.toHaveBeenCalled();
    expect(screen.getByText("Wire")).toBeInTheDocument();
    const rateInput = screen.getByLabelText("Rate for Wire");
    expect(rateInput).toHaveValue(60);
    fireEvent.change(rateInput, { target: { value: "4" } });
    await user.click(screen.getByLabelText("Confirm adding Wire"));
    expect(onAddTarget).toHaveBeenCalledWith("Desc_Wire_C", 4);
  });

  it("lets the rate picker be cancelled without adding a target", async () => {
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
    await user.click(await screen.findByRole("option", { name: /Wire/ }));
    await user.click(screen.getByLabelText("Cancel adding product"));
    expect(onAddTarget).not.toHaveBeenCalled();
    expect(screen.getByText("Add product")).toBeInTheDocument();
  });

  it("accepts a fractional rate and says why an empty one won't commit", async () => {
    // The playthrough bug: `step="1"` failed native constraint
    // validation, so the browser cancelled the submit before any
    // handler ran — the tick did nothing and said nothing.
    const onAddTarget = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PlanTargetsBar
        targets={[]}
        itemNames={itemNames}
        onAddTarget={onAddTarget}
        onRemoveTarget={() => {}}
        onSetTargetIpm={() => {}}
      />,
    );
    await user.click(screen.getByText("Add product"));
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Wire/ }));

    const rateInput = screen.getByLabelText("Rate for Wire");
    fireEvent.change(rateInput, { target: { value: "2.5" } });
    expect(rateInput).toBeValid();
    await user.click(screen.getByLabelText("Confirm adding Wire"));
    expect(onAddTarget).toHaveBeenCalledWith("Desc_Wire_C", 2.5);
  });

  it("refuses an unusable rate with a message instead of doing nothing", async () => {
    const onAddTarget = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PlanTargetsBar
        targets={[]}
        itemNames={itemNames}
        onAddTarget={onAddTarget}
        onRemoveTarget={() => {}}
        onSetTargetIpm={() => {}}
      />,
    );
    await user.click(screen.getByText("Add product"));
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Wire/ }));

    fireEvent.change(screen.getByLabelText("Rate for Wire"), { target: { value: "" } });
    await user.click(screen.getByLabelText("Confirm adding Wire"));
    expect(onAddTarget).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/rate greater than 0/i);
  });

  it("marks a product whose chain needs a later tier", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PlanTargetsBar
        targets={[]}
        itemNames={itemNames}
        onAddTarget={() => {}}
        onRemoveTarget={() => {}}
        onSetTargetIpm={() => {}}
      />,
    );
    await user.click(screen.getByText("Add product"));
    await user.click(await screen.findByRole("combobox"));
    // Still pickable — planning ahead is supported — but it can't read
    // as buildable today.
    const cable = await screen.findByRole("option", { name: /Cable/ });
    expect(cable).toHaveTextContent(/above your tier/i);
    expect(screen.getByText("Tier 4 — not unlocked yet")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Wire/ })).not.toHaveTextContent(
      /above your tier/i,
    );
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
