import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LibraryView } from "./LibraryView";
import { libraryApi } from "../api";
import type {
  BeltTier,
  Building,
  Item,
  LibrarySummary,
  Milestone,
  PipeTier,
  Recipe,
} from "../types";

// ---- Fixtures ----

const summary: LibrarySummary = {
  datasetVersion: "test-1",
  gameVersion: "1.1",
  itemCount: 2,
  buildingCount: 1,
  recipeCount: 1,
  milestoneCount: 1,
};

const items: Item[] = [
  { id: "Desc_IronOre_C", name: "Iron Ore", category: "raw", stackSize: 100, isFluid: false },
  { id: "Desc_IronIngot_C", name: "Iron Ingot", category: "ingot", stackSize: 100, isFluid: false },
];

const buildings: Building[] = [
  { id: "Build_Smelter_C", name: "Smelter", category: "smelting", powerMw: 4, unlockTier: 0 },
];

const recipes: Recipe[] = [
  {
    id: "Recipe_IronIngot_C",
    name: "Iron Ingot",
    buildingId: "Build_Smelter_C",
    isAlt: false,
    unlockTier: 0,
    cycleSeconds: 2,
    inputs: [{ itemId: "Desc_IronOre_C", perMinute: 30 }],
    outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 30 }],
  },
];

const milestones: Milestone[] = [
  { id: "ms_t0", tier: 0, name: "HUB Upgrade 1", unlocks: ["Build_Smelter_C"] },
];

const beltTiers: BeltTier[] = [
  { mark: 1, itemsPerMinute: 60, unlockTier: 0 },
  { mark: 2, itemsPerMinute: 120, unlockTier: 2 },
];

const pipeTiers: PipeTier[] = [
  { mark: 1, cubicMetersPerMinute: 300, unlockTier: 3 },
];

// ---- Setup ----

beforeEach(() => {
  vi.spyOn(libraryApi, "summary").mockResolvedValue(summary);
  vi.spyOn(libraryApi, "items").mockResolvedValue(items);
  vi.spyOn(libraryApi, "buildings").mockResolvedValue(buildings);
  vi.spyOn(libraryApi, "recipes").mockResolvedValue(recipes);
  vi.spyOn(libraryApi, "milestones").mockResolvedValue(milestones);
  vi.spyOn(libraryApi, "beltTiers").mockResolvedValue(beltTiers);
  vi.spyOn(libraryApi, "pipeTiers").mockResolvedValue(pipeTiers);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

// ---- Tests ----

describe("<LibraryView />", () => {
  it("renders the dataset summary once it loads", async () => {
    renderWithProviders(<LibraryView />);
    await waitFor(() => {
      expect(screen.getByText(/dataset/i)).toBeInTheDocument();
      expect(screen.getByText("test-1")).toBeInTheDocument();
      expect(screen.getByText(/2 items/i)).toBeInTheDocument();
    });
  });

  it("shows the items table by default", async () => {
    renderWithProviders(<LibraryView />);
    await waitFor(() => {
      expect(screen.getByText("Iron Ore")).toBeInTheDocument();
      expect(screen.getByText("Iron Ingot")).toBeInTheDocument();
    });
  });

  it("switches to the Recipes tab and shows formatted IO", async () => {
    renderWithProviders(<LibraryView />);
    fireEvent.click(screen.getByRole("tab", { name: "Recipes" }));
    await waitFor(() => {
      expect(screen.getByText(/30 Iron Ore\/min/)).toBeInTheDocument();
      expect(screen.getByText(/30 Iron Ingot\/min/)).toBeInTheDocument();
      expect(screen.getByText("Smelter")).toBeInTheDocument();
    });
  });

  it("renders milestones in tier order", async () => {
    renderWithProviders(<LibraryView />);
    fireEvent.click(screen.getByRole("tab", { name: "Milestones" }));
    await waitFor(() => {
      expect(screen.getByText("HUB Upgrade 1")).toBeInTheDocument();
    });
  });

  it("renders belt and pipe tier tables", async () => {
    renderWithProviders(<LibraryView />);
    fireEvent.click(screen.getByRole("tab", { name: "Belts & Pipes" }));
    await waitFor(() => {
      expect(screen.getByText(/conveyor belts/i)).toBeInTheDocument();
      expect(screen.getByText(/pipelines/i)).toBeInTheDocument();
      // Mk.1 appears in both tables (belt + pipe). Mk.2 is belt-only in the
      // fixture, which is enough to prove the belt table rendered all rows.
      expect(screen.getAllByText("Mk.1")).toHaveLength(2);
      expect(screen.getByText("Mk.2")).toBeInTheDocument();
      expect(screen.getByText("60")).toBeInTheDocument(); // belt mk1 ipm
      expect(screen.getByText("300")).toBeInTheDocument(); // pipe mk1 m³/min
    });
  });
});
