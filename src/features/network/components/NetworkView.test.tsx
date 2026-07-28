import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { NetworkView } from "./NetworkView";
import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "@/features/factory/api";
import { libraryApi } from "@/features/library/api";
import { logisticsApi } from "@/features/logistics/api";
import { useThemeMode } from "@/shared/theme/useThemeMode";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p1",
    displayName: "Test Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 2,
    currentMilestoneProgress: 0,
  });
  vi.spyOn(libraryApi, "items").mockResolvedValue([
    { id: "Desc_IronPlateReinforced_C", name: "Reinforced Iron Plate", category: "part", stackSize: 100, isFluid: false },
    { id: "Desc_Rotor_C", name: "Rotor", category: "part", stackSize: 100, isFluid: false },
  ]);
});

afterEach(() => vi.restoreAllMocks());

describe("<NetworkView />", () => {
  it("shows a title and playthrough/tier subtitle, matching every other screen (#61/#72)", async () => {
    // Regresses: the graph used to render with no header at all, unlike
    // every other tab, and gave no clue which playthrough or tier it
    // was looking at.
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "iron",
        name: "Iron Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 4,
      },
    ]);
    vi.spyOn(logisticsApi, "list").mockResolvedValue([]);

    renderWithProviders(<NetworkView />);

    // Wait for the graph state specifically (not the "no factories"
    // empty state, which also renders an <h1>Network</h1>) before
    // reading the subtitle below it.
    await screen.findByTestId("rf__wrapper");
    expect(screen.getByRole("heading", { name: "Network" })).toBeInTheDocument();
    // Split across sibling text nodes by the JSX interpolation, so
    // match on the paragraph's combined text content rather than an
    // exact string.
    const subtitle = screen.getByText((_, el) => el?.textContent === "Test Run · T2");
    expect(subtitle.tagName).toBe("P");
  });

  it("shows a legend for the deficit/surplus badges", async () => {
    // #72: an orange down-arrow badge on a factory card had no legend
    // anywhere on the screen explaining what it meant.
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "iron",
        name: "Iron Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 4,
      },
    ]);
    vi.spyOn(logisticsApi, "list").mockResolvedValue([]);

    renderWithProviders(<NetworkView />);

    expect(await screen.findByText(/inputs in deficit/i)).toBeInTheDocument();
    expect(screen.getByText(/surplus, nothing ships it out/i)).toBeInTheDocument();
  });

  it("renders every factory as a node on the canvas, with two links between the same pair wired without crashing (#71)", async () => {
    // The label/curvature behaviour for parallel links between the same
    // pair (Iron Works -> Elevator Yard, previously collapsing into one
    // overlapping "5 ipm" edge) is unit-tested against `buildNetworkEdges`
    // directly in edgeStyle.test.ts — jsdom has no real layout engine, so
    // asserting on React Flow's own rendered SVG path isn't reliable here.
    // This is the integration half: the same two-link data passed through
    // the full component tree renders cleanly.
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "iron",
        name: "Iron Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 4,
      },
      {
        id: "elevator",
        name: "Elevator Yard",
        worldX: 100,
        worldY: 100,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 1,
      },
    ]);
    vi.spyOn(logisticsApi, "list").mockResolvedValue([
      {
        id: "link-rip",
        fromFactoryId: "iron",
        toFactoryId: "elevator",
        itemId: "Desc_IronPlateReinforced_C",
        itemsPerMinute: 5,
        transportKind: "belt",
        transportPlanJson: "{}",
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
      {
        id: "link-rotor",
        fromFactoryId: "iron",
        toFactoryId: "elevator",
        itemId: "Desc_Rotor_C",
        itemsPerMinute: 5,
        transportKind: "belt",
        transportPlanJson: "{}",
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    ]);

    renderWithProviders(<NetworkView />);

    expect(await screen.findByText("Iron Works")).toBeInTheDocument();
    expect(screen.getByText("Elevator Yard")).toBeInTheDocument();
  });

  it("follows the app's dark theme instead of xyflow's light default (#61/#72)", async () => {
    // Regresses: React Flow defaults to colorMode="light" and stamps a
    // `light` class on its own wrapper. brand.css scopes every
    // --color-* token under .light/.dark, so that wrapper class — not
    // FactoryNode's own (already theme-aware) classes — was what forced
    // the cards to render white-on-light inside an otherwise dark app.
    const priorMode = useThemeMode.getState().mode;
    useThemeMode.setState({ mode: "dark" });
    try {
      vi.spyOn(factoryApi, "list").mockResolvedValue([
        {
          id: "iron",
          name: "Iron Works",
          worldX: 0,
          worldY: 0,
          createdAt: "2026-05-10T00:00:00Z",
          updatedAt: "2026-05-10T00:00:00Z",
          machineCount: 4,
        },
      ]);
      vi.spyOn(logisticsApi, "list").mockResolvedValue([]);

      renderWithProviders(<NetworkView />);

      const wrapper = await screen.findByTestId("rf__wrapper");
      expect(wrapper).toHaveClass("dark");
      expect(wrapper).not.toHaveClass("light");
    } finally {
      useThemeMode.setState({ mode: priorMode });
    }
  });
});
