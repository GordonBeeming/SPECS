import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { HomeView } from "./HomeView";
import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "@/features/factory/api";
import { libraryApi } from "@/features/library/api";
import { altsApi } from "@/features/alts/api";
import type { Recipe } from "@/features/library/types";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function altRecipe(id: string, name: string, unlockTier: number): Recipe {
  return {
    id,
    name,
    buildingId: "Build_AssemblerMk1_C",
    isAlt: true,
    unlockTier,
    cycleSeconds: 6,
    inputs: [],
    outputs: [{ itemId: "Desc_IronPlate_C", perMinute: 30 }],
  };
}

beforeEach(() => {
  vi.spyOn(factoryApi, "list").mockResolvedValue([]);
  vi.spyOn(libraryApi, "buildings").mockResolvedValue([]);
  vi.spyOn(playthroughApi, "getAmplifierInventory").mockResolvedValue({
    somersloopQuantity: 0,
    powerShardQuantity: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<HomeView /> alts stat tile", () => {
  it("counts against alts reachable at the current tier, not the whole catalogue (#72)", async () => {
    // Regresses: "Alts unlocked 0 of 111 total" counted every alt in the
    // dataset regardless of tier, so the denominator never moved when
    // the playthrough's tier did.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p1",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 2,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([
      altRecipe("Recipe_Alt_A_C", "Alt A", 0),
      altRecipe("Recipe_Alt_B_C", "Alt B", 2),
      // Above the T2 playthrough — must not count toward the denominator.
      altRecipe("Recipe_Alt_C_C", "Alt C", 7),
    ]);
    // Only Alt A is actually unlocked.
    vi.spyOn(altsApi, "list").mockResolvedValue([
      { recipeId: "Recipe_Alt_A_C", unlockedAt: "2026-01-01T00:00:00Z" },
    ]);

    renderWithProviders(<HomeView goTo={() => {}} />);

    expect(await screen.findByText("of 2 reachable at T2")).toBeInTheDocument();
    // "1" unlocked (Alt A) — not 3 (whole catalogue) and not 0.
    const tile = (await screen.findByText("Alts unlocked")).closest("button");
    expect(tile).toHaveTextContent("1");
  });

  it("doesn't let a force-unlocked above-tier alt push the count past the reachable denominator", async () => {
    // An above-tier alt can be unlocked early (warn, don't block — see
    // AltsView), but counting it here would print "2 of 1 reachable",
    // which reads as broken rather than as a deliberate early unlock.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p1",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([
      altRecipe("Recipe_Alt_A_C", "Alt A", 0),
      altRecipe("Recipe_Alt_C_C", "Alt C", 7),
    ]);
    // Both unlocked, including the above-tier one.
    vi.spyOn(altsApi, "list").mockResolvedValue([
      { recipeId: "Recipe_Alt_A_C", unlockedAt: "2026-01-01T00:00:00Z" },
      { recipeId: "Recipe_Alt_C_C", unlockedAt: "2026-01-01T00:00:00Z" },
    ]);

    renderWithProviders(<HomeView goTo={() => {}} />);

    expect(await screen.findByText("of 1 reachable at T0")).toBeInTheDocument();
    const tile = (await screen.findByText("Alts unlocked")).closest("button");
    expect(tile).toHaveTextContent("1");
  });
});
