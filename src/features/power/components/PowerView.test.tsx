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

  it("keeps the duplicate rows when the merge's update fails, instead of deleting them anyway", async () => {
    // The update and the deletes used to fire together. If the update
    // failed and the deletes landed, the survivors were gone and the
    // primary never took on their count — the bank silently shrank with
    // nothing on screen saying so.
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
    const row = (id: string) => ({
      id,
      factoryId: "iron",
      generatorId: "Build_GeneratorBiomass_C",
      fuelItemId: "Desc_Leaves_C",
      count: 4,
      clockPct: 100,
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    });
    vi.spyOn(powerApi, "list").mockResolvedValue([row("g1"), row("g2")]);
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
    vi.spyOn(powerApi, "update").mockRejectedValue(new Error("db is locked"));
    const remove = vi.spyOn(powerApi, "remove").mockResolvedValue(undefined);
    // The failure is logged as well as shown; keep it out of the run's output.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const user = userEvent.setup();
    renderWithProviders(<PowerView />);
    await screen.findByText("8");
    await user.click(screen.getByRole("button", { name: /merge/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Merge failed: db is locked/);
    // The whole point: nothing was deleted, so both rows survive and the
    // player can try again.
    expect(remove).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("says the counts merged when a delete fails afterwards, not that the merge failed", async () => {
    // The other half of the failure space. Once the update lands the
    // primary already counts the rows still sitting there, so the group
    // is double-counted — reporting "Merge failed" would be a lie, and
    // the player needs to know there are leftovers to clear.
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
    const row = (id: string) => ({
      id,
      factoryId: "iron",
      generatorId: "Build_GeneratorBiomass_C",
      fuelItemId: "Desc_Leaves_C",
      count: 4,
      clockPct: 100,
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    });
    vi.spyOn(powerApi, "list").mockResolvedValue([row("g1"), row("g2"), row("g3")]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "iron",
      generatedMw: 60,
      consumedMw: 24,
      netMw: 36,
      fuelFlows: [],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "iron", generatedMw: 60, consumedMw: 24, netMw: 36, fuelFlows: [] },
    ]);
    vi.spyOn(powerApi, "update").mockResolvedValue(undefined);
    // First delete lands, second doesn't — one leftover.
    const remove = vi
      .spyOn(powerApi, "remove")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("row is locked"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const user = userEvent.setup();
    renderWithProviders(<PowerView />);
    await screen.findByText("12");
    await user.click(screen.getByRole("button", { name: /merge/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Counts merged/);
    expect(alert).toHaveTextContent(/1 duplicate row couldn't be removed/);
    expect(alert).toHaveTextContent(/counted twice/);
    expect(alert).not.toHaveTextContent(/Merge failed/);
    // Sequential, so the failure stops the run rather than firing the
    // rest of the deletes into the dark.
    expect(remove).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
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

  it("offers the Biomass Burner its hand-fed fuels at Tier 0", async () => {
    // Regresses: every burner fuel is hand-gathered or made from
    // something hand-gathered, so none of them has an automated tier.
    // Gating on that tier alone read as "nothing available" at every
    // tier, which left a Tier 0 playthrough with no way to generate a
    // single MW.
    const user = userEvent.setup();
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.2",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "f1",
        name: "Starter Base",
        worldX: 0,
        worldY: 0,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
        machineCount: 0,
      },
    ]);
    vi.spyOn(libraryApi, "generators").mockResolvedValue([
      {
        id: "Build_GeneratorBiomass_C",
        name: "Biomass Burner",
        category: "burner",
        powerMw: 30,
        unlockTier: 0,
        fuels: [
          { fuelItemId: "Desc_Wood_C", fuelPerMinute: 18 },
          { fuelItemId: "Desc_Biofuel_C", fuelPerMinute: 4 },
        ],
      },
    ]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([
      { id: "Desc_Wood_C", name: "Wood", category: "raw", stackSize: 200, isFluid: false },
      { id: "Desc_Biofuel_C", name: "Solid Biofuel", category: "part", stackSize: 200, isFluid: false },
    ]);
    // No automated route to either — Solid Biofuel's Tier 2 recipe runs
    // on Biomass, which runs on Wood a player carries in.
    vi.spyOn(plannerApi, "listItemTiers").mockResolvedValue([
      { itemId: "Desc_Wood_C", tier: null, standardTier: null, handGatheredTier: 0 },
      { itemId: "Desc_Biofuel_C", tier: null, standardTier: null, handGatheredTier: 2 },
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
    await user.click(await screen.findByRole("option", { name: /biomass burner/i }));

    const fuelCombobox = screen.getByRole("combobox", { name: /^fuel$/i });
    await user.click(fuelCombobox);
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("option", { name: /^wood\b/i })).toBeInTheDocument();
    // Solid Biofuel is two tiers out even by hand — the burner takes it,
    // the playthrough can't make it yet.
    expect(screen.queryByRole("option", { name: /solid biofuel/i })).not.toBeInTheDocument();
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

  it("shows a nuclear generator's byproducts alongside its fuel demand (#94)", async () => {
    // The waste path used to be something only a human tracked beside
    // the app; now that a generator's balance states its byproducts,
    // this is the visible last mile — the same shape as fuel demand,
    // right next to it, not folded into it or dropped silently.
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 8,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([
      {
        id: "f1",
        name: "Nuclear Plant",
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
      generatedMw: 2500,
      consumedMw: 0,
      netMw: 2500,
      fuelFlows: [
        { itemId: "Desc_NuclearFuelRod_C", itemName: "Uranium Fuel Rod", isFluid: false, perMinute: 0.4 },
      ],
      byproductFlows: [
        { itemId: "Desc_NuclearWaste_C", itemName: "Uranium Waste", isFluid: false, perMinute: 10 },
      ],
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "f1", generatedMw: 2500, consumedMw: 0, netMw: 2500, fuelFlows: [] },
    ]);

    renderWithProviders(<PowerView />);

    expect(await screen.findByText(/byproducts \(items \/ min\)/i)).toBeInTheDocument();
    expect(screen.getByText("Uranium Waste")).toBeInTheDocument();
    expect(screen.getByText("10.00 /min")).toBeInTheDocument();
  });

  it("doesn't render a Byproducts card for a clean-burning generator", async () => {
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
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(powerApi, "balance").mockResolvedValue({
      factoryId: "f1",
      generatedMw: 300,
      consumedMw: 0,
      netMw: 300,
      fuelFlows: [
        { itemId: "Desc_Coal_C", itemName: "Coal", isFluid: false, perMinute: 60 },
      ],
      // No byproductFlows field at all — the common (non-nuclear) case.
    });
    vi.spyOn(powerApi, "listBalances").mockResolvedValue([
      { factoryId: "f1", generatedMw: 300, consumedMw: 0, netMw: 300, fuelFlows: [] },
    ]);

    renderWithProviders(<PowerView />);

    await screen.findByText("Coal");
    expect(screen.queryByText(/byproducts/i)).not.toBeInTheDocument();
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

  it("holds the add-generator pickers shut while the tier table is still loading", async () => {
    // This screen and the production plan's power panel render the same
    // `AddPowerGenForm`, so neither can drift on what a half-loaded
    // picker says. An empty fuel list is what a player sees when a fuel
    // is out of reach at their tier; a still-loading form must not
    // impersonate that.
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

    // Hold the tier table open so the form mounts mid-load — the state
    // the guard exists for. Everything else resolves, so the only reason
    // the pickers can be shut is the read that hasn't landed.
    vi.spyOn(plannerApi, "listItemTiers").mockReturnValue(new Promise(() => {}));

    renderWithProviders(<PowerView />);
    await user.click(await screen.findByRole("button", { name: /add generator/i }));

    expect(await screen.findByPlaceholderText("Loading generators…")).toBeDisabled();
    expect(screen.getByPlaceholderText("Loading fuels…")).toBeDisabled();
    // A regression that left optionsLoading permanently false would show
    // the ordinary placeholders here and pass a test that only asserted
    // the enabled state.
    expect(screen.queryByPlaceholderText("Pick a generator…")).toBeNull();
  });
});
