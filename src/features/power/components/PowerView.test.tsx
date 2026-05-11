import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PowerView } from "./PowerView";
import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "@/features/factory/api";
import { libraryApi } from "@/features/library/api";
import { powerApi } from "../api";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(libraryApi, "generators").mockResolvedValue([
    {
      id: "Build_GeneratorCoal_C",
      name: "Coal Generator",
      category: "burner",
      powerMw: 75,
      unlockTier: 3,
      fuels: [{ fuelItemId: "Desc_Coal_C", fuelPerMinute: 15 }],
    },
  ]);
  vi.spyOn(libraryApi, "items").mockResolvedValue([
    { id: "Desc_Coal_C", name: "Coal", category: "raw", stackSize: 100, isFluid: false },
  ]);
});

afterEach(() => vi.restoreAllMocks());

describe("<PowerView />", () => {
  it("nudges the user to open a playthrough when none is active", async () => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue(null);
    renderWithProviders(<PowerView />);
    await waitFor(() => {
      expect(screen.getByText(/Open or create a playthrough/i)).toBeInTheDocument();
    });
  });

  it("renders the MW totals for the picked factory", async () => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 5,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "f1",
        name: "Coal Power Plant",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 0,
      },
    ]);
    vi.spyOn(powerApi, "list").mockResolvedValue([]);
    // PowerView now filters the sidebar to factories that already
    // have at least one generator row, so the active-factory panel
    // doesn't render until listAll reports something for this id.
    vi.spyOn(powerApi, "listAll").mockResolvedValue([
      {
        id: "g1",
        factoryId: "f1",
        generatorId: "Build_GeneratorCoal_C",
        fuelItemId: "Desc_Coal_C",
        count: 4,
        clockPct: 100,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    ]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "f1",
      // Pin the canonical math: 4 × Coal × 100% = 300 MW.
      generatedMw: 300,
      consumedMw: 60,
      netMw: 240,
      fuelFlows: [
        { itemId: "Desc_Coal_C", itemName: "Coal", isFluid: false, perMinute: 60 },
      ],
    });
    renderWithProviders(<PowerView />);
    await waitFor(() => {
      expect(screen.getByText(/300.0 MW/i)).toBeInTheDocument();
      expect(screen.getByText(/240.0 MW/i)).toBeInTheDocument();
    });
  });
});
