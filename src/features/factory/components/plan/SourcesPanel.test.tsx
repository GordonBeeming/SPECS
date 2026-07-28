import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { playthroughApi } from "@/features/playthrough/api";
import { plannerApi } from "@/features/planner/api";
import type {
  ExportOffer,
  ExportOfferProduct,
  RaiseExportTargetResult,
} from "@/features/planner/types";
import { SourcesPanel } from "./SourcesPanel";

// Same 3-4-5-triangle coordinates used to pin `factoryDistanceMeters` in
// map/transform.test.ts and the logistics editor: 30,000cm × 40,000cm
// apart = 50,000cm = 500m. Kept off (0, 0) so neither factory reads as
// the "unplaced" sentinel.
const home = { id: "f-home", name: "Home Factory", iconId: null, worldX: 10000, worldY: 10000 };
const exporter = { id: "f-exporter", name: "Copper Works", iconId: null, worldX: 40000, worldY: 50000 };
// dx=60,000cm, dy=0 from home — a distinct, round 600m so assertions
// don't collide with the exporter's 500m.
const nonExporter = { id: "f-other", name: "Iron Works", iconId: null, worldX: 70000, worldY: 10000 };
const unplaced = { id: "f-unplaced", name: "Unplaced Depot", iconId: null, worldX: 0, worldY: 0 };

const ITEM = "Desc_CopperIngot_C";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function baseProps() {
  return {
    factoryId: home.id,
    itemId: ITEM,
    itemName: "Copper Ingot",
    sources: [],
    localIpm: 60,
    totalIpm: 60,
    allocations: [],
    unassignedIpm: 0,
    factoryNames: new Map([
      [home.id, home.name],
      [exporter.id, exporter.name],
      [nonExporter.id, nonExporter.name],
      [unplaced.id, unplaced.name],
    ]),
    allFactories: [home, exporter, nonExporter, unplaced],
    raiseLog: [],
    onRaised: vi.fn(),
    onClearRaiseLog: vi.fn(),
    onAddExternal: vi.fn(),
    onRemoveSource: vi.fn(),
    onAddLocal: vi.fn(),
    onRemoveLocal: vi.fn(),
    onSetCap: vi.fn(),
    onSetSource: vi.fn(),
    onClose: vi.fn(),
  };
}

function product(over: Partial<ExportOfferProduct> = {}): ExportOfferProduct {
  return {
    itemId: ITEM,
    itemName: "Copper Ingot",
    producedIpm: 60,
    exportIpm: 60,
    drawnIpm: 0,
    remainingIpm: 60,
    spareIpm: 60,
    // Most fixtures in this file model a real plan target; the
    // intermediate-specific tests override this to false explicitly.
    hasTarget: true,
    ...over,
  };
}

function offersOf(over: Partial<ExportOfferProduct> = {}): ExportOffer[] {
  return [
    { factoryId: exporter.id, factoryName: exporter.name, products: [product(over)] },
  ];
}

beforeEach(() => {
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 0,
    currentMilestoneProgress: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<SourcesPanel /> — map-derived distance", () => {
  it("shows the distance to a candidate exporter, and nothing for an unplaced factory", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(offersOf());

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));

    // Copper Works exports this item and is placed on the map — distance shown.
    expect(await screen.findByText(exporter.name)).toBeInTheDocument();
    expect(screen.getByText("500 m away")).toBeInTheDocument();

    // Unplaced Depot never makes this item, so it lands in "not making this"
    // — and since it's unplaced, no distance line should render for it.
    const unplacedButton = screen.getByRole("button", { name: new RegExp(unplaced.name) });
    expect(unplacedButton).not.toHaveTextContent("m away");
  });

  it("shows distance for a non-exporting factory that is placed on the map", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue([]);

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));

    const nonExporterButton = await screen.findByRole("button", { name: new RegExp(nonExporter.name) });
    expect(nonExporterButton).toHaveTextContent("600 m away");
  });

  it("surfaces distance as a hover title on an already-connected source", () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue([]);

    renderWithProviders(
      <SourcesPanel
        {...baseProps()}
        sources={[{ itemId: ITEM, sourceFactoryId: exporter.id, ipmCap: null }]}
      />,
    );

    expect(screen.getByText(exporter.name)).toHaveAttribute("title", "500 m away");
  });

  it("explains what the source cap field does, not just its unit", () => {
    // #71: `auto`/`cap` carried no label, no unit and no tooltip — the
    // local-build cap already had one, this is the external row's.
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue([]);

    renderWithProviders(
      <SourcesPanel
        {...baseProps()}
        sources={[{ itemId: ITEM, sourceFactoryId: exporter.id, ipmCap: null }]}
      />,
    );

    expect(screen.getByLabelText("Source cap per minute")).toHaveAttribute(
      "title",
      expect.stringContaining("pulls as much as it's able to spare"),
    );
  });
});

describe("<SourcesPanel /> — raising a short exporter", () => {
  /** Copper Works exports its whole 60/min output, `remaining` of it spare. */
  function offersWithSpare(remaining: number): ExportOffer[] {
    return offersOf({ drawnIpm: 60 - remaining, remainingIpm: remaining, spareIpm: remaining });
  }

  function raiseResult(over: Partial<RaiseExportTargetResult> = {}): RaiseExportTargetResult {
    return {
      factoryId: exporter.id,
      factoryName: exporter.name,
      itemId: ITEM,
      itemName: "Copper Ingot",
      previousTargetIpm: 60,
      newTargetIpm: 120,
      previousExportIpm: 60,
      newExportIpm: 120,
      remainingIpm: 60,
      introducedWarnings: [],
      worsenedWarnings: [],
      ...over,
    };
  }

  it("asks the exporter for the whole need, on the asking factory's behalf", async () => {
    // The exporter is sized to its old demand and has nothing left —
    // the state that used to make importing a shared intermediate a
    // three-screen round trip.
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(offersWithSpare(0));
    const raise = vi.spyOn(plannerApi, "raiseExportTarget").mockResolvedValue(raiseResult());

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));
    await user.click(await screen.findByRole("button", { name: /raise target/i }));

    // The rate asked for is the spare the panel needs to exist, so a
    // stale offer or a second click can't stack raises.
    expect(raise).toHaveBeenCalledWith(exporter.id, ITEM, 60, home.id);
  });

  it("reports what the raise cost the exporter instead of chasing it upstream", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(offersWithSpare(0));
    vi.spyOn(plannerApi, "raiseExportTarget").mockResolvedValue(
      raiseResult({
        introducedWarnings: [
          {
            kind: "rawShort",
            itemId: "Desc_OreCopper_C",
            itemName: "Copper Ore",
            demandIpm: 120,
            claimedIpm: 60,
          },
        ],
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));
    await user.click(await screen.findByRole("button", { name: /raise target/i }));

    const report = await screen.findByRole("status");
    expect(report).toHaveTextContent("now makes 120/min Copper Ingot");
    expect(report).toHaveTextContent("60/min spare for you");
    // The consequence is named, and explicitly not actioned.
    expect(report).toHaveTextContent(/That left Copper Works short/);
    expect(report).toHaveTextContent(/Copper Ore/);
    expect(report).toHaveTextContent(/Nothing further upstream was changed/);
  });

  it("says it widened a gap it found, rather than claiming it opened it", async () => {
    // Reported after a real raise: both of the exporter's gaps predated
    // the click, and "that left it short" sent the run looking for
    // damage that was already on the screen.
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(offersWithSpare(0));
    vi.spyOn(plannerApi, "raiseExportTarget").mockResolvedValue(
      raiseResult({
        worsenedWarnings: [
          {
            kind: "rawShort",
            itemId: "Desc_LiquidOil_C",
            itemName: "Crude Oil",
            demandIpm: 9.8,
            claimedIpm: 0,
          },
        ],
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));
    await user.click(await screen.findByRole("button", { name: /raise target/i }));

    const report = await screen.findByRole("status");
    expect(report).toHaveTextContent(/widened a shortfall Copper Works already had/);
    expect(report).not.toHaveTextContent(/That left Copper Works short/);
  });

  it("drops the report when the panel switches to another item", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(offersWithSpare(0));
    vi.spyOn(plannerApi, "raiseExportTarget").mockResolvedValue(raiseResult());

    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));
    await user.click(await screen.findByRole("button", { name: /raise target/i }));
    expect(await screen.findByRole("status")).toHaveTextContent("now makes 120/min");

    // The Modular Frame report used to stay pinned above Steel Pipe,
    // reading as though it described the item just opened.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SourcesPanel {...baseProps()} itemId="Desc_Wire_C" itemName="Wire" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/now makes 120\/min/)).not.toBeInTheDocument();
  });

  it("leaves an exporter that already covers the need alone", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(offersWithSpare(60));

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));

    expect(await screen.findByText(exporter.name)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /raise target/i })).not.toBeInTheDocument();
  });

  it("still adds a short exporter as a partial source", async () => {
    // Mixed sourcing is the point — raising must not become the only
    // thing a short exporter row can do.
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(offersWithSpare(20));
    const props = baseProps();

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...props} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));
    await user.click(await screen.findByRole("button", { name: new RegExp(exporter.name) }));

    expect(props.onAddExternal).toHaveBeenCalledWith(ITEM, exporter.id, null);
  });
});

describe("<SourcesPanel /> — an intermediate with no plan target", () => {
  // #106: an intermediate the factory produces along the way now
  // reaches the offer list instead of being hidden, whether it has
  // nothing spare or only some. `hasTarget: false` is the field that
  // says so — the panel used to guess this from `producedIpm` alone,
  // which only worked for the exact-zero case and not the partial one.
  const zeroSpareIntermediate = () =>
    offersOf({
      producedIpm: 0,
      exportIpm: 0,
      drawnIpm: 0,
      remainingIpm: 0,
      spareIpm: 0,
      hasTarget: false,
    });

  const partialSpareIntermediate = () =>
    offersOf({
      producedIpm: 15,
      exportIpm: 15,
      drawnIpm: 0,
      remainingIpm: 15,
      spareIpm: 15,
      hasTarget: false,
    });

  it("reads as 'nothing spare', not 'makes 0/min'", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(zeroSpareIntermediate());

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));

    const row = await screen.findByRole("button", { name: new RegExp(exporter.name) });
    expect(row).toHaveTextContent("nothing spare");
    expect(row).not.toHaveTextContent("0/min");
  });

  it("doesn't offer a Raise target button that has nothing to raise", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(zeroSpareIntermediate());

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));
    await screen.findByText(exporter.name);

    expect(screen.queryByRole("button", { name: /raise target/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Used up internally right now/i)).toBeInTheDocument();
  });

  it("says the same thing for an already-added zero-spare source", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(zeroSpareIntermediate());

    renderWithProviders(
      <SourcesPanel
        {...baseProps()}
        sources={[
          { itemId: ITEM, sourceFactoryId: home.id, ipmCap: 0 },
          { itemId: ITEM, sourceFactoryId: exporter.id, ipmCap: null },
        ]}
        unassignedIpm={20}
      />,
    );

    expect(await screen.findByText(/Used up internally right now/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /raise target/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Makes 0\/min/)).not.toBeInTheDocument();
  });

  it("offers a partial-surplus intermediate as a source without a Raise button", async () => {
    // The case `producedIpm <= 1e-3` never caught: a manual rod bank
    // beside a screw plan, 15/min genuinely spare — enough to look like
    // a modest target by the numbers alone, and enough to 400 on click
    // before `hasTarget` existed to gate it.
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(partialSpareIntermediate());
    const props = baseProps();
    // Ask for more than the 15/min this source can spare, so it lands
    // in the "short" bucket rather than "covers" — that's where the
    // dead-end Raise button used to appear.
    props.totalIpm = 40;

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...props} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));

    const row = await screen.findByRole("button", { name: new RegExp(exporter.name) });
    expect(row).toHaveTextContent("15/min left");
    expect(screen.getByText(/15\/min spare, not enough on its own/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /raise target/i })).not.toBeInTheDocument();

    // Still a usable source — clicking it adds the partial share.
    await user.click(row);
    expect(props.onAddExternal).toHaveBeenCalledWith(ITEM, exporter.id, null);
  });

  it("says the same for an already-added partial-spare source", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(partialSpareIntermediate());

    renderWithProviders(
      <SourcesPanel
        {...baseProps()}
        totalIpm={40}
        sources={[
          { itemId: ITEM, sourceFactoryId: home.id, ipmCap: 0 },
          { itemId: ITEM, sourceFactoryId: exporter.id, ipmCap: null },
        ]}
        unassignedIpm={25}
      />,
    );

    expect(
      await screen.findByText(/Has 15\/min spare, not enough on its own/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /raise target/i })).not.toBeInTheDocument();
  });
});

describe("<SourcesPanel /> — a factory that makes it but has never exported it", () => {
  /** Makes the whole 60/min, none of it offered for export. */
  const producesButDoesntExport = () =>
    offersOf({ exportIpm: 0, drawnIpm: 0, remainingIpm: 0, spareIpm: 60, producedIpm: 60 });

  it("offers it as a source with its spare, not as 'not making this'", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(producesButDoesntExport());

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...baseProps()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));

    const row = await screen.findByRole("button", { name: new RegExp(exporter.name) });
    expect(row).toHaveTextContent("60/min spare");
    expect(screen.getByText(/not exporting it yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nobody makes this yet/i)).not.toBeInTheDocument();
  });

  it("opens the export slice first, then takes the source", async () => {
    // Picking one of these used to add a row supplying 0/min with no
    // machine-count change and no explanation — the flow worked, but
    // only if you knew to go and click Export at the source factory.
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(producesButDoesntExport());
    const raise = vi.spyOn(plannerApi, "raiseExportTarget").mockResolvedValue({
      factoryId: exporter.id,
      factoryName: exporter.name,
      itemId: ITEM,
      itemName: "Copper Ingot",
      previousTargetIpm: 60,
      newTargetIpm: 60,
      previousExportIpm: 0,
      newExportIpm: 60,
      remainingIpm: 60,
      introducedWarnings: [],
      worsenedWarnings: [],
    });
    const props = baseProps();

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...props} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));
    await user.click(await screen.findByRole("button", { name: new RegExp(exporter.name) }));

    expect(raise).toHaveBeenCalledWith(exporter.id, ITEM, 60, home.id);
    // Adding before the slice exists would re-solve against 0 capacity.
    await vi.waitFor(() => expect(props.onAddExternal).toHaveBeenCalledWith(ITEM, exporter.id, null));
  });
});

describe("<SourcesPanel /> — topping up a source already in the list", () => {
  const props = () => ({
    ...baseProps(),
    // Steel Mill's shape: supplying 29 of a 49/min need, nothing else
    // covers the rest.
    totalIpm: 49,
    localIpm: 0,
    sources: [
      { itemId: ITEM, sourceFactoryId: home.id, ipmCap: 0 },
      { itemId: ITEM, sourceFactoryId: exporter.id, ipmCap: null },
    ],
    allocations: [{ sourceFactoryId: exporter.id, resolvedIpm: 29 }],
    unassignedIpm: 20,
  });

  it("offers the raise on the row itself, asking for its share plus the gap", async () => {
    // The panel used to exclude an already-added source from the add
    // list, print "Nobody exports this yet", and leave the cap spinner
    // — which caps rather than raises — as the only thing to click.
    // Makes 29 and sends us all of it — the extra 20 has to be built.
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(
      offersOf({ producedIpm: 29, exportIpm: 29, drawnIpm: 29, remainingIpm: 0, spareIpm: 0 }),
    );
    const raise = vi.spyOn(plannerApi, "raiseExportTarget").mockResolvedValue({
      factoryId: exporter.id,
      factoryName: exporter.name,
      itemId: ITEM,
      itemName: "Copper Ingot",
      previousTargetIpm: 29,
      newTargetIpm: 49,
      previousExportIpm: 29,
      newExportIpm: 49,
      remainingIpm: 49,
      introducedWarnings: [],
      worsenedWarnings: [],
    });

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...props()} />);
    expect(await screen.findByText("Needs 20/min more")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /raise target/i }));

    // 29 already flowing + the 20 nothing covers. Asking for 20 would
    // leave it exactly where it was; asking for 49 + 29 would build
    // machines nobody needs.
    expect(raise).toHaveBeenCalledWith(exporter.id, ITEM, 49, home.id);
  });

  it("lifts a cap that would have made the raise pointless", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(
      offersOf({ producedIpm: 49, exportIpm: 49, drawnIpm: 29, remainingIpm: 20, spareIpm: 20 }),
    );
    vi.spyOn(plannerApi, "raiseExportTarget").mockResolvedValue({
      factoryId: exporter.id,
      factoryName: exporter.name,
      itemId: ITEM,
      itemName: "Copper Ingot",
      previousTargetIpm: 49,
      newTargetIpm: 49,
      previousExportIpm: 49,
      newExportIpm: 49,
      remainingIpm: 49,
      introducedWarnings: [],
      worsenedWarnings: [],
    });
    const p = props();
    p.sources = [
      { itemId: ITEM, sourceFactoryId: home.id, ipmCap: 0 },
      { itemId: ITEM, sourceFactoryId: exporter.id, ipmCap: 29 },
    ];

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...p} />);
    // It makes 49 and only sends us 29, so nothing has to be built —
    // the slice and the cap are the whole of it.
    await user.click(await screen.findByRole("button", { name: /export it/i }));

    // The cap is what the solver reads, so raising the exporter alone
    // would have changed nothing here.
    expect(p.onSetCap).toHaveBeenCalledWith(ITEM, 1, 49);
  });

  it("doesn't claim nobody makes the item when the only maker is already a source", async () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(
      offersOf({ producedIpm: 49, exportIpm: 29, drawnIpm: 29, remainingIpm: 0, spareIpm: 20 }),
    );

    const user = userEvent.setup();
    renderWithProviders(<SourcesPanel {...props()} />);
    await user.click(screen.getByRole("button", { name: /add source/i }));

    expect(await screen.findByText(/already a source/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nobody makes this yet/i)).not.toBeInTheDocument();
  });

  it("says nothing about a gap too small to print", async () => {
    // "Needs 0.0/min more · Raise target" on a plan that balances.
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue(offersOf());
    const p = props();
    p.unassignedIpm = 0.02;
    p.allocations = [{ sourceFactoryId: exporter.id, resolvedIpm: 48.98 }];

    renderWithProviders(<SourcesPanel {...p} />);

    expect(screen.queryByRole("button", { name: /raise target/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Needs 0(\.0)?\/min more/)).not.toBeInTheDocument();
  });
});

describe("<SourcesPanel /> — the running cost of a re-scale", () => {
  it("tallies every raise and the gaps they left open", () => {
    vi.spyOn(plannerApi, "listExportOffers").mockResolvedValue([]);
    const gap = (itemName: string, gapIpm: number) =>
      ({ kind: "importShort", itemId: `Desc_${itemName}_C`, itemName, gapIpm }) as const;

    renderWithProviders(
      <SourcesPanel
        {...baseProps()}
        raiseLog={[
          {
            factoryId: exporter.id,
            factoryName: exporter.name,
            itemId: ITEM,
            itemName: "Copper Ingot",
            previousTargetIpm: 60,
            newTargetIpm: 120,
            previousExportIpm: 60,
            newExportIpm: 120,
            remainingIpm: 60,
            introducedWarnings: [gap("Copper Ore", 40)],
            worsenedWarnings: [],
          },
          {
            factoryId: nonExporter.id,
            factoryName: nonExporter.name,
            itemId: "Desc_IronPlate_C",
            itemName: "Iron Plate",
            previousTargetIpm: 20,
            newTargetIpm: 45,
            previousExportIpm: 20,
            newExportIpm: 45,
            remainingIpm: 25,
            introducedWarnings: [],
            worsenedWarnings: [gap("Crude Oil", 9.8)],
          },
        ]}
      />,
    );

    // After five raises the accumulated cost only existed on the
    // Validate screen; this is it kept where the decisions are made.
    expect(screen.getByText(/2 raises in this plan/)).toBeInTheDocument();
    expect(screen.getByText(/2 gaps left open/)).toBeInTheDocument();
    expect(screen.getByText(/Copper Ingot 60\/min → 120\/min/)).toBeInTheDocument();
    expect(screen.getByText(/Copper Ore/)).toBeInTheDocument();
    expect(screen.getByText(/Crude Oil/)).toBeInTheDocument();
  });
});
