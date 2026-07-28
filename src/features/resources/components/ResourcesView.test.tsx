import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "@/features/factory/api";
import { validationApi } from "@/features/validation/api";
import { DEFAULT_LOADOUT, writeLoadout } from "@/features/map/components/PlacementLoadout";
import { queryKeys } from "@/shared/query/keys";
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

// Every miner mark, for the playthrough-switch test below — `ironNode`'s
// default fixture only offers Mk1, which would clamp any preferred mark
// straight back down and mask the bug this pins.
const ALL_MINER_MARKS = [
  { id: "Build_MinerMk1_C", name: "Miner Mk.1", baseIpm: 60, unlockTier: 0 },
  { id: "Build_MinerMk2_C", name: "Miner Mk.2", baseIpm: 120, unlockTier: 4 },
  { id: "Build_MinerMk3_C", name: "Miner Mk.3", baseIpm: 240, unlockTier: 8 },
];

function playthroughFixture(id: string, currentTier: number) {
  return {
    id,
    displayName: id,
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier,
    currentMilestoneProgress: 0,
  };
}

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{node}</QueryClientProvider>) };
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

  it("re-reads the map's loadout on a playthrough switch instead of keeping the previous one (#97)", async () => {
    // Playthrough A is a late-game run whose saved Placing mark is Mk3.
    // AppShell keeps a single ResourcesView mounted across a playthrough
    // switch — no remount — so the fix has to be an effect, not just a
    // `useState` initializer that only ever runs once.
    writeLoadout({ ...DEFAULT_LOADOUT, minerId: "Build_MinerMk3_C" }, "playthrough-a");
    vi.spyOn(resourcesApi, "list").mockResolvedValue([
      { ...ironNode(0), allowedExtractors: ALL_MINER_MARKS },
    ]);
    vi.spyOn(resourcesApi, "setClaim").mockResolvedValue(undefined);
    vi.spyOn(playthroughApi, "current").mockResolvedValue(playthroughFixture("playthrough-a", 8));

    const { client } = renderWithProviders(<ResourcesView />);
    const ironHeader = await screen.findByRole("button", { name: /Iron Ore/ });
    fireEvent.click(ironHeader);
    fireEvent.click(await screen.findByLabelText("Claim node"));
    await waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith(
        expect.objectContaining({ minerId: "Build_MinerMk3_C" }),
      ),
    );

    // Switch to playthrough B, which has never saved a loadout of its
    // own — plain `readLoadout` for an unseen id falls back to Mk1.
    // Before the fix, the still-mounted view kept reading playthrough
    // A's scoped key and kept defaulting new claims to Mk3 here too.
    vi.mocked(resourcesApi.setClaim).mockClear();
    vi.spyOn(playthroughApi, "current").mockResolvedValue(playthroughFixture("playthrough-b", 0));
    await client.invalidateQueries({ queryKey: queryKeys.playthrough.current });

    // The node list is keyed by playthrough id too, so the switch drops
    // the cached rows and re-fetches under the new key — the view falls
    // back to its "Loading nodes…" state for that round trip. Checking
    // one condition at a time (e.g. "Loading nodes… is gone") can pass
    // on a stale snapshot from *before* the switch has even started
    // propagating, which is how an earlier version of this test ended
    // up clicking a button React had already swapped out from under it
    // (confirmed via `.isConnected`). Requiring all three signs of the
    // *new* playthrough's settled state in the same poll rules that out;
    // only then is it safe to query and click, fresh, in one tick.
    await waitFor(() => {
      expect(screen.getByText(/playthrough-b/)).toBeInTheDocument();
      expect(screen.queryByText("Loading nodes…")).toBeNull();
      expect(screen.getByLabelText("Claim node")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Claim node"));
    await waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith(
        expect.objectContaining({ minerId: "Build_MinerMk1_C" }),
      ),
    );
  });
});
