import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { libraryApi } from "@/features/library/api";
import { plannerApi } from "@/features/planner/api";
import { playthroughApi } from "@/features/playthrough/api";

import { FactoryPowerPanel } from "./FactoryPowerPanel";
import { powerApi } from "../api";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/**
 * Drives a `FilterSelect` by typing and pressing Enter rather than by
 * clicking the option. Both pickers here portal their listbox to the
 * body, and clicking a portaled option while the other picker's panel
 * is still unmounting is what made these flows flaky; typing filters to
 * one option and Enter takes the active one, which needs no hit test.
 *
 * Waiting for `enabled` matters too: both pickers stay disabled until
 * the catalog and tier reads land.
 */
async function pickOption(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  text: string,
): Promise<void> {
  const combobox = await screen.findByRole("combobox", { name: label });
  await waitFor(() => expect(combobox).toBeEnabled());
  await user.click(combobox);
  await user.keyboard(text);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(combobox).toHaveValue(text));
}

beforeEach(() => {
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 5,
    currentMilestoneProgress: 0,
  });
  vi.spyOn(libraryApi, "generators").mockResolvedValue([
    {
      id: "Build_GeneratorCoal_C",
      name: "Coal Generator",
      category: "burner",
      powerMw: 75,
      unlockTier: 3,
      fuels: [{ fuelItemId: "Desc_Coal_C", fuelPerMinute: 15 }],
    },
    {
      id: "Build_GeneratorNuclear_C",
      name: "Nuclear Power Plant",
      category: "nuclear",
      powerMw: 2500,
      unlockTier: 8,
      fuels: [{ fuelItemId: "Desc_NuclearFuelRod_C", fuelPerMinute: 0.2 }],
    },
  ]);
  vi.spyOn(libraryApi, "items").mockResolvedValue([
    { id: "Desc_Coal_C", name: "Coal", category: "raw", stackSize: 100, isFluid: false },
  ]);
  vi.spyOn(plannerApi, "listItemTiers").mockResolvedValue([
    { itemId: "Desc_Coal_C", tier: 0, standardTier: 0 },
  ]);
  vi.spyOn(powerApi, "list").mockResolvedValue([]);
  vi.spyOn(powerApi, "balance").mockResolvedValue({
    factoryId: "f1",
    generatedMw: 0,
    consumedMw: 28,
    netMw: -28,
    fuelFlows: [],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<FactoryPowerPanel />", () => {
  it("prints this factory's balance so the draw and the fix sit on one screen", async () => {
    renderWithProviders(<FactoryPowerPanel factoryId="f1" />);
    expect(await screen.findByText("28.0 MW")).toBeInTheDocument();
    expect(screen.getByText("-28.0 MW")).toBeInTheDocument();
  });

  it("frames a shortfall as drawing from the grid rather than an error", async () => {
    // A factory on a shared grid drawing the difference from elsewhere
    // is normal play — the grid-wide verdict belongs to Validate.
    renderWithProviders(<FactoryPowerPanel factoryId="f1" />);
    expect(
      await screen.findByText(/draws 28.0 MW more than it makes/i),
    ).toBeInTheDocument();
  });

  it("adds a generator against this factory without leaving it", async () => {
    const add = vi.spyOn(powerApi, "add").mockResolvedValue({
      id: "g1",
      factoryId: "f1",
      generatorId: "Build_GeneratorCoal_C",
      fuelItemId: "Desc_Coal_C",
      count: 4,
      clockPct: 100,
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    });
    const user = userEvent.setup();
    renderWithProviders(<FactoryPowerPanel factoryId="f1" />);

    await pickOption(user, /^generator$/i, "Coal Generator");
    await pickOption(user, /^fuel$/i, "Coal");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        factoryId: "f1",
        generatorId: "Build_GeneratorCoal_C",
        fuelItemId: "Desc_Coal_C",
        count: 1,
        clockPct: 100,
      }),
    );
  });

  it("offers a hand-fed fuel, which is the only kind the first generator has", async () => {
    // A Biomass Burner burns Wood, which has no producing recipe at all
    // — reading the automated tier alone leaves the only generator a
    // Tier 0 playthrough can build with an empty fuel list.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(libraryApi, "generators").mockResolvedValue([
      {
        id: "Build_GeneratorBiomass_C",
        name: "Biomass Burner",
        category: "burner",
        powerMw: 30,
        unlockTier: 0,
        fuels: [{ fuelItemId: "Desc_Wood_C", fuelPerMinute: 18 }],
      },
    ]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([
      { id: "Desc_Wood_C", name: "Wood", category: "raw", stackSize: 200, isFluid: false },
    ]);
    vi.spyOn(plannerApi, "listItemTiers").mockResolvedValue([
      { itemId: "Desc_Wood_C", tier: null, standardTier: null, handGatheredTier: 0 },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<FactoryPowerPanel factoryId="f1" />);
    await pickOption(user, /^generator$/i, "Biomass Burner");
    await pickOption(user, /^fuel$/i, "Wood");

    expect(screen.getByRole("combobox", { name: /^fuel$/i })).toHaveValue("Wood");
  });

  it("holds the pickers shut until the catalog lands, rather than reading as nothing available", async () => {
    // An empty fuel picker is what a player sees when a fuel is out of
    // reach at their tier. A half-loaded panel must not impersonate
    // that, or every open of this panel looks briefly like a bug.
    renderWithProviders(<FactoryPowerPanel factoryId="f1" />);
    expect(screen.getByPlaceholderText("Loading generators…")).toBeDisabled();
    expect(screen.getByPlaceholderText("Loading fuels…")).toBeDisabled();

    await waitFor(() =>
      expect(screen.getByPlaceholderText("Pick a generator…")).toBeEnabled(),
    );
  });

  it("offers only the generators this tier has unlocked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FactoryPowerPanel factoryId="f1" />);
    const combobox = await screen.findByRole("combobox", { name: /^generator$/i });
    await waitFor(() => expect(combobox).toBeEnabled());
    await user.click(combobox);
    expect(await screen.findByRole("option", { name: /Coal Generator/ })).toBeInTheDocument();
    // T8 against a T5 playthrough.
    expect(screen.queryByRole("option", { name: /Nuclear Power Plant/ })).toBeNull();
  });

  it("says a factory has no generators rather than showing an empty table", async () => {
    renderWithProviders(<FactoryPowerPanel factoryId="f1" />);
    expect(await screen.findByText(/None yet/i)).toBeInTheDocument();
  });

  it("lists the generators already planned here", async () => {
    vi.spyOn(powerApi, "list").mockResolvedValue([
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
    renderWithProviders(<FactoryPowerPanel factoryId="f1" />);
    expect(await screen.findByText("4× Coal Generator")).toBeInTheDocument();
    expect(screen.getByText(/Coal · 100.0%/)).toBeInTheDocument();
  });

  it("only offers the whole-grid view where there's app nav to reach it", async () => {
    const { rerender } = renderWithProviders(<FactoryPowerPanel factoryId="f1" />);
    await screen.findByText("28.0 MW");
    expect(screen.queryByRole("button", { name: /every factory/i })).toBeNull();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <FactoryPowerPanel factoryId="f1" onOpenGridView={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("button", { name: /every factory/i }),
    ).toBeInTheDocument();
  });
});
