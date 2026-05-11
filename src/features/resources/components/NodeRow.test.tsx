import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { NodeRow } from "./NodeRow";
import { resourcesApi } from "../api";
import { playthroughApi } from "@/features/playthrough/api";
import type { ResourceNodeRow } from "../types";

const unclaimed: ResourceNodeRow = {
  id: "BP_Iron1",
  resourceItemId: "Desc_OreIron_C",
  resourceItemName: "Iron Ore",
  purity: "Pure",
  kind: "miner_node",
  x: 0,
  y: 0,
  z: 0,
  claim: null,
  itemsPerMinute: 0,
};

const claimedMk2: ResourceNodeRow = {
  ...unclaimed,
  id: "BP_Iron2",
  claim: {
    minerId: "Build_MinerMk2_C",
    clockPct: 100,
    factoryId: null,
    notes: null,
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
  },
  itemsPerMinute: 240,
};

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  // setClaim's undo flow reads the full list to capture the pre-image —
  // mock it so the apply closure resolves immediately.
  vi.spyOn(resourcesApi, "list").mockResolvedValue([unclaimed, claimedMk2]);
  vi.spyOn(resourcesApi, "setClaim").mockResolvedValue(undefined);
  vi.spyOn(resourcesApi, "clearClaim").mockResolvedValue(undefined);
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p1",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 4,
    currentMilestoneProgress: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<NodeRow />", () => {
  it("renders unclaimed nodes with a claim button (no chip)", () => {
    renderWithProviders(<NodeRow row={unclaimed} factories={[]} />);
    expect(screen.getByText("unclaimed")).toBeInTheDocument();
    expect(screen.getByLabelText("Claim node")).toBeInTheDocument();
  });

  it("renders claimed nodes with miner mark + clock + ipm chips", () => {
    renderWithProviders(<NodeRow row={claimedMk2} factories={[]} />);
    expect(screen.getByText("Mk2")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("240 ipm")).toBeInTheDocument();
  });

  it("one-click claim sends sensible defaults (Mk1, 100% clock, no factory)", async () => {
    renderWithProviders(<NodeRow row={unclaimed} factories={[]} />);
    fireEvent.click(screen.getByLabelText("Claim node"));
    await waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith({
        nodeId: "BP_Iron1",
        minerId: "Build_MinerMk1_C",
        clockPct: 100,
        factoryId: null,
        notes: null,
      }),
    );
  });

  it("editing surfaces the bound-factory dropdown with the playthrough's factories", () => {
    renderWithProviders(
      <NodeRow
        row={claimedMk2}
        factories={[
          { id: "F1", name: "Iron Plant" },
          { id: "F2", name: "Steel Plant" },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(screen.getByRole("combobox", { name: /factory/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Iron Plant" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Steel Plant" })).toBeInTheDocument();
  });

  it("fracking wells expose the well extractor instead of miner marks", () => {
    const well: ResourceNodeRow = {
      ...unclaimed,
      id: "BP_Water1",
      resourceItemId: "Desc_Water_C",
      resourceItemName: "Water",
      kind: "fracking_well",
    };
    renderWithProviders(<NodeRow row={well} factories={[]} />);
    fireEvent.click(screen.getByLabelText("Claim node"));
    return waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith(
        expect.objectContaining({ minerId: "Build_FrackingSmasher_C" }),
      ),
    );
  });
});
