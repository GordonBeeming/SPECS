import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "@/features/factory/api";
import type { Factory } from "@/features/factory/types";
import { resourcesApi } from "@/features/resources/api";
import type { ResourceNodeRow, WaterExtractorGroup } from "@/features/resources/types";
import { logisticsApi } from "@/features/logistics/api";
import { powerApi } from "@/features/power/api";
import { plannerApi } from "@/features/planner/api";
import { libraryApi } from "@/features/library/api";
import { coordChip } from "@/features/resources/display";
import { validationApi } from "@/features/validation/api";
import type { ValidationReport } from "@/features/validation/types";
import { formatFactoryPopoverSummary, MapView, nodeTooltip, QuickCreateFactoryPopover } from "./MapView";

const cleanValidationReport: ValidationReport = {
  currentTier: 0,
  findings: [],
  altShoppingList: [],
  grid: { generatedMw: 0, consumedMw: 0, netMw: 0 },
  checkedAt: "2026-05-10T00:00:00Z",
};

describe("formatFactoryPopoverSummary", () => {
  it("uses the factory's machine total, not a recipe-node count", () => {
    // Iron Works: 4 recipe nodes (Ingot/Plate/Rod/Screws) that add up to
    // 6 physical machines (2 Smelters + 4 Constructors). Pinning a case
    // where those two numbers differ is the whole point of this test.
    expect(formatFactoryPopoverSummary(6, 24)).toBe("6 machines · 24.0 MW");
  });

  it("singularizes for exactly one machine", () => {
    expect(formatFactoryPopoverSummary(1, 4)).toBe("1 machine · 4.0 MW");
  });
});

function sampleNode(overrides: Partial<ResourceNodeRow> = {}): Parameters<typeof nodeTooltip>[0] {
  return {
    resourceItemName: "Iron Ore",
    resourceItemId: "Desc_OreIron_C",
    kind: "miner_node",
    purity: "Normal",
    x: 10000,
    y: 10000,
    itemsPerMinute: 60,
    claim: null,
    ...overrides,
  };
}

describe("nodeTooltip", () => {
  it("keeps the plain bind hint for an unclaimed node", () => {
    expect(nodeTooltip(sampleNode(), new Map())).toBe(
      "Iron Ore · Normal · click to bind or drag onto a factory",
    );
  });

  it("names the coordinates and the feeding factory for a claimed node — the map's only record of that link", () => {
    const claimed = sampleNode({
      claim: {
        minerId: "Build_MinerMk1_C",
        clockPct: 100,
        factoryId: "f-1",
        notes: null,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    });
    const names = new Map([["f-1", "Iron Works"]]);
    expect(nodeTooltip(claimed, names)).toBe(
      "Iron Ore · Normal · 60 ipm · 0.1km E · 0.1km S · feeds Iron Works",
    );
  });

  it("says so when a claim isn't bound to any factory yet", () => {
    const claimed = sampleNode({
      claim: {
        minerId: "Build_MinerMk1_C",
        clockPct: 100,
        factoryId: null,
        notes: null,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    });
    expect(nodeTooltip(claimed, new Map())).toBe(
      "Iron Ore · Normal · 60 ipm · 0.1km E · 0.1km S · feeds no factory yet",
    );
  });

  it("names a well satellite or oil seep before the extractor dropdown gives it away", () => {
    const seep = sampleNode({
      resourceItemName: "Crude Oil",
      resourceItemId: "Desc_LiquidOil_C",
      kind: "miner_node",
    });
    expect(nodeTooltip(seep, new Map())).toBe(
      "Crude Oil · Normal · Oil seep · click to bind or drag onto a factory",
    );

    const well = sampleNode({
      resourceItemName: "Crude Oil",
      resourceItemId: "Desc_LiquidOil_C",
      kind: "fracking_well",
    });
    expect(nodeTooltip(well, new Map())).toBe(
      "Crude Oil · Normal · Well satellite · click to bind or drag onto a factory",
    );
  });
});

const factory: Factory = {
  id: "f-1",
  name: "Iron Works",
  worldX: 10000,
  worldY: 10000,
  createdAt: "2026-05-10T00:00:00Z",
  updatedAt: "2026-05-10T00:00:00Z",
  machineCount: 0,
};

const claimedNode: ResourceNodeRow = {
  id: "n-claimed",
  resourceItemId: "Desc_OreIron_C",
  resourceItemName: "Iron Ore",
  purity: "Normal",
  kind: "miner_node",
  x: 10000,
  y: 10000,
  z: 0,
  claim: {
    minerId: "Build_MinerMk1_C",
    clockPct: 100,
    factoryId: "f-1",
    notes: null,
    createdAt: "2026-05-10T00:00:00Z",
    updatedAt: "2026-05-10T00:00:00Z",
  },
  itemsPerMinute: 60,
  allowedExtractors: [
    { id: "Build_MinerMk1_C", name: "Miner Mk.1", baseIpm: 60, unlockTier: 0 },
  ],
  claimInvalidExtractor: false,
};

const ironNode: ResourceNodeRow = {
  id: "n-iron",
  resourceItemId: "Desc_OreIron_C",
  resourceItemName: "Iron Ore",
  purity: "Normal",
  kind: "miner_node",
  x: 10000,
  y: 10000,
  z: 0,
  claim: null,
  itemsPerMinute: 0,
  allowedExtractors: [{ id: "Build_MinerMk1_C", name: "Miner Mk.1", baseIpm: 60, unlockTier: 0 }],
  claimInvalidExtractor: false,
};

const copperNode: ResourceNodeRow = {
  ...ironNode,
  id: "n-copper",
  resourceItemId: "Desc_OreCopper_C",
  resourceItemName: "Copper Ore",
  x: 20000,
  y: 20000,
};

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("<MapView /> — reaching a claimed node from the map", () => {
  beforeEach(() => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([factory]);
    vi.spyOn(resourcesApi, "list").mockResolvedValue([claimedNode]);
    vi.spyOn(resourcesApi, "listWaterGroups").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "budget").mockResolvedValue({ assumptionLabel: "x", rows: [] });
    vi.spyOn(logisticsApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(plannerApi, "listUnsourcedInputs").mockResolvedValue([]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([]);
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanValidationReport);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("persists 'Show claimed nodes too' under a key scoped to the active playthrough (#64)", async () => {
    // The bug: this preference (and the rest of the map's filter/view
    // state) used to live under one global key, so it bled from
    // whichever playthrough was open last into a brand-new one.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const toggle = await screen.findByLabelText(/show claimed nodes too/i);
    await user.click(toggle);

    expect(localStorage.getItem("specs:map:showClaimedToo:p")).toBe("0");
    expect(localStorage.getItem("specs:map:showClaimedToo")).toBeNull();
  });

  it("shows a claimed node's marker without needing any toggle or factory selection first", async () => {
    renderWithProviders(<MapView />);
    // Wait for the toolbar to confirm the real view (not the "no
    // playthrough" empty state, which also renders an "h1" reading "Map").
    await screen.findByLabelText(/show claimed nodes too/i);
    expect(
      await screen.findByRole("button", { name: /feeds Iron Works/i }),
    ).toBeInTheDocument();
  });

  it("opens the same card populated with edit fields and a Release button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /feeds Iron Works/i });
    await user.click(marker);

    // Populated, not a blank create form: the claim's own factory shows
    // selected in the combobox — its display value is the factory's
    // name, not the raw id a native `<select>` would show.
    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("Iron Works");
    expect(screen.getByRole("button", { name: /release/i })).toBeInTheDocument();
  });

  it("unclaims via Release without leaving the map", async () => {
    const clearSpy = vi.spyOn(resourcesApi, "clearClaim").mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /feeds Iron Works/i });
    await user.click(marker);
    await user.click(await screen.findByRole("button", { name: /release/i }));
    expect(clearSpy).toHaveBeenCalledWith("n-claimed");
  });

  it("stacks a node marker above the factory pin sharing its coordinates", async () => {
    // The bug this regresses: with Iron Works placed directly on its
    // own claimed node (both at 10000,10000, the scenario a factory-
    // planning map is meant to support), the pin's rendered footprint
    // covered the node's entire 24×24 hit box — the node couldn't be
    // clicked at all. jsdom doesn't lay out real pixels to assert the
    // occlusion directly, so this pins the fix's actual mechanism: the
    // marker's wrapper carries an explicit positive z-index and the
    // pin's doesn't, so the marker always wins the stacking contest
    // wherever they overlap.
    //
    // The z-index has to live on the *wrapper* div, not the marker
    // button rendered inside it — the wrapper's own `transform` (the
    // counter-scale that holds the marker's on-screen size steady at
    // every zoom level) already starts a new stacking context, so a
    // z-index on the button only ever competes against siblings inside
    // that same context and never reaches the pin's separate wrapper to
    // outrank it. A live app confirmed this the hard way:
    // `document.elementFromPoint` at a covered node's center kept
    // resolving to the pin until the z-index moved here.
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /feeds Iron Works/i });
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    const markerWrapper = marker.closest(".specs-map-marker") as HTMLElement;
    const pinWrapper = pin.parentElement as HTMLElement;
    const markerZ = Number(markerWrapper.style.zIndex);
    const pinZ = Number(pinWrapper.style.zIndex) || 0;
    expect(markerZ).toBeGreaterThan(0);
    expect(markerZ).toBeGreaterThan(pinZ);
  });

  it("carries a 'Claim clock percent' aria-label — same wording as the identical Resources control — and shows the claim's output rate", async () => {
    // Regresses #105's map items: the node card's clock input used to
    // read "Node clock percent" (a different string from the Resources
    // list's ClaimEditor) and never showed a rate at all, even though
    // this card is the map's stand-in for the same claim/edit action.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /feeds Iron Works/i });
    await user.click(marker);

    expect(await screen.findByLabelText("Claim clock percent")).toBeInTheDocument();
    // claimedNode is 60 ipm — same convention as NodeRow's ipmLabel.
    expect(screen.getByText("60 ipm")).toBeInTheDocument();
  });

  it("flags a claim over its port capacity on the map too, reading the same finding NodeRow does", async () => {
    // Regression: an over-port claim made from the map used to be
    // invisible until the user left the map for Validate or the
    // Resources row. Reuses the exact validation sweep + finding shape
    // NodeRow's inline flag consumes (#101) — no capacity maths is
    // re-derived here, only the finding's own advice text is rendered.
    vi.spyOn(validationApi, "validate").mockResolvedValue({
      ...cleanValidationReport,
      findings: [
        {
          severity: "warning",
          category: "capacity",
          kind: "claimOverPortCapacity",
          nodeId: claimedNode.id,
          resourceItemName: "Iron Ore",
          nodeIndex: 0,
          nodePurity: "Pure",
          nodeX: claimedNode.x,
          nodeY: claimedNode.y,
          extractorName: "Miner Mk.1",
          outputIpm: 90,
          capacityIpm: 60,
          isFluid: false,
          capacityMark: 1,
          // Non-whole ratio — pins the floor-not-round advice text too.
          maxFittingClockPct: 66.6,
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /feeds Iron Works/i });
    await user.click(marker);

    const flag = await screen.findByText("over port cap");
    expect(flag).toHaveAttribute("title", expect.stringContaining("clock to 66% to fit"));
  });

  it("marks claimed nodes with a badge, not just a subtle opacity dip (#59)", async () => {
    // Before this fix, claimed vs unclaimed was opacity 1 vs 0.78 on a
    // 14px marker — the only difference, and too subtle to read at a
    // glance. The badge is a second, shape-based channel.
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /feeds Iron Works/i });
    expect(marker.querySelector(".bg-success")).toBeInTheDocument();
  });

  it("draws a faint line from a claimed node to its factory without needing to select the factory first (#59)", async () => {
    // Before this fix: the map's only factory↔node overlay only drew
    // once a factory was selected (InputLinesLayer), and the always-
    // visible "Show factory links" checkbox never meant this relation
    // at all — it's factory→factory logistics. This binding line is
    // the "primary spatial fact" the issue says was never drawn.
    const { container } = renderWithProviders(<MapView />);
    await screen.findByRole("button", { name: /feeds Iron Works/i });
    const bindingLines = container.querySelectorAll('line[stroke-dasharray="3 5"]');
    expect(bindingLines.length).toBeGreaterThan(0);
  });

  it("shows an unmissable banner when factory placement is armed too, not just water placement (#59)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByRole("button", { name: /^place a factory$/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/placing a factory/i);
  });

  it("enables 'Jump to my claims' once there's a claim to jump to, and it doesn't throw when clicked (#50)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    // Wait for the node data to actually land before checking the
    // button's enabled state — it renders (disabled) on the very
    // first paint, before the query resolves.
    await screen.findByRole("button", { name: /feeds Iron Works/i });
    const jump = screen.getByRole("button", { name: /jump to my claims/i });
    expect(jump).toBeEnabled();
    expect(jump).toHaveAttribute("title", expect.stringContaining("1 claimed node"));
    await user.click(jump);
  });

  it("shows no port-capacity flag when the sweep has nothing to report for this claim", async () => {
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanValidationReport);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /feeds Iron Works/i });
    await user.click(marker);
    expect(screen.queryByText("over port cap")).not.toBeInTheDocument();
  });
});

describe("<MapView /> — dragging a factory pin (#103)", () => {
  beforeEach(() => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([factory]);
    vi.spyOn(factoryApi, "detail").mockResolvedValue({
      factory,
      machines: [],
      ledger: { factoryId: "f-1", flows: [], powerMw: 0 },
    });
    vi.spyOn(resourcesApi, "list").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "listWaterGroups").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "budget").mockResolvedValue({ assumptionLabel: "x", rows: [] });
    vi.spyOn(logisticsApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(plannerApi, "listUnsourcedInputs").mockResolvedValue([]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([]);
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanValidationReport);
    vi.spyOn(libraryApi, "recipes").mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("a plain drag pans the map instead of silently moving the factory", async () => {
    const setPositionSpy = vi.spyOn(factoryApi, "setPosition");
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);

    // No modifier held — the pin's hit area is the whole label pill,
    // so a pan that merely starts over a factory must not relocate it.
    fireEvent.mouseDown(pin, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(window, { clientX: 300, clientY: 250 });

    expect(setPositionSpy).not.toHaveBeenCalled();
  });

  it("moves the factory only with the deliberate Alt/Option-held drag", async () => {
    const setPositionSpy = vi.spyOn(factoryApi, "setPosition").mockResolvedValue(factory);
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);

    fireEvent.mouseDown(pin, { clientX: 200, clientY: 200, altKey: true });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 250, altKey: true });
    fireEvent.mouseUp(window, { clientX: 300, clientY: 250, altKey: true });

    expect(setPositionSpy).toHaveBeenCalledTimes(1);
    const [call] = setPositionSpy.mock.calls[0];
    expect(call.id).toBe("f-1");
    // Pinned via the same worldToPct/pctToWorld round trip the app
    // uses: factory at (10000, 10000), default zoom 0.6, dragged
    // 100×50 screen px.
    expect(call.worldX).toBeCloseTo(71035.21029150393, 3);
    expect(call.worldY).toBeCloseTo(40517.57812499994, 3);
  });

  it("disables 'Jump to my claims' when there's nothing claimed yet (#50)", async () => {
    renderWithProviders(<MapView />);
    const jump = await screen.findByRole("button", { name: /jump to my claims/i });
    expect(jump).toBeDisabled();
    expect(jump).toHaveAttribute("title", "No claimed nodes yet");
  });

  it("shows the factory's coordinates on its card, the way node cards and 'New factory here' (#97) already do", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    await user.click(pin);

    expect(
      await screen.findByText(coordChip(factory.worldX, factory.worldY)),
    ).toBeInTheDocument();
  });

  it("gives the factory pin the same zoom-independent scale node markers already have (#99)", async () => {
    // Regresses #99: node markers got a counter-scale wrapper in #96
    // so their on-screen size holds constant across zoom, but factory
    // pins kept scaling with the map. jsdom doesn't lay out real
    // pixels, so this pins the fix's actual mechanism — the pin's
    // positioning wrapper carries its own `scale()`, which cancels to
    // exactly 1 at the default zoom.
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    expect(pin.parentElement?.style.transform).toBe("translate(-50%, -50%) scale(1)");
  });
});

const waterGroup: WaterExtractorGroup = {
  id: "wg-1",
  worldX: 5000,
  worldY: 5000,
  count: 4,
  clockPct: 100,
  count2: null,
  clock2Pct: null,
  factoryId: null,
  notes: null,
  locked: false,
  outputIpm: 480,
  createdAt: "2026-05-10T00:00:00Z",
  updatedAt: "2026-05-10T00:00:00Z",
};

describe("<MapView /> — a water-extractor pin holds its size at zoom too (#99)", () => {
  beforeEach(() => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "list").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "listWaterGroups").mockResolvedValue([waterGroup]);
    vi.spyOn(resourcesApi, "budget").mockResolvedValue({ assumptionLabel: "x", rows: [] });
    vi.spyOn(logisticsApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(plannerApi, "listUnsourcedInputs").mockResolvedValue([]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([]);
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanValidationReport);
  });

  afterEach(() => vi.restoreAllMocks());

  it("gives the water-extractor pin the same counter-scale wrapper as factory pins and node markers", async () => {
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/Water Extractor · 480/i);
    expect(pin.parentElement?.style.transform).toBe("translate(-50%, -50%) scale(1)");
  });
});

describe("<MapView /> — isolating one resource in the filter row (#59)", () => {
  beforeEach(() => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "list").mockResolvedValue([ironNode, copperNode]);
    vi.spyOn(resourcesApi, "listWaterGroups").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "budget").mockResolvedValue({ assumptionLabel: "x", rows: [] });
    vi.spyOn(logisticsApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(plannerApi, "listUnsourcedInputs").mockResolvedValue([]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([]);
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanValidationReport);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // The filter state is scoped to (and persisted under) the "p"
    // playthrough id every test in this block reuses — without
    // clearing it, one test's hidden-resource set leaks into the
    // next test's supposedly-fresh render.
    localStorage.clear();
  });

  it("Alt-clicking a resource chip solos it, hiding every other resource in one gesture", async () => {
    renderWithProviders(<MapView />);
    const ironChip = await screen.findByRole("button", { name: /^iron ore$/i });
    const copperChip = screen.getByRole("button", { name: /^copper ore$/i });
    expect(ironChip).toHaveAttribute("aria-pressed", "true");
    expect(copperChip).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(ironChip, { altKey: true });

    expect(ironChip).toHaveAttribute("aria-pressed", "true");
    expect(copperChip).toHaveAttribute("aria-pressed", "false");
  });

  it("a second Alt-click on an already-soloed chip undoes it instead of hiding the last resource", async () => {
    renderWithProviders(<MapView />);
    const ironChip = await screen.findByRole("button", { name: /^iron ore$/i });
    const copperChip = screen.getByRole("button", { name: /^copper ore$/i });

    fireEvent.click(ironChip, { altKey: true });
    fireEvent.click(ironChip, { altKey: true });

    expect(ironChip).toHaveAttribute("aria-pressed", "true");
    expect(copperChip).toHaveAttribute("aria-pressed", "true");
  });

  it("'Hide all' then a plain click on one chip is the two-click isolation path", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await screen.findByRole("button", { name: /^iron ore$/i });
    await user.click(screen.getByRole("button", { name: /^hide all$/i }));
    await user.click(screen.getByRole("button", { name: /^iron ore$/i }));

    expect(screen.getByRole("button", { name: /^iron ore$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^copper ore$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("'Show all' clears every hidden resource in one click", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await screen.findByRole("button", { name: /^iron ore$/i });
    await user.click(screen.getByRole("button", { name: /^hide all$/i }));
    await user.click(screen.getByRole("button", { name: /^show all$/i }));

    expect(screen.getByRole("button", { name: /^iron ore$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^copper ore$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

const wellSatelliteNode: ResourceNodeRow = {
  id: "n-well",
  resourceItemId: "Desc_LiquidOil_C",
  resourceItemName: "Crude Oil",
  purity: "Pure",
  kind: "fracking_well",
  x: 20000,
  y: 20000,
  z: 0,
  claim: null,
  itemsPerMinute: 0,
  allowedExtractors: [
    { id: "Build_FrackingSmasher_C", name: "Resource Well Extractor", baseIpm: 60, unlockTier: 8 },
  ],
  claimInvalidExtractor: false,
};

describe("<MapView /> — a well satellite reads distinctly from an oil seep", () => {
  beforeEach(() => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 6,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "list").mockResolvedValue([wellSatelliteNode]);
    vi.spyOn(resourcesApi, "listWaterGroups").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "budget").mockResolvedValue({ assumptionLabel: "x", rows: [] });
    vi.spyOn(logisticsApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(plannerApi, "listUnsourcedInputs").mockResolvedValue([]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([]);
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanValidationReport);
  });

  afterEach(() => vi.restoreAllMocks());

  it("names the kind on the marker and carries it into the opened card", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /well satellite/i });
    await user.click(marker);
    // The card header repeats the same label the marker's tooltip
    // already gave away — before this fix, both read as plain
    // "Crude Oil · Pure" and only the extractor dropdown told them
    // apart.
    expect(await screen.findAllByText("Well satellite")).not.toHaveLength(0);
  });

  it("keeps the well extractor selectable and tier-badged even though nothing in its single-option family is unlocked yet", async () => {
    // Tier 6 playthrough, Tier 8 extractor: `tier_eligible_extractors`
    // never returns empty, so the family's one option still shows —
    // the badge (not the option's absence) is what tells the player
    // it isn't buildable yet. This must stay selectable; blocking it
    // would leave the well satellite with nothing to claim at all.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /well satellite/i });
    await user.click(marker);

    const combobox = await screen.findByRole("combobox", { name: /extractor/i });
    expect(combobox).toHaveValue("Resource Well Extractor");
    await user.click(combobox);
    const option = await screen.findByRole("option", { name: /Resource Well Extractor/ });
    expect(option).toHaveTextContent("Tier 8");
    expect(option).toHaveTextContent("locked");
  });

  it("gives the marker its own zoom-independent scale instead of inheriting the map's", async () => {
    // Regresses #96: marker size and coordinate spread used to scale
    // together (both riding the map's own CSS zoom transform), so no
    // zoom level could ever separate a tight cluster like a well's
    // satellites. jsdom doesn't lay out real pixels to assert the
    // separation directly, so this pins the fix's actual mechanism —
    // the marker's wrapper element carries its own `scale()`,
    // independent of the ambient zoom, which is what lets the marker
    // hold a constant on-screen size while the gap between markers
    // keeps growing with zoom. At the default zoom the two ratios
    // this scale is built from cancel out to exactly 1.
    renderWithProviders(<MapView />);
    const marker = await screen.findByRole("button", { name: /well satellite/i });
    expect(marker.parentElement?.style.transform).toBe("translate(-50%, -50%) scale(1)");
  });
});

describe("<MapView /> — arming water placement doesn't silently drop on a node click", () => {
  beforeEach(() => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p",
      displayName: "Run",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 6,
      currentMilestoneProgress: 0,
    });
    vi.spyOn(factoryApi, "list").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "list").mockResolvedValue([wellSatelliteNode]);
    vi.spyOn(resourcesApi, "listWaterGroups").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "budget").mockResolvedValue({ assumptionLabel: "x", rows: [] });
    vi.spyOn(logisticsApi, "list").mockResolvedValue([]);
    vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
    vi.spyOn(plannerApi, "listUnsourcedInputs").mockResolvedValue([]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([]);
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanValidationReport);
  });

  afterEach(() => vi.restoreAllMocks());

  it("shows an unmissable armed banner, and clicking a node places water there instead of opening the node card", async () => {
    const setWaterGroupSpy = vi.spyOn(resourcesApi, "setWaterGroup").mockResolvedValue({
      id: "wg-1",
      worldX: 0,
      worldY: 0,
      count: 4,
      clockPct: 100,
      locked: false,
      outputIpm: 480,
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    });
    const user = userEvent.setup();
    renderWithProviders(<MapView />);

    await user.click(await screen.findByRole("button", { name: /place water extractors/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/placing water extractors/i);

    // Before this fix: clicking a node while armed opened the node
    // card and left the player unable to tell whether the tool was
    // still armed. Now the armed click wins regardless of what's
    // under the cursor, the same as clicking open map.
    const marker = await screen.findByRole("button", { name: /well satellite/i });
    await user.click(marker);

    expect(setWaterGroupSpy).toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /factory/i })).not.toBeInTheDocument();
  });
});

describe("<QuickCreateFactoryPopover /> — siting before committing", () => {
  it("shows where 'here' is, so placement can be checked before Create", () => {
    render(
      <QuickCreateFactoryPopover
        pending={false}
        coordLabel="0.1km E · 0.2km S"
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("0.1km E · 0.2km S")).toBeInTheDocument();
  });
});
