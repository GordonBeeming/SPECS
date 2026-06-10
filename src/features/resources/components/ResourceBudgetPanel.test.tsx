import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { playthroughApi } from "@/features/playthrough/api";
import { resourcesApi } from "../api";
import type { ResourceBudget } from "../types";
import { ResourceBudgetPanel } from "./ResourceBudgetPanel";

const budget: ResourceBudget = {
  assumptionLabel: "Mk2 @ 100%",
  rows: [
    {
      resourceItemId: "Desc_OreIron_C",
      resourceItemName: "Iron Ore",
      kind: "miner_node",
      worldMaxIpm: 10_000,
      claimedIpm: 1_200,
      boundIpm: 800,
      claimedMaxIpm: 1_500,
      remainingIpm: 8_500,
      pure: { total: 10, claimed: 2 },
      normal: { total: 20, claimed: 3 },
      impure: { total: 5, claimed: 0 },
      overcommitted: false,
    },
    {
      resourceItemId: "Desc_OreUranium_C",
      resourceItemName: "Uranium",
      kind: "miner_node",
      worldMaxIpm: 600,
      claimedIpm: 700,
      boundIpm: 700,
      claimedMaxIpm: 600,
      remainingIpm: 0,
      pure: { total: 1, claimed: 1 },
      normal: { total: 2, claimed: 2 },
      impure: { total: 1, claimed: 1 },
      overcommitted: true,
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p", displayName: "Run", gameVersion: "1.1",
    createdAt: "2026-06-10T00:00:00Z", currentTier: 4, currentMilestoneProgress: 0,
  });
  vi.spyOn(resourcesApi, "budget").mockResolvedValue(budget);
});

afterEach(() => vi.restoreAllMocks());

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("<ResourceBudgetPanel />", () => {
  it("shows remaining per resource with the assumption label visible", async () => {
    renderWithProviders(<ResourceBudgetPanel variant="full" />);
    expect(await screen.findByText("Iron Ore")).toBeInTheDocument();
    expect(screen.getByText(/remaining at Mk2 @ 100%/)).toBeInTheDocument();
    expect(screen.getByText("8.5k/min left")).toBeInTheDocument();
    // Unclaimed purity counts: 8 pure, 17 normal, 5 impure.
    expect(screen.getByText(/unclaimed 8P · 17N · 5I/)).toBeInTheDocument();
  });

  it("marks exhausted and overcommitted resources, without blocking anything", async () => {
    renderWithProviders(<ResourceBudgetPanel variant="full" />);
    expect(await screen.findByText("Uranium")).toBeInTheDocument();
    const remaining = screen.getByText("0/min left");
    expect(remaining.className).toContain("text-danger");
    expect(screen.getByText(/claims exceed this assumption/)).toBeInTheDocument();
  });

  it("refetches with the picked assumption and persists the choice", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResourceBudgetPanel variant="full" />);
    await screen.findByText("Iron Ore");
    await user.click(screen.getByRole("button", { name: "Mk3 @ 250%" }));
    await waitFor(() =>
      expect(resourcesApi.budget).toHaveBeenCalledWith("mk3_at_250"),
    );
    expect(localStorage.getItem("specs:budget:assumption")).toBe("mk3_at_250");
  });

  it("compact variant starts collapsed as a pill and expands on click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResourceBudgetPanel variant="compact" />);
    const pill = screen.getByRole("button", { name: /Resource budget/ });
    expect(screen.queryByText("Iron Ore")).not.toBeInTheDocument();
    await user.click(pill);
    expect(await screen.findByText("Iron Ore")).toBeInTheDocument();
  });
});
