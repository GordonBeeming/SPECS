import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "@/features/factory/api";
import { validationApi } from "@/features/validation/api";
import { resourcesApi } from "../api";
import type { ResourceNodeRow } from "../types";
import { ResourcesView } from "./ResourcesView";

const MINER_EXTRACTORS = [
  { id: "Build_MinerMk1_C", name: "Miner Mk.1", baseIpm: 60, unlockTier: 0 },
];

function ironNode(i: number): ResourceNodeRow {
  return {
    id: `BP_Iron${i}`,
    resourceItemId: "Desc_OreIron_C",
    resourceItemName: "Iron Ore",
    purity: "Normal",
    kind: "miner_node",
    x: i * 10000,
    y: 0,
    z: 0,
    claim: null,
    itemsPerMinute: 0,
    allowedExtractors: MINER_EXTRACTORS,
    claimInvalidExtractor: false,
  };
}

const copperNode: ResourceNodeRow = {
  ...ironNode(0),
  id: "BP_Copper1",
  resourceItemId: "Desc_OreCopper_C",
  resourceItemName: "Copper Ore",
};

const nodes = [ironNode(0), ironNode(1), ironNode(2), copperNode];

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(resourcesApi, "list").mockResolvedValue(nodes);
  vi.spyOn(factoryApi, "list").mockResolvedValue([]);
  vi.spyOn(validationApi, "validate").mockResolvedValue({
    currentTier: 0,
    findings: [],
    altShoppingList: [],
    grid: { generatedMw: 0, consumedMw: 0, netMw: 0 },
    checkedAt: "2026-07-28T00:00:00Z",
  });
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p1",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 0,
    currentMilestoneProgress: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<ResourcesView />", () => {
  it("opens with every group collapsed instead of pre-expanding Iron Ore's rows (#50)", async () => {
    renderWithProviders(<ResourcesView />);
    const ironHeader = await screen.findByRole("button", { name: /Iron Ore/ });
    expect(ironHeader).toHaveAttribute("aria-expanded", "false");
    // None of Iron Ore's node rows should have rendered — the old
    // default seeded this group open on every mount.
    expect(screen.queryByText(/#N1/)).toBeNull();
  });

  it("remembers a group's open state across remounts instead of resetting", async () => {
    const { unmount } = renderWithProviders(<ResourcesView />);
    const ironHeader = await screen.findByRole("button", { name: /Iron Ore/ });
    fireEvent.click(ironHeader);
    await waitFor(() => expect(screen.getByText(/#N1/)).toBeInTheDocument());
    unmount();

    renderWithProviders(<ResourcesView />);
    const reopenedHeader = await screen.findByRole("button", { name: /Iron Ore/ });
    expect(reopenedHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/#N1/)).toBeInTheDocument();
  });
});
