import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("AltsView tier-scoped select", () => {
  it("Select reachable unlocks only alts at or below the current tier, leaving later-tier alts alone", async () => {
    // Regression for #97: "Select all" reaches above tier on purpose
    // (#47), so a narrower action is needed for "everything I can
    // actually build right now" — the action four tier groups in a row
    // wanted and didn't have. Mocked playthrough sits at T5.
    const aboveTier = altRecipe("Recipe_Alt_C_C", "Alt C");
    aboveTier.unlockTier = 7;
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([...recipes, aboveTier]);

    renderView(<AltsView />);
    await screen.findByText("Alt C");

    const selectReachable = screen.getByRole("button", { name: /select reachable/i });
    expect(selectReachable).not.toBeDisabled();

    fireEvent.click(selectReachable);
    await waitFor(() => {
      expect(altsApi.setMany).toHaveBeenCalledWith({
        // Alt A / Alt B unlock at T0 (reachable at T5); Alt C unlocks at
        // T7 and must not be swept in.
        recipeIds: ["Recipe_Alt_A_C", "Recipe_Alt_B_C"],
        unlocked: true,
      });
    });
  });

  it("disables Select reachable once every reachable alt is already unlocked, even with above-tier alts still locked", async () => {
    const aboveTier = altRecipe("Recipe_Alt_C_C", "Alt C");
    aboveTier.unlockTier = 7;
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([...recipes, aboveTier]);
    vi.spyOn(altsApi, "list").mockResolvedValue([
      { recipeId: "Recipe_Alt_A_C", unlockedAt: "2026-01-01T00:00:00Z" },
      { recipeId: "Recipe_Alt_B_C", unlockedAt: "2026-01-01T00:00:00Z" },
    ]);

    renderView(<AltsView />);
    await screen.findByText("Alt C");

    expect(screen.getByRole("button", { name: /select reachable/i })).toBeDisabled();
    // The plain "Select all" still has above-tier Alt C to offer.
    expect(screen.getByRole("button", { name: "Select all" })).not.toBeDisabled();
  });
});

describe("AltsView above-tier labelling", () => {
  it("badges a recipe that unlocks above the playthrough's current tier", async () => {
    // The mocked playthrough sits at T5 (see the module-level mock above).
    const aboveTier = altRecipe("Recipe_Alt_C_C", "Alt C");
    aboveTier.unlockTier = 7;
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([...recipes, aboveTier]);

    renderView(<AltsView />);
    await screen.findByText("Alt C");

    // "Alt A"/"Alt B" unlock at T0 — no badge. "Alt C" unlocks at T7,
    // above the T5 playthrough — badge shows and the tier line warns.
    expect(screen.queryAllByText("above your tier")).toHaveLength(1);
    expect(screen.getByText(/unlocks at T7/)).toHaveClass("text-warning");
  });

  it("doesn't badge an above-tier alt that's already ticked unlocked, only styles the row", async () => {
    // Ticking one ahead of tier is permitted (warn, don't block) — the
    // badge on the name plus the row tint is the whole signal; nothing
    // here should disable the checkbox or block the toggle.
    const aboveTier = altRecipe("Recipe_Alt_C_C", "Alt C");
    aboveTier.unlockTier = 7;
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([aboveTier]);
    vi.spyOn(altsApi, "list").mockResolvedValue([
      { recipeId: "Recipe_Alt_C_C", unlockedAt: "2026-01-01T00:00:00Z" },
    ]);

    renderView(<AltsView />);
    const checkbox = await screen.findByRole("checkbox", { name: /Alt C/i });
    expect(checkbox).toBeChecked();
    expect(checkbox).not.toBeDisabled();
    expect(screen.getByText("above your tier")).toBeInTheDocument();
  });

  it("dims an above-tier alt that isn't ticked, distinct from the ticked-and-above-tier warning row", async () => {
    // #60: "no locked styling on out-of-reach entries" — an above-tier
    // row that's still locked reads as "can't reach this yet" (dimmed),
    // not the same warning tint as one the player deliberately unlocked
    // early (previous test). Checkbox stays interactive either way —
    // this is a read, never a block.
    const aboveTier = altRecipe("Recipe_Alt_C_C", "Alt C");
    aboveTier.unlockTier = 7;
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([aboveTier]);

    renderView(<AltsView />);
    const checkbox = await screen.findByRole("checkbox", { name: /Alt C/i });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).not.toBeDisabled();
    const row = checkbox.closest("li");
    expect(row).toHaveClass("opacity-60");
    expect(row).not.toHaveClass("bg-warning/5");
  });
});

describe("AltsView tier filter", () => {
  it("groups rows under a tier header and narrows to one tier when the tier filter is set (#71)", async () => {
    const t2 = altRecipe("Recipe_Alt_T2_C", "Alt T2");
    t2.unlockTier = 2;
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([...recipes, t2]);

    renderView(<AltsView />);
    await screen.findByText("Alt T2");
    // Grouped headers for every tier present in the (unfiltered) list.
    expect(screen.getByText("Tier 0")).toBeInTheDocument();
    expect(screen.getByText("Tier 2")).toBeInTheDocument();

    const user = userEvent.setup();
    const tierCombobox = screen.getByRole("combobox", { name: /filter alts by tier/i });
    await user.click(tierCombobox);
    await user.click(await screen.findByRole("option", { name: "Tier 2" }));

    // Only the Tier 2 row and its header remain — Alt A / Alt B (T0)
    // drop out even though nothing about their *name* matched "2".
    expect(screen.getByText("Alt T2")).toBeInTheDocument();
    expect(screen.queryByText("Alt A")).not.toBeInTheDocument();
    expect(screen.queryByText("Alt B")).not.toBeInTheDocument();
    expect(screen.queryByText("Tier 0")).not.toBeInTheDocument();
  });
});
