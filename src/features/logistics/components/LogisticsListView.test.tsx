import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { factoryApi } from "@/features/factory/api";
import { libraryApi } from "@/features/library/api";
import { playthroughApi } from "@/features/playthrough/api";
import { logisticsApi } from "../api";
import type { LogisticsLink } from "../types";
import { serialisePlan } from "./TransportPlanPicker";
import { LogisticsListView } from "./LogisticsListView";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const ironWorks = {
  id: "f-iron",
  name: "Iron Works",
  worldX: 10000,
  worldY: 10000,
  createdAt: "2026-05-10T00:00:00Z",
  updatedAt: "2026-05-10T00:00:00Z",
  machineCount: 3,
};
const elevatorYard = {
  id: "f-elevator",
  name: "Elevator Yard",
  worldX: 40000,
  worldY: 50000,
  createdAt: "2026-05-10T00:00:00Z",
  updatedAt: "2026-05-10T00:00:00Z",
  machineCount: 1,
};

beforeEach(() => {
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 2,
    currentMilestoneProgress: 0,
  });
  vi.spyOn(factoryApi, "list").mockResolvedValue([ironWorks, elevatorYard]);
  vi.spyOn(libraryApi, "items").mockResolvedValue([
    { id: "Desc_IronPlate_C", name: "Iron Plate", category: "part", stackSize: 100, isFluid: false },
  ]);
  vi.spyOn(libraryApi, "transportVehicles").mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

describe("<LogisticsListView /> — link row transport summary (#71)", () => {
  it("shows the belt's mark instead of the bare transport kind", async () => {
    const link: LogisticsLink = {
      id: "link-1",
      fromFactoryId: ironWorks.id,
      toFactoryId: elevatorYard.id,
      itemId: "Desc_IronPlate_C",
      itemsPerMinute: 120,
      transportKind: "belt",
      // A single-tier Mk2 plan — `serialisePlan` matches what the editor
      // actually persists, so this pins the same shape the app writes.
      transportPlanJson: serialisePlan({
        kind: "belt",
        segments: [{ mark: 2, count: 1, perUnitCapacity: 120, unlockTier: 2 }],
        totalCapacityPerMinute: 120,
        utilisationPct: 100,
        minUnlockTier: 2,
        locked: false,
      }),
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    };
    vi.spyOn(logisticsApi, "list").mockResolvedValue([link]);

    renderWithProviders(<LogisticsListView />);

    // "belt" alone (#71) reads the same for every mark; the row must
    // name the mark the transport-plan picker actually recommended.
    expect(await screen.findByText(/1× Mk2 belts/)).toBeInTheDocument();
    expect(screen.queryByText(/·\s*belt\s*(·|$)/)).not.toBeInTheDocument();
  });

  it("falls back to the bare transport kind for a row whose plan JSON doesn't parse", async () => {
    const link: LogisticsLink = {
      id: "link-2",
      fromFactoryId: ironWorks.id,
      toFactoryId: elevatorYard.id,
      itemId: "Desc_IronPlate_C",
      itemsPerMinute: 120,
      transportKind: "belt",
      // Pre-validation legacy row shape — must not crash the list.
      transportPlanJson: "{}",
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    };
    vi.spyOn(logisticsApi, "list").mockResolvedValue([link]);

    renderWithProviders(<LogisticsListView />);

    expect(await screen.findByText(/belt/)).toBeInTheDocument();
  });
});
