import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AddMachineForm } from "./AddMachineForm";
import { libraryApi } from "@/features/library/api";
import { playthroughApi } from "@/features/playthrough/api";

const buildings = [
  { id: "Build_SmelterMk1_C", name: "Smelter", category: "smelting" as const, powerMw: 4, unlockTier: 0 },
  { id: "Build_AssemblerMk1_C", name: "Assembler", category: "manufacturing" as const, powerMw: 15, unlockTier: 1 },
];

const recipes = [
  {
    id: "Recipe_IronIngot_C", name: "Iron Ingot",
    buildingId: "Build_SmelterMk1_C", isAlt: false, unlockTier: 0, cycleSeconds: 2,
    inputs: [{ itemId: "Desc_IronOre_C", perMinute: 30 }],
    outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 30 }],
  },
  {
    id: "Recipe_Rotor_C", name: "Rotor",
    buildingId: "Build_AssemblerMk1_C", isAlt: false, unlockTier: 1, cycleSeconds: 15,
    inputs: [{ itemId: "Desc_IronRod_C", perMinute: 20 }, { itemId: "Desc_IronScrew_C", perMinute: 100 }],
    outputs: [{ itemId: "Desc_Rotor_C", perMinute: 4 }],
  },
];

beforeEach(() => {
  vi.spyOn(libraryApi, "buildings").mockResolvedValue(buildings);
  vi.spyOn(libraryApi, "recipes").mockResolvedValue(recipes);
});

afterEach(() => vi.restoreAllMocks());

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

async function openRecipeCombobox(user: ReturnType<typeof userEvent.setup>) {
  // Headless UI renders the listbox only when the combobox is open. ArrowDown
  // on a focused combobox is the standard ARIA combobox open gesture and is
  // the most reliable trigger across Headless UI v2 + jsdom.
  const combobox = await screen.findByRole("combobox", { name: /recipe/i });
  await user.click(combobox);
  await user.keyboard("{ArrowDown}");
  return combobox;
}

describe("<AddMachineForm /> — tier gating", () => {
  it("only offers recipes the active playthrough has unlocked", async () => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p", displayName: "Run", gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z", currentTier: 0, currentMilestoneProgress: 0,
    });
    const user = userEvent.setup();
    renderWithProviders(<AddMachineForm factoryId="f1" />);
    await openRecipeCombobox(user);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Iron Ingot/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("option", { name: /Rotor/i })).toBeNull();
  });

  it("offers higher-tier recipes once the playthrough catches up", async () => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p", displayName: "Run", gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z", currentTier: 1, currentMilestoneProgress: 0,
    });
    const user = userEvent.setup();
    renderWithProviders(<AddMachineForm factoryId="f1" />);
    await openRecipeCombobox(user);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Iron Ingot/i })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Rotor/i })).toBeInTheDocument();
    });
  });

  it("offers everything when no playthrough is active", async () => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithProviders(<AddMachineForm factoryId="f1" />);
    await openRecipeCombobox(user);
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Iron Ingot/i })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: /Rotor/i })).toBeInTheDocument();
    });
  });
});
