import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryKeys } from "@/shared/query/keys";
import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "@/features/factory/api";
import type { Factory } from "@/features/factory/types";
import { resourcesApi } from "@/features/resources/api";
import type {
  ExtractorOption,
  ResourceNodeRow,
  WaterExtractorGroup,
} from "@/features/resources/types";
import { logisticsApi } from "@/features/logistics/api";
import { powerApi } from "@/features/power/api";
import { plannerApi } from "@/features/planner/api";
import { libraryApi } from "@/features/library/api";
import { coordChip } from "@/features/resources/display";
import { validationApi } from "@/features/validation/api";
import type { ValidationReport } from "@/features/validation/types";
import {
  centerPan,
  frameScale,
  defaultClaimClockPct,
  defaultClaimFactoryId,
  formatFactoryPopoverSummary,
  MapView,
  nearestClaimableNode,
  nodeMarkerText,
  nodeClusters,
  popoverAnchor,
  prefersReducedMotion,
  QuickCreateFactoryPopover,
} from "./MapView";

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

const mk1: ExtractorOption = {
  id: "Build_MinerMk1_C",
  name: "Miner Mk.1",
  baseIpm: 60,
  unlockTier: 0,
};

/** The map's default placement loadout, as `nodeMarkerText` sees it. */
const tooltipLoadout = { minerId: mk1.id, minerClockPct: 100 };

function sampleNode(overrides: Partial<ResourceNodeRow> = {}): Parameters<typeof nodeMarkerText>[0] {
  return {
    resourceItemName: "Iron Ore",
    resourceItemId: "Desc_OreIron_C",
    kind: "miner_node",
    purity: "Normal",
    x: 10000,
    y: 10000,
    itemsPerMinute: 60,
    claim: null,
    allowedExtractors: [mk1],
    ...overrides,
  };
}

describe("nodeMarkerText", () => {
  it("gives an unclaimed node its coordinates and the rate the loadout would extract", () => {
    // The information that decides *which* node to claim can't wait
    // until after the claim: siting and yield are the choice.
    expect(nodeMarkerText(sampleNode(), new Map(), tooltipLoadout).title).toBe(
      "Iron Ore · Normal · 60 ipm with Miner Mk.1 at 100% · 0.1km E · 0.1km S · unclaimed · click to bind or drag onto a factory",
    );
  });

  it("states the rate against the loadout actually in force, not a fixed 100% Mk.1", () => {
    const { title } = nodeMarkerText(
      sampleNode({ purity: "Pure" }),
      new Map(),
      { minerId: mk1.id, minerClockPct: 37.5 },
    );
    // Pure doubles the Mk.1's 60 base; 37.5% of that is 45.
    expect(title).toContain("45 ipm with Miner Mk.1 at 37.5%");
  });

  it("skips the yield for a node with no extractor at all", () => {
    const geyser = sampleNode({
      resourceItemName: "Geyser",
      resourceItemId: "Desc_Geyser_C",
      kind: "geyser",
      allowedExtractors: [],
    });
    expect(nodeMarkerText(geyser, new Map(), tooltipLoadout).title).toBe(
      "Geyser · Normal · 0.1km E · 0.1km S · unclaimed · click to bind or drag onto a factory",
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
    expect(nodeMarkerText(claimed, names, tooltipLoadout).title).toBe(
      "Iron Ore · Normal · 60 ipm · 0.1km E · 0.1km S · feeds Iron Works · click to edit or drag onto a factory to rebind",
    );
  });

  it("keeps advertising drag-to-bind once a node is claimed — the handler rebinds it either way", () => {
    // The drag handler repairs a stale extractor and rebinds a claimed
    // node exactly like a fresh one. Dropping the hint at claim time
    // hid the only visible route out of a claim bound to the wrong
    // factory, or to none.
    const claimed = sampleNode({
      claim: {
        minerId: mk1.id,
        clockPct: 100,
        factoryId: null,
        notes: null,
        createdAt: "2026-05-10T00:00:00Z",
        updatedAt: "2026-05-10T00:00:00Z",
      },
    });
    expect(nodeMarkerText(claimed, new Map(), tooltipLoadout).title).toContain(
      "drag onto a factory to rebind",
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
    expect(nodeMarkerText(claimed, new Map(), tooltipLoadout).title).toBe(
      "Iron Ore · Normal · 60 ipm · 0.1km E · 0.1km S · feeds no factory yet · click to edit or drag onto a factory to rebind",
    );
  });

  it("names a well satellite or oil seep before the extractor dropdown gives it away", () => {
    const oilExtractor: ExtractorOption = {
      id: "Build_OilPump_C",
      name: "Oil Extractor",
      baseIpm: 120,
      unlockTier: 5,
    };
    const seep = sampleNode({
      resourceItemName: "Crude Oil",
      resourceItemId: "Desc_LiquidOil_C",
      kind: "miner_node",
      allowedExtractors: [oilExtractor],
    });
    expect(nodeMarkerText(seep, new Map(), tooltipLoadout).title).toBe(
      "Crude Oil · Normal · Oil seep · 120 ipm with Oil Extractor at 100% · 0.1km E · 0.1km S · unclaimed · click to bind or drag onto a factory",
    );

    const well = sampleNode({
      resourceItemName: "Crude Oil",
      resourceItemId: "Desc_LiquidOil_C",
      kind: "fracking_well",
      allowedExtractors: [
        { id: "Build_FrackingSmasher_C", name: "Resource Well Extractor", baseIpm: 60, unlockTier: 8 },
      ],
    });
    expect(nodeMarkerText(well, new Map(), tooltipLoadout).title).toBe(
      "Crude Oil · Normal · Well satellite · 60 ipm with Resource Well Extractor at 100% · 0.1km E · 0.1km S · unclaimed · click to bind or drag onto a factory",
    );
  });
});

describe("defaultClaimFactoryId", () => {
  const near = { id: "f-near", name: "Near", worldX: 11000, worldY: 11000 };
  const far = { id: "f-far", name: "Far", worldX: 400000, worldY: 300000 };
  const node = { x: 10000, y: 10000 };

  it("points a fresh claim at the factory whose card is already open", () => {
    // The whole reason the popup is open is usually the red shortfall
    // on that factory's card.
    expect(defaultClaimFactoryId(node, [near, far], "f-far")).toBe("f-far");
  });

  it("falls back to the nearest factory when none is selected", () => {
    expect(defaultClaimFactoryId(node, [far, near], null)).toBe("f-near");
  });

  it("ignores a selection that isn't in the list", () => {
    expect(defaultClaimFactoryId(node, [near, far], "f-deleted")).toBe("f-near");
  });

  it("leaves the claim unbound when there's no factory to bind to", () => {
    expect(defaultClaimFactoryId(node, [], "f-near")).toBeNull();
  });
});

/** Four Coal nodes and one Iron node from the bundled catalog, at
 * their real coordinates. At the default zoom their markers overlap in
 * a chain rather than a clique: 499 covers 500, 501 and 502, while 500
 * covers 499 and the Iron node but neither 501 nor 502. That asymmetry
 * is what a target-relative neighbourhood gets wrong. */
const coal499 = { id: "BP_ResourceNode499", x: 155867.515625, y: 248394.40625, resourceItemName: "Coal" };
const coal500 = { id: "BP_ResourceNode500", x: 157195.484375, y: 241871.546875, resourceItemName: "Coal" };
const coal501 = { id: "BP_ResourceNode501", x: 153876.15625, y: 252816.96875, resourceItemName: "Coal" };
const coal502 = { id: "BP_ResourceNode502", x: 150582.828125, y: 249923.765625, resourceItemName: "Coal" };
const ironNear = { id: "BP_ResourceNode95_579", x: 164518.28125, y: 238317.953125, resourceItemName: "Iron Ore" };
const coalPile = [coal499, coal500, coal501, coal502, ironNear];

describe("nodeClusters", () => {
  it("gives every marker in a pile the same list, so paging is closed over it", () => {
    // Before this, opening 499 read "1 of 4" over [499,500,501,502];
    // Next reached 500, then wandered to the Iron node — which was
    // never in that four — and looped. 501 and 502 were unreachable by
    // paging, and unclickable because a marker covers them, so at the
    // default zoom they had no route at all.
    const clusters = nodeClusters(coalPile, 0.6);
    const ids = (id: string) => (clusters.get(id) ?? []).map((n) => n.id);
    const fromFirst = ids("BP_ResourceNode499");

    expect(fromFirst).toHaveLength(5);
    for (const member of coalPile) {
      expect(ids(member.id)).toEqual(fromFirst);
    }
  });

  it("reaches every member of the pile by paging from any of them", () => {
    const clusters = nodeClusters(coalPile, 0.6);
    const stack = clusters.get("BP_ResourceNode501") ?? [];
    const walked: string[] = [];
    let at = stack.findIndex((n) => n.id === "BP_ResourceNode501");
    for (let step = 0; step < stack.length; step++) {
      walked.push(stack[at].id);
      at = (at + 1) % stack.length;
    }
    expect(new Set(walked)).toEqual(new Set(coalPile.map((n) => n.id)));
  });

  it("dissolves the pile once the player zooms in far enough", () => {
    // The gap grows with zoom while a marker's on-screen size holds,
    // so zooming is a real way out of a cluster — the pager covers the
    // zoom levels where it isn't yet.
    const clusters = nodeClusters(coalPile, 3);
    for (const member of coalPile) {
      expect((clusters.get(member.id) ?? []).map((n) => n.id)).toEqual([member.id]);
    }
  });

  it("separates a pair at the zoom the marker geometry actually predicts", () => {
    // Two nodes exactly 3000 world units apart are 8.19 map px apart,
    // and a marker's on-screen footprint is MARKER_PX × DEFAULT_SCALE
    // = 14.4 px, so they part company at 14.4 / 8.19 = 1.758. Probing
    // only far either side of that (0.6 and 6) passes just as happily
    // with a radius-vs-diameter factor of two in the formula, which
    // would put the real threshold at 0.88.
    const a = { id: "a", x: 0, y: 0, resourceItemName: "Copper Ore" };
    const b = { id: "b", x: 3000, y: 0, resourceItemName: "Limestone" };
    const idsAt = (zoom: number) => (nodeClusters([a, b], zoom).get("a") ?? []).map((n) => n.id);

    expect(idsAt(1.74)).toEqual(["a", "b"]);
    expect(idsAt(1.78)).toEqual(["a"]);
  });

  it("leaves a lone marker in a cluster of one", () => {
    const clusters = nodeClusters([coal499, { ...ironNear, x: -300000, y: -300000 }], 0.6);
    expect((clusters.get("BP_ResourceNode499") ?? []).map((n) => n.id)).toEqual([
      "BP_ResourceNode499",
    ]);
  });

  it("orders every cluster the same way regardless of which member is asked", () => {
    const clusters = nodeClusters(coalPile, 0.6);
    expect((clusters.get("BP_ResourceNode502") ?? []).map((n) => n.id)).toEqual([
      "BP_ResourceNode499",
      "BP_ResourceNode500",
      "BP_ResourceNode501",
      "BP_ResourceNode502",
      "BP_ResourceNode95_579",
    ]);
  });
});

describe("centerPan", () => {
  const rect = { width: 1000, height: 800 };

  it("centres a point that's nowhere near the map's edge", () => {
    const pan = centerPan(1024, 1024, 1, rect);
    expect(pan).toEqual({ x: 1000 / 2 - 1024, y: 800 / 2 - 1024 });
  });

  it("stops short of pulling bare canvas into view at the map's corner", () => {
    // Centring the top-left corner of the map would need a positive
    // offset, i.e. blank space to the left of the image — the exact
    // "a third of the viewport was black" landing the jump button had.
    const pan = centerPan(0, 0, 1, rect);
    expect(pan).toEqual({ x: 0, y: 0 });
  });

  it("centres the map itself when it's too small to cover the viewport", () => {
    const pan = centerPan(1024, 1024, 0.4, { width: 4000, height: 4000 });
    expect(pan).toEqual({ x: (4000 - 2048 * 0.4) / 2, y: (4000 - 2048 * 0.4) / 2 });
  });
});

describe("popoverAnchor", () => {
  const container = { width: 1000, height: 800 };
  const card = { width: 300, height: 300 };

  it("puts the card beside what was clicked", () => {
    expect(popoverAnchor({ x: 400, y: 300 }, container, card)).toEqual({
      left: 414,
      top: 314,
    });
  });

  it("flips to the other side rather than running off the edge", () => {
    // Exact, not "inside the container": the clamp guarantees the
    // range on its own, so an inequality passes for a flip formula
    // that drops the gap (680) or mirrors the wrong edge.
    expect(popoverAnchor({ x: 980, y: 780 }, container, card)).toEqual({
      left: 666, // 980 - 14 gap - 300 wide
      top: 466, // 780 - 14 gap - 300 tall
    });
  });
});

describe("nearestClaimableNode", () => {
  const close = { id: "close", x: 11000, y: 11000 };
  const far = { id: "far", x: 300000, y: 300000 };

  it("picks the node closest to the factory that needs it", () => {
    expect(nearestClaimableNode([far, close], { worldX: 10000, worldY: 10000 })?.id).toBe("close");
  });

  it("doesn't measure from an unplaced factory's phantom origin", () => {
    expect(nearestClaimableNode([far, close], { worldX: 0, worldY: 0 })?.id).toBe("far");
  });

  it("has nothing to offer when every node of that resource is taken", () => {
    expect(nearestClaimableNode([], { worldX: 10000, worldY: 10000 })).toBeNull();
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

/** Ids of the markers currently wearing the post-jump ring. The ring
 * is the warning-coloured outline itself, so deleting the styling
 * turns this red — unlike a marker class that only the test reads. */
/** Every marker currently rendered, in DOM order. */
function renderedMarkerIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-node-id]")).map(
    (el) => el.getAttribute("data-node-id") ?? "",
  );
}

function flashedMarkerIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-node-id]"))
    .filter((el) => el.classList.contains("outline-warning"))
    .map((el) => el.getAttribute("data-node-id") ?? "");
}

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

describe("<MapView /> — refitting the map after switching playthroughs", () => {
  beforeEach(() => {
    vi.spyOn(factoryApi, "list").mockResolvedValue([]);
    vi.spyOn(resourcesApi, "list").mockResolvedValue([ironNode]);
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

  it("covers a wide container for the playthrough switched to, instead of reopening it at the fixed default scale", async () => {
    // p1 opens with a saved view (scale 2) so its own load doesn't run
    // through the "no saved transform" branch at all — the switch *to*
    // p2, which has no saved view of its own, is what's under test.
    // Before this fix, that switch always fell back to the fixed
    // DEFAULT_SCALE regardless of window size, because the fitting
    // effect was keyed only to mount-time state and its ResizeObserver
    // had already disconnected by the time a later switch happened.
    localStorage.setItem("specs:map:transform:p1", JSON.stringify({ scale: 2, x: 10, y: 20 }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 2048,
      height: 819.2, // wide window: height/MAP_H (0.4) < width/MAP_W (1) → cover = 1
      top: 0,
      left: 0,
      right: 2048,
      bottom: 819.2,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p1",
      displayName: "Run 1",
      gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z",
      currentTier: 0,
      currentMilestoneProgress: 0,
    });
    render(
      <QueryClientProvider client={client}>
        <MapView />
      </QueryClientProvider>,
    );

    // The exact marker title, not a substring — the resource filter row
    // also has a chip titled "Hide Iron Ore · Alt/Option-click to show
    // only Iron Ore" that a loose match would collide with.
    const markerTitle =
      "Iron Ore · Normal · 60 ipm with Miner Mk.1 at 100% · 0.1km E · 0.1km S · unclaimed · click to bind or drag onto a factory";
    const markerBefore = await screen.findByTitle(markerTitle);
    expect(markerBefore.closest(".specs-map-marker")).toHaveProperty(
      "style.transform",
      "translate(-50%, -50%) scale(0.3)", // DEFAULT_SCALE (0.6) / p1's saved scale (2)
    );

    act(() => {
      client.setQueryData(queryKeys.playthrough.current, {
        id: "p2",
        displayName: "Run 2",
        gameVersion: "1.1",
        createdAt: "2026-05-10T00:00:00Z",
        currentTier: 0,
        currentMilestoneProgress: 0,
      });
    });

    await waitFor(() => {
      const markerAfter = screen.getByTitle(markerTitle);
      // DEFAULT_SCALE (0.6) / coverFitScale (1) for p2's wide window —
      // proof the switch rearmed the cover fit. The pre-fix behaviour
      // would have read back "scale(1)" (DEFAULT_SCALE / DEFAULT_SCALE)
      // regardless of window size.
      expect(markerAfter.closest(".specs-map-marker")).toHaveProperty(
        "style.transform",
        "translate(-50%, -50%) scale(0.6)",
      );
    });
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
    const { container } = renderWithProviders(<MapView />);
    const ironChip = await screen.findByRole("button", { name: /^iron ore$/i });
    const copperChip = screen.getByRole("button", { name: /^copper ore$/i });
    expect(ironChip).toHaveAttribute("aria-pressed", "true");
    expect(copperChip).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(ironChip, { altKey: true });

    expect(ironChip).toHaveAttribute("aria-pressed", "true");
    expect(copperChip).toHaveAttribute("aria-pressed", "false");
    // The whole rendered set, not just "iron is present": `visibleNodes`
    // filters on four dimensions, and every other marker assertion in
    // this file is membership — which a regression that shows *more*
    // nodes than it should sails straight through.
    expect(renderedMarkerIds(container)).toEqual(["n-iron"]);
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

const ironItem = {
  id: "Desc_OreIron_C",
  name: "Iron Ore",
  category: "raw" as const,
  stackSize: 100,
  isFluid: false,
};

/** Unclaimed, and close enough to Iron Works to be the nearest choice. */
const nearIronNode: ResourceNodeRow = {
  ...ironNode,
  id: "n-near",
  x: 11000,
  y: 11000,
};

/** Unclaimed, and the other side of the world from Iron Works. */
const farIronNode: ResourceNodeRow = {
  ...ironNode,
  id: "n-far",
  purity: "Pure",
  x: 300000,
  y: 300000,
};

const shortfallLedger = {
  factoryId: "f-1",
  powerMw: 4,
  flows: [
    {
      itemId: "Desc_OreIron_C",
      itemName: "Iron Ore",
      isFluid: false,
      producedPerMinute: 0,
      consumedPerMinute: 30,
      netPerMinute: -30,
      fromNodesPerMinute: 0,
    },
  ],
};

function mockClaimFlowApis(nodes: ResourceNodeRow[]) {
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
    ledger: shortfallLedger,
  });
  vi.spyOn(factoryApi, "ledger").mockResolvedValue(shortfallLedger);
  vi.spyOn(resourcesApi, "list").mockResolvedValue(nodes);
  vi.spyOn(resourcesApi, "listWaterGroups").mockResolvedValue([]);
  vi.spyOn(resourcesApi, "budget").mockResolvedValue({ assumptionLabel: "x", rows: [] });
  vi.spyOn(logisticsApi, "list").mockResolvedValue([]);
  vi.spyOn(powerApi, "listAll").mockResolvedValue([]);
  vi.spyOn(plannerApi, "listUnsourcedInputs").mockResolvedValue([]);
  vi.spyOn(libraryApi, "items").mockResolvedValue([ironItem]);
  vi.spyOn(libraryApi, "recipes").mockResolvedValue([]);
  vi.spyOn(libraryApi, "extractedResources").mockResolvedValue(["Desc_OreIron_C"]);
  vi.spyOn(validationApi, "validate").mockResolvedValue(cleanValidationReport);
}

describe("<MapView /> — the claim popup's factory default", () => {
  beforeEach(() => mockClaimFlowApis([nearIronNode, farIronNode]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("points at the factory whose card is open, the one whose shortfall put the player here", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    await user.click(pin);
    // The far node — so this can't pass by accidentally picking the
    // nearest factory-node pair.
    await user.click(await screen.findByTitle(/Iron Ore · Pure/));

    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("Iron Works");
  });

  it("falls back to the nearest factory when no card is open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));

    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("Iron Works");
  });

  it("keeps an unbound claim reachable for a player who wants one", async () => {
    const setClaimSpy = vi.spyOn(resourcesApi, "setClaim").mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));
    await screen.findByRole("combobox", { name: /factory/i });

    await user.click(screen.getByRole("button", { name: /clear selection/i }));
    await user.click(screen.getByRole("button", { name: /^claim$/i }));

    expect(setClaimSpy).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "n-near", factoryId: null }),
    );
  });

  it("says the world has no factories yet instead of offering a lone '— none —'", async () => {
    vi.spyOn(factoryApi, "list").mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));

    expect(await screen.findByText(/no factories yet/i)).toBeInTheDocument();
  });

  it("shows what the clock in the box would actually extract", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    // Pure node, Mk.1 at the loadout's 100%: 60 base × 2.
    await user.click(await screen.findByTitle(/Iron Ore · Pure/));

    expect(await screen.findByText("120 ipm at this clock")).toBeInTheDocument();
  });

  it("opens the card beside the marker that was clicked, not in the map's corner", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 800,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    renderWithProviders(<MapView />);
    const marker = await screen.findByTitle(/Iron Ore · Normal/);

    fireEvent.mouseDown(marker, { clientX: 420, clientY: 260 });
    fireEvent.mouseUp(window, { clientX: 420, clientY: 260 });

    const card = (await screen.findByRole("combobox", { name: /factory/i })).closest('[role="dialog"]') as HTMLElement;
    expect(card.style.left).toBe("434px");
    expect(card.style.top).toBe("274px");
  });
});

/** Two different resources one marker-width apart — the cluster case
 * where clicking can only ever reach whichever marker is on top. */
const stackedCopper: ResourceNodeRow = {
  ...ironNode,
  id: "n-stack-copper",
  resourceItemId: "Desc_OreCopper_C",
  resourceItemName: "Copper Ore",
  x: 0,
  y: 0,
};
const stackedLimestone: ResourceNodeRow = {
  ...ironNode,
  id: "n-stack-limestone",
  resourceItemId: "Desc_Stone_C",
  resourceItemName: "Limestone",
  x: 3000,
  y: 0,
};

describe("<MapView /> — separating markers that sit on top of each other", () => {
  beforeEach(() => mockClaimFlowApis([stackedCopper, stackedLimestone]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("pages between the stacked nodes from the card, and a repeat click walks the stack", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const copperMarker = await screen.findByTitle(/Copper Ore · Normal/);
    await user.click(copperMarker);

    expect(await screen.findByText("1 of 2 nodes stacked here")).toBeInTheDocument();
    // Sorted by resource name, so Limestone is the one underneath.
    await user.click(screen.getByRole("button", { name: /next node at this spot/i }));
    expect(await screen.findByText("2 of 2 nodes stacked here")).toBeInTheDocument();
    expect(screen.getByText(/^Limestone · Normal$/)).toBeInTheDocument();

    // Clicking the covering marker again advances rather than closing —
    // the covered marker can't be clicked directly at this zoom.
    await user.click(copperMarker);
    expect(await screen.findByText("1 of 2 nodes stacked here")).toBeInTheDocument();
  });

  it("still closes on a second click when nothing is stacked under the marker", async () => {
    vi.spyOn(resourcesApi, "list").mockResolvedValue([stackedCopper]);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByTitle(/Copper Ore · Normal/);

    await user.click(marker);
    expect(await screen.findByRole("combobox", { name: /factory/i })).toBeInTheDocument();
    await user.click(marker);
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: /factory/i })).not.toBeInTheDocument(),
    );
  });
});

describe("<MapView /> — acting on a factory's shortfall from its own card", () => {
  beforeEach(() => mockClaimFlowApis([nearIronNode, farIronNode]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("opens the nearest claimable node with this factory already selected", async () => {
    vi.spyOn(resourcesApi, "list").mockResolvedValue([
      nearIronNode,
      farIronNode,
      // Already feeding Iron Works, so it must not be counted as
      // claimable — the case that tells the predicate's two directions
      // apart.
      { ...farIronNode, id: "n-taken", x: 12000, y: 12000, claim: claimedNode.claim },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    await user.click(pin);

    // The exact count, not a prefix match that stops before it:
    // inverting the claimable predicate leaves every partial match
    // passing. The fixture holds two unbound iron nodes and one bound
    // to Iron Works, so a flipped predicate reads "1" here.
    const claim = await screen.findByRole("button", {
      name: "Claim a node for Iron Ore — nearest of 2 unbound",
    });
    expect(claim).toBeEnabled();
    await user.click(claim);

    // n-near is Normal purity; n-far is Pure — the card's header is
    // what says which one the map landed on.
    expect(await screen.findByText(/^Iron Ore · Normal$/)).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("Iron Works");
  });

  it("rings the node it jumped to, so the landing isn't a marker like every other marker", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    await user.click(pin);
    await user.click(await screen.findByRole("button", { name: /claim a node for iron ore/i }));

    // By id: the fixtures hold two nodes and a count of one passes
    // just as well when the *wrong* one is ringed.
    await waitFor(() => expect(flashedMarkerIds(container)).toEqual(["n-near"]));
  });

  it("says so in text, not a disabled button's tooltip, when every node of that resource is taken", async () => {
    vi.spyOn(resourcesApi, "list").mockResolvedValue([
      { ...nearIronNode, claim: { ...claimedNode.claim!, factoryId: "f-1" } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    await user.click(pin);

    // A disabled button is out of the tab order and fires no hover on
    // most assistive tech, so its `title` was the one place the answer
    // lived and the one place a non-visual reader couldn't get to.
    expect(await screen.findByText("Every Iron Ore node already feeds a factory")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim a node for iron ore/i })).not.toBeInTheDocument();
  });

  it("counts a claimed-but-unbound node as claimable — the case the card can't currently reach", async () => {
    vi.spyOn(resourcesApi, "list").mockResolvedValue([
      { ...nearIronNode, claim: { ...claimedNode.claim!, factoryId: null } },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    await user.click(pin);

    expect(await screen.findByRole("button", { name: /claim a node for iron ore/i })).toBeEnabled();
  });

  it("rings the claims 'Jump to my claims' lands on", async () => {
    vi.spyOn(resourcesApi, "list").mockResolvedValue([claimedNode, farIronNode]);
    const user = userEvent.setup();
    const { container } = renderWithProviders(<MapView />);
    await screen.findByRole("button", { name: /feeds Iron Works/i });

    await user.click(screen.getByRole("button", { name: /jump to my claims/i }));

    await waitFor(() => expect(flashedMarkerIds(container)).toEqual(["n-claimed"]));
  });
});

describe("<MapView /> — rebinding a node that already carries a deliberate claim", () => {
  /** Pure limestone underclocked to land on an exact rate, bound to
   * nothing yet — the shape of claim the shortfall jump lands on. */
  const underclockedUnbound: ResourceNodeRow = {
    ...ironNode,
    id: "n-underclocked",
    purity: "Pure",
    x: 11000,
    y: 11000,
    itemsPerMinute: 45,
    allowedExtractors: [
      mk1,
      { id: "Build_MinerMk2_C", name: "Miner Mk.2", baseIpm: 120, unlockTier: 3 },
    ],
    claim: {
      minerId: "Build_MinerMk2_C",
      clockPct: 37.5,
      factoryId: null,
      notes: "saving the rest of this node for the rail hub",
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    },
  };

  beforeEach(() => mockClaimFlowApis([underclockedUnbound]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("keeps the saved clock, extractor and note, and only fills in the factory that was asked for", async () => {
    // Re-deriving the claim from the placement loadout here would
    // silently reset a 37.5% underclock to the loadout's 100% and drop
    // a Mk.2 back to the loadout's mark — a worse bug than the missing
    // binding this button exists to fix.
    const setClaimSpy = vi.spyOn(resourcesApi, "setClaim").mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    await user.click(pin);
    await user.click(await screen.findByRole("button", { name: /claim a node for iron ore/i }));

    expect(await screen.findByRole("combobox", { name: /extractor/i })).toHaveValue("Miner Mk.2");
    expect(screen.getByLabelText("Claim clock percent")).toHaveValue(37.5);
    // The explicit request was "bind this to Iron Works" — arriving at
    // "— none —" would drop the instruction the player just gave.
    expect(screen.getByRole("combobox", { name: /factory/i })).toHaveValue("Iron Works");

    await user.click(screen.getByRole("button", { name: /^update$/i }));
    expect(setClaimSpy).toHaveBeenCalledWith({
      nodeId: "n-underclocked",
      minerId: "Build_MinerMk2_C",
      clockPct: 37.5,
      factoryId: "f-1",
      notes: "saving the rest of this node for the rail hub",
    });
  });

  it("leaves an unbound claim unbound when the card is merely opened by hand", async () => {
    // The intent to bind comes from the factory card's button, not
    // from looking at a node — opening a claim's card must never
    // rewrite what it feeds.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Ore · Pure/));

    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("");
  });

  it("doesn't carry the binding intent onto the next node picked by hand", async () => {
    // A second unbound claim, far enough away that the jump lands on
    // the first one. Its own card must still open at "— none —": a
    // leaked intent is the difference between the two outcomes here,
    // which an unclaimed node couldn't show (it defaults to a factory
    // either way).
    const otherUnbound: ResourceNodeRow = {
      ...underclockedUnbound,
      id: "n-other-unbound",
      purity: "Normal",
      x: 300000,
      y: 300000,
    };
    vi.spyOn(resourcesApi, "list").mockResolvedValue([underclockedUnbound, otherUnbound]);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/click for details, double-click to open the plan/i);
    await user.click(pin);
    await user.click(await screen.findByRole("button", { name: /claim a node for iron ore/i }));
    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("Iron Works");

    await user.click(screen.getByTitle(/Iron Ore · Normal/));
    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("");
  });
});

describe("defaultClaimFactoryId — only pre-bind a pick it can actually justify", () => {
  const placedNear = { id: "f-near", name: "Zed Works", worldX: 11000, worldY: 11000 };
  const placedFar = { id: "f-far", name: "Alpha Works", worldX: 400000, worldY: 300000 };
  const unplacedA = { id: "f-a", name: "Alpha Unplaced", worldX: 0, worldY: 0 };
  const unplacedB = { id: "f-b", name: "Beta Unplaced", worldX: 0, worldY: 0 };
  const node = { x: 10000, y: 10000 };

  it("leaves the picker empty when no factory has a position to rank by", () => {
    // `factoryPickerOptions` falls back to sorting these alphabetically,
    // so pre-binding here would present "Alpha" — a coin toss — in the
    // same shape as a real nearest-neighbour answer.
    expect(defaultClaimFactoryId(node, [unplacedA, unplacedB], null)).toBeNull();
  });

  it("still pre-binds the only factory there is, placed or not", () => {
    expect(defaultClaimFactoryId(node, [unplacedA], null)).toBe("f-a");
  });

  it("ranks only the factories that have a real distance", () => {
    // The nearest placed factory sorts last alphabetically, so an
    // alphabetical fallback would pick the far one instead.
    expect(defaultClaimFactoryId(node, [unplacedA, placedFar, placedNear], null)).toBe("f-near");
  });
});

describe("defaultClaimFactoryId — wanting the resource beats being near it", () => {
  // The reported case, to scale: claiming a Pure iron node with Copper
  // Works at 494 m and Iron Works at 597 m. Copper Works is genuinely
  // nearer and has no iron line at all.
  const node = { x: 0, y: 0 };
  const copperWorks = { id: "copper-works", name: "Copper Works", worldX: 49400, worldY: 0 };
  const ironWorks = { id: "iron-works", name: "Iron Works", worldX: 59700, worldY: 0 };
  const both = [copperWorks, ironWorks];

  it("picks the factory short of this resource over the nearer one that isn't", () => {
    expect(
      defaultClaimFactoryId(node, both, null, new Set(["iron-works"])),
    ).toBe("iron-works");
  });

  it("falls back to nearest when every candidate wants it", () => {
    // Positive control: the distance ranking is still doing its job —
    // shortfall narrows the field, it doesn't replace the ordering.
    expect(
      defaultClaimFactoryId(node, both, null, new Set(["iron-works", "copper-works"])),
    ).toBe("copper-works");
  });

  it("falls back to nearest when nobody is short of it", () => {
    // Covers the ledgers not having loaded as well as a genuinely
    // covered playthrough — an empty set is "no reason to prefer
    // anyone", which is where distance earns its place.
    expect(defaultClaimFactoryId(node, both, null, new Set())).toBe("copper-works");
  });

  it("pre-binds the only factory that wants it even without a position", () => {
    const unplacedIron = { ...ironWorks, worldX: 0, worldY: 0 };
    expect(
      defaultClaimFactoryId(node, [copperWorks, unplacedIron], null, new Set(["iron-works"])),
    ).toBe("iron-works");
  });

  it("still yields to the factory whose card is open", () => {
    // The player opened Copper Works and clicked a node from there.
    // That's an instruction, not a guess to be second-guessed by a
    // shortfall somewhere else on the map.
    expect(
      defaultClaimFactoryId(node, both, "copper-works", new Set(["iron-works"])),
    ).toBe("copper-works");
  });
});

describe("defaultClaimClockPct", () => {
  const loadout = { minerClockPct: 37.5 };

  it("applies the placement loadout's clock to a miner node", () => {
    expect(defaultClaimClockPct({ kind: "miner_node" }, loadout)).toBe(37.5);
  });

  it("starts a well or geyser neutral — the loadout is a miner mark's clock", () => {
    expect(defaultClaimClockPct({ kind: "fracking_well" }, loadout)).toBe(100);
    expect(defaultClaimClockPct({ kind: "geyser" }, loadout)).toBe(100);
  });
});

const secondFactory: Factory = {
  ...factory,
  id: "f-2",
  name: "Copper Works",
  worldX: 12000,
  worldY: 12000,
};

describe("<MapView /> — the claim popup defaults to a factory that wants the resource", () => {
  // The reported shape: a copper plant sitting closer to an iron node
  // than the iron plant that's short of iron. `nearIronNode` is at
  // (11000, 11000), so Copper Works wins on distance alone and loses on
  // the only thing that matters.
  const copperWorks: Factory = { ...secondFactory, worldX: 11500, worldY: 11500 };
  const ironWorks: Factory = { ...factory, worldX: 40000, worldY: 40000 };
  const coveredLedger = {
    factoryId: "f-2",
    powerMw: 4,
    flows: [
      {
        itemId: "Desc_OreCopper_C",
        itemName: "Copper Ore",
        isFluid: false,
        producedPerMinute: 0,
        consumedPerMinute: 30,
        netPerMinute: -30,
        fromNodesPerMinute: 0,
      },
    ],
  };

  beforeEach(() => {
    mockClaimFlowApis([nearIronNode]);
    vi.spyOn(factoryApi, "list").mockResolvedValue([ironWorks, copperWorks]);
    vi.spyOn(factoryApi, "ledger").mockImplementation((id: string) =>
      Promise.resolve(id === "f-1" ? shortfallLedger : coveredLedger),
    );
    vi.spyOn(libraryApi, "extractedResources").mockResolvedValue([
      "Desc_OreIron_C",
      "Desc_OreCopper_C",
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("picks the iron plant over the nearer copper plant with no iron line", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));

    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("Iron Works");
  });

  it("goes back to nearest once the iron plant's shortfall is covered", async () => {
    // Positive control on the whole wiring, not just the ranking: with
    // nobody short of iron, the distance ranking has to be what answers,
    // and it has to answer differently.
    vi.spyOn(factoryApi, "ledger").mockResolvedValue(coveredLedger);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));

    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("Copper Works");
  });
});

/** Claimed, bound to nothing — the state whose saved binding a stale
 * instruction would overwrite, since an unclaimed node has no saved
 * binding to contradict. */
const unboundIronClaim: ResourceNodeRow = {
  ...nearIronNode,
  claim: {
    minerId: "Build_MinerMk1_C",
    clockPct: 100,
    factoryId: null,
    notes: null,
    createdAt: "2026-05-10T00:00:00Z",
    updatedAt: "2026-05-10T00:00:00Z",
  },
};

describe("<MapView /> — a binding instruction doesn't outlive the card it was given to", () => {
  beforeEach(() => {
    mockClaimFlowApis([unboundIronClaim]);
    vi.spyOn(factoryApi, "list").mockResolvedValue([factory, secondFactory]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("forgets the factory it was sent to bind once the claim is committed", async () => {
    // The sequence that broke: jump from Iron Works' shortfall, change
    // the picker to Copper Works, claim — then reopen the same node.
    // A surviving instruction outranks the saved binding on that
    // second open, and the next Update rewrites the claim back to Iron
    // Works without the player touching the picker.
    const setClaimSpy = vi.spyOn(resourcesApi, "setClaim").mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/Iron Works — click for details/i);
    await user.click(pin);
    await user.click(await screen.findByRole("button", { name: /claim a node for iron ore/i }));

    const picker = await screen.findByRole("combobox", { name: /factory/i });
    expect(picker).toHaveValue("Iron Works");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Copper Works/ }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    expect(setClaimSpy).toHaveBeenCalledWith(
      expect.objectContaining({ factoryId: "f-2" }),
    );

    // Reopened by hand, the card must describe what's saved on the
    // node — which in this fixture is still an unbound claim.
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));
    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("");
  });
});

const wellNode: ResourceNodeRow = {
  id: "n-well",
  resourceItemId: "Desc_LiquidOil_C",
  resourceItemName: "Crude Oil",
  purity: "Normal",
  kind: "fracking_well",
  x: 11000,
  y: 11000,
  z: 0,
  claim: null,
  itemsPerMinute: 0,
  allowedExtractors: [
    { id: "Build_FrackingSmasher_C", name: "Resource Well Extractor", baseIpm: 60, unlockTier: 8 },
  ],
  claimInvalidExtractor: false,
};

describe("<MapView /> — the tooltip's rate is the rate the advertised gesture delivers", () => {
  beforeEach(() => {
    mockClaimFlowApis([wellNode]);
    // A loadout clock well away from neutral, so a path that wrongly
    // applies it to a non-miner node is unmistakable in the numbers.
    localStorage.setItem(
      "specs:map:loadout:p",
      JSON.stringify({
        minerId: "Build_MinerMk1_C",
        minerClockPct: 37.5,
        waterCount: 4,
        waterClockPct: 100,
      }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("drag-to-bind claims a well at the clock its marker advertised", async () => {
    // The tooltip names drag-to-bind, so the rate it prints is a
    // promise about what dragging does. The loadout's clock belongs to
    // a miner mark; a well has no mark, so both stay at 100%.
    const setClaimSpy = vi.spyOn(resourcesApi, "setClaim").mockResolvedValue(undefined);
    renderWithProviders(<MapView />);
    const marker = await screen.findByTitle(/Well satellite/);
    expect(marker).toHaveAttribute(
      "title",
      expect.stringContaining("60 ipm with Resource Well Extractor at 100%"),
    );
    const pin = await screen.findByTitle(/Iron Works — click for details/i);

    fireEvent.mouseDown(marker, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseEnter(pin);
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });

    await waitFor(() =>
      expect(setClaimSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeId: "n-well",
          minerId: "Build_FrackingSmasher_C",
          clockPct: 100,
          factoryId: "f-1",
        }),
      ),
    );
  });
});

describe("<MapView /> — the anchored card is clamped against boxes it measured", () => {
  beforeEach(() => mockClaimFlowApis([nearIronNode]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("flips the card off a corner using its own rendered height, not an assumed one", async () => {
    // A hardcoded 300×300 guess put the Claim/Update row past the
    // bottom edge whenever a conditional row (stack pager, port-cap
    // pill, no-factories warning) made the card taller. These offsets
    // only come out right if the real box is what got measured.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 800,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(330);

    renderWithProviders(<MapView />);
    const marker = await screen.findByTitle(/Iron Ore · Normal/);
    fireEvent.mouseDown(marker, { clientX: 900, clientY: 700 });
    fireEvent.mouseUp(window, { clientX: 900, clientY: 700 });

    const card = (await screen.findByRole("combobox", { name: /factory/i })).closest(
      '[role="dialog"]',
    ) as HTMLElement;
    expect(card.style.left).toBe("566px"); // 900 - 14 gap - 320 wide
    expect(card.style.top).toBe("356px"); // 700 - 14 gap - 330 tall
  });
});

describe("<MapView /> — the map is operable without a mouse", () => {
  beforeEach(() => mockClaimFlowApis([stackedCopper, stackedLimestone]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("opens a marker's card on Enter and on Space", async () => {
    // Every marker behaviour used to live in mousedown/mouseup, with
    // onClick doing nothing but stopPropagation — so a focusable
    // marker had no keyboard route to the card at all.
    renderWithProviders(<MapView />);
    const marker = await screen.findByTitle(/Copper Ore · Normal/);

    fireEvent.keyDown(marker, { key: "Enter" });
    expect(await screen.findByRole("combobox", { name: /factory/i })).toBeInTheDocument();

    fireEvent.keyDown(marker, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: /factory/i })).not.toBeInTheDocument(),
    );

    fireEvent.keyDown(marker, { key: " " });
    expect(await screen.findByRole("combobox", { name: /factory/i })).toBeInTheDocument();
  });

  it("pages the stack without dropping focus, so Next can be pressed more than once", async () => {
    // The pager used to live inside a card keyed by node id, so the
    // button being pressed unmounted under the user and focus fell to
    // the document body.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Copper Ore · Normal/));

    const next = await screen.findByRole("button", { name: /next node at this spot/i });
    next.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("2 of 2 nodes stacked here")).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /next node at this spot/i }),
    );

    await user.keyboard("{Enter}");
    expect(await screen.findByText("1 of 2 nodes stacked here")).toBeInTheDocument();
  });

  it("announces the stack position instead of silently swapping the card's contents", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Copper Ore · Normal/));

    expect(await screen.findByText("1 of 2 nodes stacked here")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("moves focus into the card on open and back to the marker on close", async () => {
    // The card renders after every marker in the DOM, so without this
    // a keyboard user tabs through hundreds of markers to reach it —
    // and lands on the document body when it closes.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const marker = await screen.findByTitle(/Copper Ore · Normal/);
    await user.click(marker);

    const card = await screen.findByRole("dialog", { name: /copper ore node/i });
    await waitFor(() => expect(document.activeElement).toBe(card));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(marker));
  });

  it("keeps the gesture hint out of the accessible name", async () => {
    // An accessible name is re-announced on every focus pass, and
    // "click"/"drag" name gestures a keyboard user doesn't have.
    renderWithProviders(<MapView />);
    const marker = await screen.findByTitle(/Copper Ore · Normal/);

    expect(marker.getAttribute("aria-label")).not.toMatch(/click|drag/i);
    expect(marker.getAttribute("aria-label")).toContain("unclaimed");
    expect(marker.getAttribute("title")).toMatch(/click to bind or drag onto a factory/);
  });
});

const waterItem = { ...ironItem, id: "Desc_Water_C", name: "Water" };

describe("<MapView /> — a shortfall in something the map has no nodes for", () => {
  beforeEach(() => {
    mockClaimFlowApis([nearIronNode]);
    vi.spyOn(libraryApi, "items").mockResolvedValue([ironItem, waterItem]);
    vi.spyOn(libraryApi, "extractedResources").mockResolvedValue(["Desc_Water_C"]);
    vi.spyOn(factoryApi, "detail").mockResolvedValue({
      factory,
      machines: [],
      ledger: {
        factoryId: "f-1",
        powerMw: 4,
        flows: [
          {
            itemId: "Desc_Water_C",
            itemName: "Water",
            isFluid: true,
            producedPerMinute: 0,
            consumedPerMinute: 120,
            netPerMinute: -120,
            fromNodesPerMinute: 0,
          },
        ],
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("routes a water shortfall to the placement tool instead of claiming that every water node is taken", async () => {
    // Water isn't a ResourceNodeRow at all — it's free-placed — so the
    // claimable count was always 0 and the card reported a world state
    // that doesn't exist.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/Iron Works — click for details/i);
    await user.click(pin);

    expect(
      screen.queryByText(/Every Water node already feeds a factory/i),
    ).not.toBeInTheDocument();
    const place = await screen.findByRole("button", { name: /place water extractors for water/i });
    await user.click(place);

    expect(await screen.findByRole("status")).toHaveTextContent(/placing water extractors/i);
  });
});

describe("<MapView /> — binding instruction lands on a card that's already open", () => {
  beforeEach(() => mockClaimFlowApis([unboundIronClaim]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("prefills the factory even when the target node's card was open before the button was pressed", async () => {
    // Both cards can be up at once — a factory-pin click clears the
    // node selection, but a node-marker click doesn't clear the
    // factory. So "Claim a node" can name the node already showing,
    // and selecting it again is a no-op: no remount, and `bindTo` is
    // only read in a mount-time initialiser.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/Iron Works — click for details/i);
    await user.click(pin);
    // Open the node's own card first — this is the step that made the
    // instruction silently vanish.
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));
    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("");

    await user.click(await screen.findByRole("button", { name: /claim a node for iron ore/i }));

    expect(await screen.findByRole("combobox", { name: /factory/i })).toHaveValue("Iron Works");
  });
});

describe("<MapView /> — the factory card while the node list is still loading", () => {
  beforeEach(() => mockClaimFlowApis([nearIronNode]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("doesn't claim a resource has no map nodes just because they haven't arrived yet", async () => {
    // Nodes and factories are independent queries; the factory one can
    // resolve first. An empty node list at that moment means "not
    // known yet", and reporting it as "no map nodes for Iron Ore"
    // states something about the world that isn't true.
    let releaseNodes: (rows: ResourceNodeRow[]) => void = () => {};
    vi.spyOn(resourcesApi, "list").mockReturnValue(
      new Promise<ResourceNodeRow[]>((resolve) => {
        releaseNodes = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    const pin = await screen.findByTitle(/Iron Works — click for details/i);
    await user.click(pin);
    await screen.findByText(/30\/min missing/);

    expect(screen.queryByText(/No map nodes for Iron Ore/i)).not.toBeInTheDocument();

    await act(async () => {
      releaseNodes([nearIronNode]);
    });

    expect(
      await screen.findByRole("button", { name: /claim a node for iron ore/i }),
    ).toBeEnabled();
  });
});

describe("nodeClusters — against the bundled catalog", () => {
  it("leaves no node unreachable at any zoom the map opens at", async () => {
    // The five-node fixture above pins the shape; this pins the
    // property over all 608 real nodes, which is where the original
    // finding was measured (66 nodes started a stack the pager
    // couldn't walk at 0.6, 98 at 1.0). Reciprocity is the whole
    // guarantee: if every member of a cluster sees the identical list,
    // paging from any of them reaches all of them.
    const catalog: Array<{ id: string; x: number; y: number; resourceItemName?: string }> = (
      await import("../../../../src-tauri/game-data/nodes.json")
    ).default;
    const nodes = catalog.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      resourceItemName: n.resourceItemName ?? n.id,
    }));
    expect(nodes.length).toBeGreaterThan(600);

    for (const zoom of [0.4, 0.6, 1, 3, 6]) {
      const clusters = nodeClusters(nodes, zoom);
      const notReciprocal = nodes.filter((n) => {
        const mine = clusters.get(n.id) ?? [];
        return mine.some((peer) => (clusters.get(peer.id) ?? []) !== mine);
      });
      expect(notReciprocal.map((n) => n.id)).toEqual([]);
      // Every node belongs to exactly one cluster, and that cluster
      // contains it — no node is stranded outside its own pile.
      for (const n of nodes) {
        expect((clusters.get(n.id) ?? []).map((c) => c.id)).toContain(n.id);
      }
    }
  });
});

describe("frameScale", () => {
  // Every integration test runs against jsdom's 0×0 rect, where this
  // degenerates to the 0.4 floor whatever the formula says — so the
  // behaviour "Jump to my claims" gained (it now picks a zoom, where
  // it used to preserve the player's) is only pinned here.
  const rect = { width: 1000, height: 800 };

  it("zooms in on a tight cluster, up to the framing cap", () => {
    expect(frameScale(0, 0, rect)).toBe(1.5);
    expect(frameScale(10, 10, rect)).toBe(1.5);
  });

  it("backs off far enough to frame a wide spread", () => {
    // 1000 / (500 × 1.5 padding) = 1.333 on the narrow axis.
    expect(frameScale(500, 200, rect)).toBeCloseTo(1.333, 3);
  });

  it("never zooms out past the point where bare canvas shows", () => {
    // The whole map spread can't be framed inside this container at
    // any scale that still covers it, so the cover fit wins.
    const wide = { width: 4096, height: 4096 };
    expect(frameScale(2048, 2048, wide)).toBeCloseTo(2, 5);
  });
});

describe("prefersReducedMotion", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("is false when the host has no matchMedia at all", () => {
    // jsdom and any non-browser host: the guard is what keeps the
    // camera helpers from throwing on the way to a transform.
    Reflect.deleteProperty(window, "matchMedia");
    expect(prefersReducedMotion()).toBe(false);
  });

  it("follows the reduce query when the host answers it", () => {
    const query = vi.fn((q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList);
    window.matchMedia = query as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(true);
    expect(query).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });
});

describe("<MapView /> — Escape across every card, and who gets it first", () => {
  beforeEach(() => {
    mockClaimFlowApis([nearIronNode]);
    vi.spyOn(resourcesApi, "listWaterGroups").mockResolvedValue([waterGroup]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("closes the factory card", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Works — click for details/i));
    await screen.findByRole("button", { name: /open plan/i });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /open plan/i })).not.toBeInTheDocument(),
    );
  });

  it("closes the water extractor card", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    // Double-click is what opens the editor; a single click toggles
    // the pin's lock.
    await user.dblClick(await screen.findByTitle(/Water Extractor · 480/i));
    await screen.findByRole("spinbutton", { name: /extractor count/i });

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("spinbutton", { name: /extractor count/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("cancels armed placement before it closes any card", async () => {
    // The deliberate part: an armed tool is the more urgent mode to be
    // able to back out of, so the card must survive the Escape that
    // disarms it. Nothing covered this, which is the one interaction
    // the early return exists for.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Works — click for details/i));
    await screen.findByRole("button", { name: /open plan/i });
    await user.click(screen.getByRole("button", { name: /^place a factory$/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/placing a factory/i);

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /open plan/i })).toBeInTheDocument();

    // And the next Escape, with nothing armed, closes the card.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /open plan/i })).not.toBeInTheDocument(),
    );
  });
});

describe("<MapView /> — an open card outlives the filters, and doesn't rewrite them", () => {
  beforeEach(() => mockClaimFlowApis([unboundIronClaim]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("keeps the open card's own node on screen when a filter would hide it", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));
    await screen.findByRole("dialog");

    // Turning claimed nodes off would drop this node out of the
    // visible set from under its own open card.
    await user.click(screen.getByLabelText(/show claimed nodes too/i));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(renderedMarkerIds(container)).toEqual(["n-near"]);
  });

  it("returns focus to the map when the marker it came from is gone", async () => {
    // The common path, not an edge case: claiming a node removes its
    // marker whenever "show claimed nodes too" is off, so a focus
    // return that only looks for the marker silently lands on
    // document.body exactly when the player has just done the thing
    // the card is for.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Ore · Normal/));
    await screen.findByRole("dialog");
    await user.click(screen.getByLabelText(/show claimed nodes too/i));

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Identified by what it contains rather than a class added for the
    // test's benefit: focus landed on the region holding the map.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.querySelector('img[alt="Satisfactory map"]')).toBeTruthy();
  });

  it("doesn't rewrite a saved filter to carry out the shortfall shortcut", async () => {
    // The player has deliberately turned claimed nodes off. Asserting
    // against the *default* would pass either way, since setting a
    // preference to the value it already holds writes nothing.
    localStorage.setItem("specs:map:showClaimedToo:p", "0");
    // The node this lands on carries a claim, so the shortcut used to
    // force "show claimed nodes too" on — and that preference
    // persists, so a one-off action permanently changed the player's
    // saved view.
    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Works — click for details/i));
    await user.click(await screen.findByRole("button", { name: /claim a node for iron ore/i }));
    await screen.findByRole("dialog");

    expect(localStorage.getItem("specs:map:showClaimedToo:p")).toBe("0");
    expect(localStorage.getItem("specs:map:hiddenResources:p")).toBeNull();
  });
});

/** Hard against the world's south-east corner, where centring the node
 * would pull bare canvas into frame and `centerPan` refuses. */
const cornerNode: ResourceNodeRow = { ...nearIronNode, id: "n-corner", x: 420000, y: 370000 };

describe("<MapView /> — the card follows the marker even when the camera couldn't centre it", () => {
  beforeEach(() => mockClaimFlowApis([cornerNode]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("anchors where the node actually landed, not where centring would have put it", async () => {
    // `frameMapPoints` clamps the pan so the map's edge never comes
    // into view, so for an edge node the marker ends up far from the
    // middle — a card pinned to the viewport centre points at empty
    // map. jsdom's 0×0 rect hides this, hence the mocked boxes.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 800,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(330);

    const user = userEvent.setup();
    renderWithProviders(<MapView />);
    await user.click(await screen.findByTitle(/Iron Works — click for details/i));
    await user.click(await screen.findByRole("button", { name: /claim a node for iron ore/i }));

    const card = await screen.findByRole("dialog");
    // Centring would have anchored at (500, 400) and put the card at
    // 514 — well left of the marker it describes.
    expect(Number.parseInt(card.style.left, 10)).toBeGreaterThan(600);
  });
});

describe("<MapView /> — a drag interrupted by unmount", () => {
  beforeEach(() => mockClaimFlowApis([nearIronNode]));
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("doesn't finish binding against a tree that's gone", async () => {
    // The drag's move/up listeners live on `window` and are torn down
    // inside the up handler, which never runs if the view unmounts
    // mid-drag — leaving a mouseup that commits a claim and calls
    // setState on a dead component. Dropping over a pin is what makes
    // the difference observable: a surviving handler has a hover
    // target and writes.
    const setClaimSpy = vi.spyOn(resourcesApi, "setClaim").mockResolvedValue(undefined);
    const { unmount } = renderWithProviders(<MapView />);
    const marker = await screen.findByTitle(/Iron Ore · Normal/);
    const pin = await screen.findByTitle(/Iron Works — click for details/i);

    fireEvent.mouseDown(marker, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseEnter(pin);
    // Sanity: the drop target really is armed, so the only reason the
    // mouseup below writes nothing is the cleanup under test.
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });
    // The mutation reaches the api in a microtask, so a synchronous
    // assertion here would hold whether or not the drop committed —
    // which is exactly how the negative case below could pass
    // vacuously.
    await waitFor(() => expect(setClaimSpy).toHaveBeenCalledTimes(1));
    setClaimSpy.mockClear();

    fireEvent.mouseDown(marker, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseEnter(pin);
    unmount();
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 });

    // Same microtask budget the positive case needed before it could
    // be seen.
    await act(async () => {});
    expect(setClaimSpy).not.toHaveBeenCalled();
  });
});
