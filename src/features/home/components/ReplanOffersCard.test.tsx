import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { playthroughApi } from "@/features/playthrough/api";
import { plannerApi } from "@/features/planner/api";
import type { ReoptimizeResult, ReplanOffer } from "@/features/planner/types";

import { ReplanOffersCard } from "./ReplanOffersCard";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function mockPlaythrough() {
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p1",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 2,
    currentMilestoneProgress: 0,
  });
}

const ironWorks: ReplanOffer = {
  factoryId: "iron-works",
  factoryName: "Iron Works",
  currentMachines: 6,
  currentPowerMw: 28,
  reoptimizedMachines: 4,
  reoptimizedPowerMw: 23.7,
  swaps: [
    {
      itemId: "Desc_IronScrew_C",
      itemName: "Screw",
      fromRecipeId: "Recipe_Screw_C",
      fromRecipeName: "Screws",
      toRecipeId: "Recipe_Alternate_Screw_C",
      toRecipeName: "Alternate: Cast Screws",
      toIsAlt: true,
    },
  ],
};

const reoptimized: ReoptimizeResult = {
  saved: {
    graph: {
      nodes: [],
      edges: [],
      totalMachines: 4,
      totalPowerMw: 23.7,
      extractorCount: 0,
      extractorPowerMw: 0,
      rawDemand: {},
      warnings: [],
      samForced: false,
      uncollectedAlts: [],
      existingProducers: [],
    },
    machineIds: [],
    linkIds: [],
  },
  droppedRecipes: { Desc_IronScrew_C: "Recipe_Screw_C" },
};

const confirmPanel = () => screen.findByRole("alertdialog");

afterEach(() => vi.restoreAllMocks());

describe("<ReplanOffersCard />", () => {
  it("carries both sides of the trade, not just the improvement", async () => {
    // The whole point of offering instead of applying: the player is
    // being asked to redesign machines already standing in the game, so
    // "23.7 MW" on its own is not enough to judge it.
    mockPlaythrough();
    vi.spyOn(plannerApi, "listReplanOffers").mockResolvedValue([ironWorks]);
    renderWithProviders(<ReplanOffersCard tier={2} />);

    expect(await screen.findByText("6 machines · 28.0 MW")).toBeInTheDocument();
    expect(screen.getByText("4 machines · 23.7 MW")).toBeInTheDocument();

    // Both recipe names, so the swap can be read as a trade rather than
    // an instruction to trust the optimizer.
    const swap = screen.getByText("Alternate: Cast Screws").closest("li");
    expect(swap).toHaveTextContent("Screw: Screws → Alternate: Cast Screws");
  });

  it("changes nothing until the player asks for it", async () => {
    mockPlaythrough();
    vi.spyOn(plannerApi, "listReplanOffers").mockResolvedValue([ironWorks]);
    const reoptimize = vi.spyOn(plannerApi, "reoptimize");
    const user = userEvent.setup();
    renderWithProviders(<ReplanOffersCard tier={2} />);
    await screen.findByText("Iron Works");

    expect(reoptimize).not.toHaveBeenCalled();

    reoptimize.mockResolvedValue(reoptimized);
    await user.click(screen.getByRole("button", { name: /re-optimize/i }));
    await user.click(within(await confirmPanel()).getByRole("button", { name: "Re-optimize" }));

    // Per factory, never a sweep — the player gets to take the new
    // plant and leave the one they've built alone.
    expect(reoptimize).toHaveBeenCalledExactlyOnceWith("iron-works");
  });

  it("rebuilds nothing on the press that opens the confirmation", async () => {
    // The same rebuild the designer gates behind a confirmation, and it
    // lands on machines that may already be standing in the game. One
    // misplaced click on Home must not be the whole of it.
    mockPlaythrough();
    vi.spyOn(plannerApi, "listReplanOffers").mockResolvedValue([ironWorks]);
    const reoptimize = vi.spyOn(plannerApi, "reoptimize").mockResolvedValue(reoptimized);
    const user = userEvent.setup();
    renderWithProviders(<ReplanOffersCard tier={2} />);
    await screen.findByText("Iron Works");

    await user.click(screen.getByRole("button", { name: /re-optimize/i }));

    const confirm = await confirmPanel();
    expect(reoptimize).not.toHaveBeenCalled();
    // It has to say what moves, not just ask twice — including the one
    // thing the Undo beside it can't put back.
    expect(confirm).toHaveTextContent(/imports or links/i);
    expect(confirm).toHaveTextContent(/survives keeps the transport you gave it/);
    expect(confirm).toHaveTextContent(/comes back as a plain belt/);

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(reoptimize).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("puts the old recipes back when the undo is taken", async () => {
    mockPlaythrough();
    vi.spyOn(plannerApi, "listReplanOffers").mockResolvedValue([ironWorks]);
    vi.spyOn(plannerApi, "reoptimize").mockResolvedValue(reoptimized);
    const restore = vi
      .spyOn(plannerApi, "restorePlanRecipes")
      .mockResolvedValue(reoptimized.saved);
    const user = userEvent.setup();
    renderWithProviders(<ReplanOffersCard tier={2} />);
    await screen.findByText("Iron Works");

    await user.click(screen.getByRole("button", { name: /re-optimize/i }));
    await user.click(within(await confirmPanel()).getByRole("button", { name: "Re-optimize" }));

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    // The recipes the re-solve dropped, not a fresh solve — re-solving
    // is what produced the plan being undone.
    expect(restore).toHaveBeenCalledExactlyOnceWith("iron-works", {
      Desc_IronScrew_C: "Recipe_Screw_C",
    });
  });

  it("stays off the screen entirely when every plan is already the best one", async () => {
    mockPlaythrough();
    vi.spyOn(plannerApi, "listReplanOffers").mockResolvedValue([]);
    const { container } = renderWithProviders(<ReplanOffersCard tier={2} />);

    expect(container).toBeEmptyDOMElement();
  });
});
