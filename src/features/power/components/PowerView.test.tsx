import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PowerView } from "./PowerView";
import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "@/features/factory/api";
import { libraryApi } from "@/features/library/api";
import { plannerApi } from "@/features/planner/api";
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
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "f1", generatedMw: 300, consumedMw: 60, netMw: 240, fuelFlows: [] },
    ]);
    renderWithProviders(<PowerView />);
    await waitFor(() => {
      expect(screen.getByText(/300.0 MW/i)).toBeInTheDocument();
      expect(screen.getByText(/240.0 MW/i)).toBeInTheDocument();
    });
  });

  it("lists a factory with no generators instead of hiding it, without a false alarm when the shared grid covers it", async () => {
    // The bug this regresses: a factory that draws power but never
    // built a generator used to be absent from the sidebar entirely,
    // and the header could read a healthy green net while a third of
    // the grid's draw was invisible.
    //
    // This fixture's grid nets +33.4 MW (0+75 generated vs 24+17.6
    // consumed) — comfortably positive. A factory with no local
    // generators on a healthy shared grid is completely normal (it's
    // just drawing the difference from elsewhere), which is also what
    // the validation sweep's own per-factory suppression rule says, so
    // Iron Works must appear but must NOT get the urgent "No power"
    // treatment here.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "iron",
        name: "Iron Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 6,
      },
      {
        id: "copper",
        name: "Copper Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 5,
      },
    ]);
    vi.spyOn(powerApi, "list").mockResolvedValue([]);
    // Only Copper Works has a generator row.
    vi.spyOn(powerApi, "listAll").mockResolvedValue([
      {
        id: "g1",
        factoryId: "copper",
        generatorId: "Build_GeneratorCoal_C",
        fuelItemId: "Desc_Coal_C",
        count: 1,
        clockPct: 100,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    ]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "copper",
      generatedMw: 75,
      consumedMw: 17.6,
      netMw: 57.4,
      fuelFlows: [],
    });
    // Iron Works draws 24 MW and has zero generators — the exact
    // shape from the recorded playthrough run this fix targets.
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "iron", generatedMw: 0, consumedMw: 24, netMw: -24, fuelFlows: [] },
      { factoryId: "copper", generatedMw: 75, consumedMw: 17.6, netMw: 57.4, fuelFlows: [] },
    ]);
    renderWithProviders(<PowerView />);

    // Iron Works now appears in the sidebar (it used to be hidden).
    await waitFor(() => {
      expect(screen.getByText("Iron Works")).toBeInTheDocument();
    });
    // The grid-wide total reflects both factories and reads as a
    // healthy surplus (0 + 75 generated vs 24 + 17.6 consumed = +33.4).
    await waitFor(() => {
      expect(screen.getByText(/33.4 MW/i)).toBeInTheDocument();
    });
    // No urgent badge for Iron Works — the grid comfortably covers it.
    expect(screen.queryByText(/No power/i)).not.toBeInTheDocument();
  });

  it("flags a factory with no generators as urgent once the shared grid itself is short", async () => {
    // Codex P2: the counterpart to the test above. The same zero-
    // generator shape is a real problem once the grid can no longer
    // cover it — Copper Works generates less than the combined draw
    // this time, so the grid nets negative and the validation sweep
    // would surface both factories' deficits. Iron Works must get the
    // urgent "No power" badge here.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "iron",
        name: "Iron Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 6,
      },
      {
        id: "copper",
        name: "Copper Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 5,
      },
    ]);
    vi.spyOn(powerApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([
      {
        id: "g1",
        factoryId: "copper",
        generatorId: "Build_GeneratorCoal_C",
        fuelItemId: "Desc_Coal_C",
        count: 1,
        clockPct: 100,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    ]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "copper",
      generatedMw: 15,
      consumedMw: 17.6,
      netMw: -2.6,
      fuelFlows: [],
    });
    // 0 + 15 generated vs 24 + 17.6 consumed = -26.6 net — the grid
    // itself is short.
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "iron", generatedMw: 0, consumedMw: 24, netMw: -24, fuelFlows: [] },
      { factoryId: "copper", generatedMw: 15, consumedMw: 17.6, netMw: -2.6, fuelFlows: [] },
    ]);
    renderWithProviders(<PowerView />);

    await waitFor(() => {
      expect(screen.getByText("Iron Works")).toBeInTheDocument();
    });
    // Grid deficit hint (unambiguous vs. the Net figure, which the
    // same "26.6" also appears in elsewhere on the page).
    await waitFor(() => {
      expect(screen.getByText(/draws 26.6 mw more than it generates/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/No power/i)).toBeInTheDocument();
  });

  it("badges the generator count summed across rows, not the row count", async () => {
    // The bug this regresses: 8 Biomass Burners split across two rows
    // (e.g. differing notes) read "2" in the sidebar badge — a count
    // of rows presented as a count of generators.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "iron",
        name: "Iron Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 6,
      },
    ]);
    vi.spyOn(powerApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([
      {
        id: "g1",
        factoryId: "iron",
        generatorId: "Build_GeneratorBiomass_C",
        fuelItemId: "Desc_Leaves_C",
        count: 4,
        clockPct: 100,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
      {
        id: "g2",
        factoryId: "iron",
        generatorId: "Build_GeneratorBiomass_C",
        fuelItemId: "Desc_Leaves_C",
        count: 4,
        clockPct: 100,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    ]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "iron",
      generatedMw: 40,
      consumedMw: 24,
      netMw: 16,
      fuelFlows: [],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "iron", generatedMw: 40, consumedMw: 24, netMw: 16, fuelFlows: [] },
    ]);
    renderWithProviders(<PowerView />);

    expect(
      await screen.findByTitle("8 generators"),
    ).toBeInTheDocument();
  });

  it("gives a healthy factory's generator badge a success colour, not the same amber the deficit badge uses", async () => {
    // #72: a positive-net factory's sidebar chip used the same
    // bg-warning/text-warning classes as a genuinely short factory's
    // deficit chip, so a healthy factory and a struggling one looked
    // alike at a glance despite meaning opposite things.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 3,
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
      generatedMw: 300,
      consumedMw: 60,
      netMw: 240,
      fuelFlows: [],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "f1", generatedMw: 300, consumedMw: 60, netMw: 240, fuelFlows: [] },
    ]);
    renderWithProviders(<PowerView />);

    const badge = await screen.findByTitle("4 generators");
    expect(badge).toHaveClass("text-success");
    expect(badge).not.toHaveClass("text-warning");
  });

  it("coalesces duplicate generator rows in the table, with a Merge action that consolidates them", async () => {
    // #72: two rows with the same generator, fuel and clock (e.g. one
    // Add per building session instead of noticing the row that's
    // already there) rendered as two separate lines, each showing its
    // own partial count, instead of reading as one bank.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "iron",
        name: "Iron Works",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 6,
      },
    ]);
    vi.spyOn(powerApi, "list").mockResolvedValue([
      {
        id: "g1",
        factoryId: "iron",
        generatorId: "Build_GeneratorBiomass_C",
        fuelItemId: "Desc_Leaves_C",
        count: 4,
        clockPct: 100,
        notes: "first batch",
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
      {
        id: "g2",
        factoryId: "iron",
        generatorId: "Build_GeneratorBiomass_C",
        fuelItemId: "Desc_Leaves_C",
        count: 4,
        clockPct: 100,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    ]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "iron",
      generatedMw: 40,
      consumedMw: 24,
      netMw: 16,
      fuelFlows: [],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "iron", generatedMw: 40, consumedMw: 24, netMw: 16, fuelFlows: [] },
    ]);
    vi.spyOn(powerApi, "update").mockResolvedValue(undefined);
    vi.spyOn(powerApi, "remove").mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<PowerView />);

    // One row, summed count, marked as a merge of two rows — not two
    // rows each reading "4".
    const countCell = await screen.findByText("8");
    expect(countCell.closest("tr")).toHaveTextContent("(2×)");
    expect(screen.queryByText("4", { selector: "td" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /merge/i }));

    await waitFor(() => {
      // The surviving row absorbs the total count and the other row's
      // note — nothing about the second row silently disappears.
      expect(powerApi.update).toHaveBeenCalledWith({
        id: "g1",
        count: 8,
        clockPct: 100,
        fuelItemId: "Desc_Leaves_C",
        notes: "first batch",
      });
      expect(powerApi.remove).toHaveBeenCalledWith("g2");
    });
  });

  it("gates the fuel picker by each fuel item's own tier, not the generator's", async () => {
    // Regresses: the Fuel Generator unlocks well before Rocket Fuel and
    // Ionized Fuel do, so gating the fuel list on the generator's own
    // unlockTier let both leak in at Tier 6 — years ahead of the T8/T9
    // recipes that actually produce them. The generator picker beside it
    // was already correctly gated, which is what made this stand out.
    const user = userEvent.setup();
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 6,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "f1",
        name: "Fuel Plant",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 0,
      },
    ]);
    vi.spyOn(libraryApi, "generators").mockResolvedValue([
      {
        id: "Build_GeneratorFuel_C",
        name: "Fuel Generator",
        category: "fluid",
        powerMw: 250,
        unlockTier: 4,
        fuels: [
          { fuelItemId: "Desc_LiquidFuel_C", fuelPerMinute: 20 },
          { fuelItemId: "Desc_RocketFuel_C", fuelPerMinute: 10 },
        ],
      },
    ]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([
      { id: "Desc_LiquidFuel_C", name: "Fuel", category: "fluid", stackSize: 0, isFluid: true },
      { id: "Desc_RocketFuel_C", name: "Rocket Fuel", category: "fluid", stackSize: 0, isFluid: true },
    ]);
    // Whole-chain tiers, not each fuel's own recipe stamp — Rocket Fuel's
    // standard recipe is stamped T8 here specifically because its real
    // chain (not exercised by this fixture) is what should gate it, not
    // the Fuel Generator's own T4 unlock.
    vi.spyOn(plannerApi, "listItemTiers").mockResolvedValue([
      { itemId: "Desc_LiquidFuel_C", tier: 4, standardTier: 4 },
      { itemId: "Desc_RocketFuel_C", tier: 8, standardTier: 8 },
    ]);
    vi.spyOn(powerApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "f1",
      generatedMw: 0,
      consumedMw: 0,
      netMw: 0,
      fuelFlows: [],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "f1", generatedMw: 0, consumedMw: 0, netMw: 0, fuelFlows: [] },
    ]);

    renderWithProviders(<PowerView />);
    await user.click(await screen.findByRole("button", { name: /add generator/i }));

    const generatorCombobox = screen.getByRole("combobox", { name: /^generator$/i });
    await user.click(generatorCombobox);
    await user.click(await screen.findByRole("option", { name: /fuel generator/i }));

    const fuelCombobox = screen.getByRole("combobox", { name: /^fuel$/i });
    await user.click(fuelCombobox);
    await user.keyboard("{ArrowDown}");
    // The eligible fuel's option reads "Fuel <rate> /min" (label + hint);
    // matched loosely so it isn't confused with "Rocket Fuel".
    expect(await screen.findByRole("option", { name: /^fuel\b/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /rocket fuel/i })).not.toBeInTheDocument();
  });

  it("labels fuel demand with the unit the rows actually use instead of a hardcoded one", async () => {
    // Regresses: the header always read "FUEL DEMAND (ITEMS / MIN)" even
    // when every row underneath was a fluid shown in m³/min.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 6,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "f1",
        name: "Oil Power Plant",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 0,
      },
    ]);
    vi.spyOn(powerApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "f1",
      generatedMw: 250,
      consumedMw: 0,
      netMw: 250,
      fuelFlows: [
        { itemId: "Desc_LiquidFuel_C", itemName: "Fuel", isFluid: true, perMinute: 64.96 },
      ],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "f1", generatedMw: 250, consumedMw: 0, netMw: 250, fuelFlows: [] },
    ]);

    renderWithProviders(<PowerView />);
    expect(await screen.findByText("64.96 m³/min")).toBeInTheDocument();
    expect(screen.getByText(/fuel demand \(m³ \/ min\)/i)).toBeInTheDocument();
  });

  it("closes the edit-generator modal on Escape, matching every other modal", async () => {
    const user = userEvent.setup();
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
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "f1",
      generatedMw: 300,
      consumedMw: 0,
      netMw: 300,
      fuelFlows: [],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "f1", generatedMw: 300, consumedMw: 0, netMw: 300, fuelFlows: [] },
    ]);

    renderWithProviders(<PowerView />);
    await user.click(await screen.findByRole("button", { name: /edit generator/i }));
    expect(await screen.findByText(/edit generator/i, { selector: "h2" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText(/edit generator/i, { selector: "h2" })).not.toBeInTheDocument();
    });
  });

  it("never offers a fuel the product picker itself refuses to plan, in either the Add or Edit picker (#94)", async () => {
    // Plutonium Fuel Rod's whole chain requires Uranium Waste, which has
    // no producing recipe in the dataset — `list_item_tiers` leaves it
    // out entirely (see tier.rs's whole-chain relaxation), and the
    // product picker already reflects that by not offering it. Both the
    // Add form and the Edit modal gate every fuel by that same
    // `useItemTiers` table (not the generator's own unlockTier, and not
    // each fuel's own recipe stamp), so an item absent from the table —
    // "no chain reaches this, ever" — is excluded here exactly the same
    // way it's excluded from the product picker. This pins that down
    // explicitly for the Nuclear Power Plant / Plutonium Fuel Rod pair
    // named in #94, so the two screens can't drift back out of sync.
    const user = userEvent.setup();
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 9,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "nuclear",
        name: "Nuclear Plant",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 0,
      },
    ]);
    vi.spyOn(libraryApi, "generators").mockResolvedValue([
      {
        id: "Build_GeneratorNuclear_C",
        name: "Nuclear Power Plant",
        category: "nuclear",
        powerMw: 2500,
        unlockTier: 7,
        fuels: [
          { fuelItemId: "Desc_NuclearFuelRod_C", fuelPerMinute: 0.2, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 240 },
          { fuelItemId: "Desc_PlutoniumFuelRod_C", fuelPerMinute: 0.1, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 240 },
          { fuelItemId: "Desc_FicsoniumFuelRod_C", fuelPerMinute: 1, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 1000 },
        ],
      },
    ]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([
      { id: "Desc_NuclearFuelRod_C", name: "Uranium Fuel Rod", category: "part", stackSize: 50, isFluid: false },
      { id: "Desc_PlutoniumFuelRod_C", name: "Plutonium Fuel Rod", category: "part", stackSize: 50, isFluid: false },
      { id: "Desc_FicsoniumFuelRod_C", name: "Ficsonium Fuel Rod", category: "part", stackSize: 50, isFluid: false },
    ]);
    // Uranium and Ficsonium fuel rods' chains ground out; Plutonium Fuel
    // Rod's doesn't reach `list_item_tiers` at all — items no chain ever
    // reaches are left out server-side entirely, not sent with a null
    // tier (two reachable fuels here so the Edit modal's `fuelOptions.length
    // > 1` gate actually renders the picker instead of skipping it).
    vi.spyOn(plannerApi, "listItemTiers").mockResolvedValue([
      { itemId: "Desc_NuclearFuelRod_C", tier: 7, standardTier: 7 },
      { itemId: "Desc_FicsoniumFuelRod_C", tier: 9, standardTier: 9 },
    ]);
    vi.spyOn(powerApi, "list").mockResolvedValue([
      {
        id: "g1",
        factoryId: "nuclear",
        generatorId: "Build_GeneratorNuclear_C",
        fuelItemId: "Desc_NuclearFuelRod_C",
        count: 2,
        clockPct: 100,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    ]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "nuclear",
      generatedMw: 5000,
      consumedMw: 0,
      netMw: 5000,
      fuelFlows: [],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "nuclear", generatedMw: 5000, consumedMw: 0, netMw: 5000, fuelFlows: [] },
    ]);

    renderWithProviders(<PowerView />);

    // Add form: picking the Nuclear Power Plant offers only the
    // reachable fuel.
    await user.click(await screen.findByRole("button", { name: /add generator/i }));
    const generatorCombobox = screen.getByRole("combobox", { name: /^generator$/i });
    await user.click(generatorCombobox);
    await user.click(await screen.findByRole("option", { name: /nuclear power plant/i }));
    const fuelCombobox = screen.getByRole("combobox", { name: /^fuel$/i });
    await user.click(fuelCombobox);
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("option", { name: /uranium fuel rod/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /ficsonium fuel rod/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /plutonium fuel rod/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    // Edit modal on the existing (reachable-fuel) row: still no
    // Plutonium Fuel Rod option, since it isn't the row's current fuel
    // and it isn't reachable either.
    await user.click(await screen.findByRole("button", { name: /edit generator/i }));
    expect(screen.queryByRole("option", { name: /plutonium fuel rod/i })).not.toBeInTheDocument();
  });
});
