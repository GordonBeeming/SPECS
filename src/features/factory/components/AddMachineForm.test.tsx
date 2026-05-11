import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AddMachineForm } from "./AddMachineForm";
import { libraryApi } from "@/features/library/api";
import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "../api";

const buildings = [
  { id: "Build_SmelterMk1_C", name: "Smelter", category: "smelting" as const, powerMw: 4, unlockTier: 0 },
  { id: "Build_AssemblerMk1_C", name: "Assembler", category: "manufacturing" as const, powerMw: 15, unlockTier: 1 },
  { id: "Build_ManufacturerMk1_C", name: "Manufacturer", category: "manufacturing" as const, powerMw: 55, unlockTier: 7 },
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
  {
    id: "Recipe_HeavyModularFrame_C", name: "Heavy Modular Frame",
    buildingId: "Build_ManufacturerMk1_C", isAlt: false, unlockTier: 7, cycleSeconds: 30,
    inputs: [{ itemId: "Desc_ModularFrame_C", perMinute: 10 }],
    outputs: [{ itemId: "Desc_HeavyModularFrame_C", perMinute: 2 }],
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

describe("<AddMachineForm /> — amplifiers", () => {
  beforeEach(() => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p", displayName: "Run", gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z", currentTier: 9, currentMilestoneProgress: 0,
    });
  });

  it("passes Somersloop + power-shard fields through to add_factory_machine", async () => {
    const spy = vi
      .spyOn(factoryApi, "addMachine")
      .mockResolvedValue({
        id: "m1",
        factoryId: "f1",
        buildingId: "Build_ManufacturerMk1_C",
        recipeId: "Recipe_HeavyModularFrame_C",
        count: 1,
        clockPct: 150,
        useSomersloop: true,
        somersloopSlotsFilled: 2,
        powerShardCount: 1,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      });
    const user = userEvent.setup();
    renderWithProviders(<AddMachineForm factoryId="f1" />);
    await openRecipeCombobox(user);
    const option = await screen.findByRole("option", { name: /Heavy Modular Frame/i });
    await user.click(option);

    // Open the amp disclosure and set 2/4 somersloop + 1 power shard.
    await user.click(screen.getByText(/Amplifiers/i));
    const slotsField = await screen.findByLabelText(/Somersloop slots filled/i);
    await user.clear(slotsField);
    await user.type(slotsField, "2");
    const shardField = screen.getByLabelText(/Power shards/i);
    await user.clear(shardField);
    await user.type(shardField, "1");
    // Clock cap with 1 shard is 150% — push it up so the cap actually
    // participates in the round-trip.
    const clockField = screen.getByLabelText(/Clock %/i);
    await user.clear(clockField);
    await user.type(clockField, "150");
    await user.click(screen.getByRole("button", { name: /^Add$/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          factoryId: "f1",
          buildingId: "Build_ManufacturerMk1_C",
          recipeId: "Recipe_HeavyModularFrame_C",
          useSomersloop: true,
          somersloopSlotsFilled: 2,
          powerShardCount: 1,
          clockPct: 150,
        }),
      );
    });
  });

  it("rejects a clock above the power-shard cap without round-tripping", async () => {
    const spy = vi.spyOn(factoryApi, "addMachine");
    const user = userEvent.setup();
    renderWithProviders(<AddMachineForm factoryId="f1" />);
    await openRecipeCombobox(user);
    await user.click(await screen.findByRole("option", { name: /Iron Ingot/i }));
    // 0 shards → cap stays at 100%. Bumping the clock to 200 should hit
    // the inline validation, not the network.
    const clockField = screen.getByLabelText(/Clock %/i);
    await user.clear(clockField);
    await user.type(clockField, "200");
    await user.click(screen.getByRole("button", { name: /^Add$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/only allow clocks up to 100/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
