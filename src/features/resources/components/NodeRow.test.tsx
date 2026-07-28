import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { NodeRow } from "./NodeRow";
import { resourcesApi } from "../api";
import { playthroughApi } from "@/features/playthrough/api";
import type { ResourceNodeRow } from "../types";

const MINER_EXTRACTORS = [
  { id: "Build_MinerMk1_C", name: "Miner Mk.1", baseIpm: 60, unlockTier: 0 },
  { id: "Build_MinerMk2_C", name: "Miner Mk.2", baseIpm: 120, unlockTier: 4 },
  { id: "Build_MinerMk3_C", name: "Miner Mk.3", baseIpm: 240, unlockTier: 8 },
];

const unclaimed: ResourceNodeRow = {
  id: "BP_Iron1",
  resourceItemId: "Desc_OreIron_C",
  resourceItemName: "Iron Ore",
  purity: "Pure",
  kind: "miner_node",
  x: 0,
  y: 0,
  z: 0,
  claim: null,
  itemsPerMinute: 0,
  allowedExtractors: MINER_EXTRACTORS,
  claimInvalidExtractor: false,
};

const claimedMk2: ResourceNodeRow = {
  ...unclaimed,
  id: "BP_Iron2",
  claim: {
    minerId: "Build_MinerMk2_C",
    clockPct: 100,
    factoryId: null,
    notes: null,
    createdAt: "2026-05-11T00:00:00Z",
    updatedAt: "2026-05-11T00:00:00Z",
  },
  itemsPerMinute: 240,
};

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  // setClaim's undo flow reads the full list to capture the pre-image —
  // mock it so the apply closure resolves immediately.
  vi.spyOn(resourcesApi, "list").mockResolvedValue([unclaimed, claimedMk2]);
  vi.spyOn(resourcesApi, "setClaim").mockResolvedValue(undefined);
  vi.spyOn(resourcesApi, "clearClaim").mockResolvedValue(undefined);
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p1",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 4,
    currentMilestoneProgress: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<NodeRow />", () => {
  it("renders unclaimed nodes with a claim button (no chip)", () => {
    renderWithProviders(<NodeRow row={unclaimed} factories={[]} index={0} preferredMinerId={null} />);
    expect(screen.getByText("unclaimed")).toBeInTheDocument();
    expect(screen.getByLabelText("Claim node")).toBeInTheDocument();
  });

  it("renders claimed nodes with miner mark + clock + ipm chips", () => {
    renderWithProviders(<NodeRow row={claimedMk2} factories={[]} index={0} preferredMinerId={null} />);
    expect(screen.getByText("Mk2")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("240 ipm")).toBeInTheDocument();
  });

  it("shows the clock badge's actual fraction instead of rounding it away (#51)", () => {
    // 100% and other whole numbers pass whether the badge rounds or
    // not — this pins a genuine non-whole clock, which used to render
    // as "38%" (Math.round-style .toFixed(0)) even though nothing in
    // the app ever set the claim to 38.
    const fractional: ResourceNodeRow = {
      ...claimedMk2,
      claim: {
        minerId: "Build_MinerMk2_C",
        clockPct: 37.5,
        factoryId: null,
        notes: null,
        createdAt: "2026-05-11T00:00:00Z",
        updatedAt: "2026-05-11T00:00:00Z",
      },
    };
    renderWithProviders(<NodeRow row={fractional} factories={[]} index={0} preferredMinerId={null} />);
    expect(screen.getByText("37.5%")).toBeInTheDocument();
    expect(screen.queryByText("38%")).toBeNull();
  });

  it("still reads a whole clock cleanly when it arrives with float noise", () => {
    // The same f32-round-trip dust `floorClockPct`'s epsilon guards
    // against on the Rust side — the badge must collapse it back to
    // "50%", not print the raw fractional digits.
    const noisy: ResourceNodeRow = {
      ...claimedMk2,
      claim: {
        minerId: "Build_MinerMk2_C",
        clockPct: 49.999999999999,
        factoryId: null,
        notes: null,
        createdAt: "2026-05-11T00:00:00Z",
        updatedAt: "2026-05-11T00:00:00Z",
      },
    };
    renderWithProviders(<NodeRow row={noisy} factories={[]} index={0} preferredMinerId={null} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("one-click claim sends sensible defaults (Mk1, 100% clock, no factory)", async () => {
    renderWithProviders(<NodeRow row={unclaimed} factories={[]} index={0} preferredMinerId={null} />);
    fireEvent.click(screen.getByLabelText("Claim node"));
    await waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith({
        nodeId: "BP_Iron1",
        minerId: "Build_MinerMk1_C",
        clockPct: 100,
        factoryId: null,
        notes: null,
      }),
    );
  });

  it("one-click claim uses the map's Placing mark when the node accepts it, not always Mk1", async () => {
    // Regresses the list's `+` ignoring the tier-appropriate mark the
    // map's own quick-claim already honours — a Tier 8 claim from this
    // list defaulted to Mk1 (three marks below what's unlocked) and
    // needed a second edit pass every time.
    renderWithProviders(
      <NodeRow
        row={unclaimed}
        factories={[]}
        index={0}
        preferredMinerId="Build_MinerMk3_C"
      />,
    );
    fireEvent.click(screen.getByLabelText("Claim node"));
    await waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith(
        expect.objectContaining({ minerId: "Build_MinerMk3_C" }),
      ),
    );
  });

  it("falls back to the node's first allowed extractor when the preferred mark isn't valid here", async () => {
    // An oil node only ever accepts the Oil Extractor — a miner mark
    // preference from elsewhere on the map must not leak through.
    renderWithProviders(
      <NodeRow
        row={oilNode}
        factories={[]}
        index={0}
        preferredMinerId="Build_MinerMk3_C"
      />,
    );
    fireEvent.click(screen.getByLabelText("Claim node"));
    await waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith(
        expect.objectContaining({ minerId: "Build_OilPump_C" }),
      ),
    );
  });

  it("the clock editor's rate preview tracks the unsaved input, not the saved claim (#49)", () => {
    // claimedMk2 is a Pure node on Miner Mk.2 (base 120) saved at
    // 100% — 240 ipm, matching its `itemsPerMinute` fixture. Dragging
    // to 50% without saving used to leave the row reading the stale
    // "240 ipm" the whole time; the preview here has to move with the
    // still-unsaved 50%, and the saved chip must NOT move with it.
    renderWithProviders(<NodeRow row={claimedMk2} factories={[]} index={0} preferredMinerId={null} />);
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(screen.getByText("240 ipm at this clock")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Claim clock percent"), { target: { value: "50" } });

    // 120 base × 2.0 (Pure) × 0.5 (50% clock) = 120 — the preview
    // follows the drag.
    expect(screen.getByText("120 ipm at this clock")).toBeInTheDocument();
    expect(screen.queryByText("240 ipm at this clock")).toBeNull();
    // The saved chip is a separate number and must not have moved —
    // this is the exact split the issue is about: a live preview that
    // silently became the "saved" readout would be just as confusing
    // as no preview at all.
    expect(screen.getByText("240 ipm")).toBeInTheDocument();
  });

  it("editing surfaces the bound-factory combobox with the playthrough's factories", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NodeRow
        row={claimedMk2}
        index={0}
        preferredMinerId={null}
        // (0,0) on both factories is the "never placed on the map"
        // sentinel (see `hasWorldPosition`) — keeps this test about the
        // dropdown listing every factory, not about distance sorting.
        factories={[
          { id: "F1", name: "Iron Plant", worldX: 0, worldY: 0 },
          { id: "F2", name: "Steel Plant", worldX: 0, worldY: 0 },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit"));
    const combobox = screen.getByRole("combobox", { name: /factory/i });
    expect(combobox).toBeInTheDocument();
    await user.click(combobox);
    expect(await screen.findByRole("option", { name: /Iron Plant/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Steel Plant/ })).toBeInTheDocument();
  });

  it("orders the factory picker nearest-first and shows the distance a native select can't", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NodeRow
        row={claimedMk2}
        index={0}
        preferredMinerId={null}
        factories={[
          // 3-4-5 triangle scaled into world cm, straight from the node's
          // own (0, 0) coords — 500m and 5m respectively.
          { id: "far", name: "Steel Plant", worldX: 30000, worldY: 40000 },
          { id: "near", name: "Iron Plant", worldX: 300, worldY: 400 },
          { id: "unplaced", name: "Future Plant", worldX: 0, worldY: 0 },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit"));
    await user.click(screen.getByRole("combobox", { name: /factory/i }));
    // Name-filtered to the factory options — the row's own Extractor
    // combobox stays closed throughout this test, so it never
    // contributes any "option" role elements here.
    const options = await screen.findAllByRole("option", { name: /Plant/ });
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Iron Plant"),
      expect.stringContaining("Steel Plant"),
      expect.stringContaining("Future Plant"),
    ]);
    expect(options[0].textContent).toContain("5 m");
    // Unplaced factories can't measure a distance — no bogus number,
    // and they sort after every measured factory.
    expect(options[2].textContent).not.toMatch(/\d+ m/);
  });

  it("fracking wells expose the well extractor instead of miner marks", () => {
    const well: ResourceNodeRow = {
      ...unclaimed,
      id: "BP_Water1",
      resourceItemId: "Desc_Water_C",
      resourceItemName: "Water",
      kind: "fracking_well",
      allowedExtractors: [
        { id: "Build_FrackingSmasher_C", name: "Resource Well Pressuriser", baseIpm: 60, unlockTier: 8 },
      ],
    };
    renderWithProviders(<NodeRow row={well} factories={[]} index={0} preferredMinerId={null} />);
    fireEvent.click(screen.getByLabelText("Claim node"));
    return waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith(
        expect.objectContaining({ minerId: "Build_FrackingSmasher_C" }),
      ),
    );
  });

  const oilNode: ResourceNodeRow = {
    ...unclaimed,
    id: "BP_Oil1",
    resourceItemId: "Desc_LiquidOil_C",
    resourceItemName: "Crude Oil",
    purity: "Normal",
    allowedExtractors: [
      { id: "Build_OilPump_C", name: "Oil Extractor", baseIpm: 120, unlockTier: 5 },
    ],
  };

  it("oil nodes one-click claim with the Oil Extractor, not a miner", async () => {
    renderWithProviders(<NodeRow row={oilNode} factories={[]} index={0} preferredMinerId={null} />);
    fireEvent.click(screen.getByLabelText("Claim node"));
    await waitFor(() =>
      expect(resourcesApi.setClaim).toHaveBeenCalledWith(
        expect.objectContaining({ minerId: "Build_OilPump_C" }),
      ),
    );
  });

  it("oil node editor offers only the Oil Extractor, tier-badged", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NodeRow
        row={{
          ...oilNode,
          claim: {
            minerId: "Build_OilPump_C",
            clockPct: 100,
            factoryId: null,
            notes: null,
            createdAt: "2026-06-11T00:00:00Z",
            updatedAt: "2026-06-11T00:00:00Z",
          },
          itemsPerMinute: 120,
        }}
        factories={[]}
        index={0}
        preferredMinerId={null}
      />,
    );
    fireEvent.click(screen.getByLabelText("Edit"));
    await user.click(screen.getByRole("combobox", { name: /extractor/i }));
    // Tier now comes from the shared `TierBadge` (reused from the Alts
    // screen) rendered beside the option, not baked into the label text.
    const option = await screen.findByRole("option", { name: /Oil Extractor/ });
    expect(option).toHaveTextContent("Tier 5");
    expect(screen.queryByRole("option", { name: /Miner Mk/ })).toBeNull();
  });

  it("flags a stale miner claim on an oil node and preselects the fix", () => {
    renderWithProviders(
      <NodeRow
        row={{
          ...oilNode,
          claim: {
            minerId: "Build_MinerMk2_C",
            clockPct: 100,
            factoryId: null,
            notes: null,
            createdAt: "2026-06-11T00:00:00Z",
            updatedAt: "2026-06-11T00:00:00Z",
          },
          // The backend already computes the rate with the correct
          // extractor (120 base on Normal), not the stored Mk2.
          itemsPerMinute: 120,
          claimInvalidExtractor: true,
        }}
        factories={[]}
        index={0}
        preferredMinerId={null}
      />,
    );
    expect(screen.getByText("wrong extractor")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Edit"));
    // Editor coerces the selection to the valid building so a plain
    // Save repairs the claim. The combobox's value is the option's
    // display label now, not the raw building id a native `<select>`
    // would report.
    expect(screen.getByRole("combobox", { name: /extractor/i })).toHaveValue("Oil Extractor");
  });

  it("keeps a stored above-tier extractor selected in the picker instead of falling back to the family's first option", () => {
    // Regression: the options list here is already the tier-preserved
    // one `list_resource_nodes_impl` builds — a legacy claim's extractor
    // stays in `allowedExtractors` even above the current tier
    // (`tier_eligible_extractors` narrows to what's *newly* pickable,
    // then the stored id is appended back in if narrowing dropped it).
    // The picker's job is to actually show that preserved entry as
    // selected — falling back to the first (lowest) option once
    // silently downgraded a stored Mk.2 to Mk.1 on save.
    const aboveTierClaim: ResourceNodeRow = {
      ...unclaimed,
      id: "BP_Iron3",
      claim: {
        minerId: "Build_MinerMk3_C",
        clockPct: 100,
        factoryId: null,
        notes: null,
        createdAt: "2026-05-11T00:00:00Z",
        updatedAt: "2026-05-11T00:00:00Z",
      },
      // Tier 4 current: only Mk1 is newly pickable, but the stored Mk3
      // (unlockTier 8) rides along.
      allowedExtractors: [MINER_EXTRACTORS[0], MINER_EXTRACTORS[2]],
    };
    renderWithProviders(
      <NodeRow row={aboveTierClaim} factories={[]} index={0} preferredMinerId={null} />,
    );
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(screen.getByRole("combobox", { name: /extractor/i })).toHaveValue("Miner Mk.3");
  });

  it("flags a claim over its port capacity inline, at the point the clock was set (#101)", () => {
    // Regression: the same check the Validate panel already surfaced
    // used to only exist two screens away — the row where the illegal
    // clock is actually set showed nothing.
    renderWithProviders(
      <NodeRow
        row={claimedMk2}
        factories={[]}
        index={0}
        preferredMinerId={null}
        portWarning={{
          kind: "claimOverPortCapacity",
          severity: "warning",
          category: "capacity",
          nodeId: claimedMk2.id,
          resourceItemName: "Pure Iron Ore",
          nodeIndex: 0,
          nodePurity: "Pure",
          nodeX: 0,
          nodeY: 0,
          extractorName: "Miner Mk.2",
          outputIpm: 240,
          capacityIpm: 60,
          isFluid: false,
          capacityMark: 1,
          // Non-whole ratio (162.5, not 25) — pins the same floor-not-round
          // fix the Validate panel got, so the row's own tooltip can't
          // regress to advising a clock that still overshoots.
          maxFittingClockPct: 62.5,
        }}
      />,
    );
    const flag = screen.getByText("over port cap");
    expect(flag).toBeInTheDocument();
    expect(flag).toHaveAttribute("title", expect.stringContaining("clock to 62% to fit"));
  });

  it("renders no port-capacity flag when the claim fits", () => {
    renderWithProviders(
      <NodeRow row={claimedMk2} factories={[]} index={0} preferredMinerId={null} />,
    );
    expect(screen.queryByText("over port cap")).toBeNull();
  });

  it("labels a well satellite and an oil seep so the two Crude Oil rows don't read as identical", () => {
    const wellSatellite: ResourceNodeRow = {
      ...oilNode,
      id: "BP_OilWell1",
      kind: "fracking_well",
      allowedExtractors: [
        { id: "Build_FrackingSmasher_C", name: "Resource Well Extractor", baseIpm: 60, unlockTier: 8 },
      ],
    };
    renderWithProviders(
      <div>
        <NodeRow row={oilNode} factories={[]} index={0} preferredMinerId={null} />
        <NodeRow row={wellSatellite} factories={[]} index={1} preferredMinerId={null} />
      </div>,
    );
    expect(screen.getByText("Oil seep")).toBeInTheDocument();
    expect(screen.getByText("Well satellite")).toBeInTheDocument();
  });

  it("doesn't label an ordinary miner node — the resource name is already unambiguous", () => {
    renderWithProviders(<NodeRow row={unclaimed} factories={[]} index={0} preferredMinerId={null} />);
    expect(screen.queryByText("Oil seep")).toBeNull();
    expect(screen.queryByText("Well satellite")).toBeNull();
  });
});
