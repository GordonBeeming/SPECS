import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AltsView } from "./AltsView";
import { altsApi } from "../api";
import { libraryApi } from "@/features/library/api";
import type { Recipe } from "@/features/library/types";

vi.mock("@/features/playthrough/hooks/usePlaythroughs", () => ({
  useCurrentPlaythrough: () => ({ data: { id: "p1", displayName: "Test", currentTier: 5 } }),
}));

function altRecipe(id: string, name: string): Recipe {
  return {
    id,
    name,
    buildingId: "Build_AssemblerMk1_C",
    isAlt: true,
    unlockTier: 0,
    cycleSeconds: 6,
    inputs: [],
    outputs: [{ itemId: "Desc_IronPlate_C", perMinute: 30 }],
  };
}

const recipes: Recipe[] = [
  altRecipe("Recipe_Alt_A_C", "Alt A"),
  altRecipe("Recipe_Alt_B_C", "Alt B"),
];

function renderView(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(libraryApi, "recipes").mockResolvedValue(recipes);
  vi.spyOn(altsApi, "list").mockResolvedValue([]); // nothing unlocked
  vi.spyOn(altsApi, "setMany").mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AltsView bulk select", () => {
  it("Select all unlocks every visible alt; Select none is disabled when none are unlocked", async () => {
    renderView(<AltsView />);
    // Wait for the alt rows to load before checking the bulk buttons —
    // with an empty list "all visible unlocked" is vacuously true.
    await screen.findByText("Alt A");
    const selectAll = screen.getByRole("button", { name: /select all/i });
    const selectNone = screen.getByRole("button", { name: /select none/i });
    // Nothing unlocked yet → Select none has nothing to do.
    expect(selectNone).toBeDisabled();
    expect(selectAll).not.toBeDisabled();

    fireEvent.click(selectAll);
    await waitFor(() => {
      expect(altsApi.setMany).toHaveBeenCalledWith({
        recipeIds: ["Recipe_Alt_A_C", "Recipe_Alt_B_C"],
        unlocked: true,
      });
    });
  });
});
