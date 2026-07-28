import { describe, expect, it } from "vitest";

import type { LogisticsLink } from "@/features/logistics/types";

import {
  buildNetworkEdges,
  colourForKind,
  curvatureForParallelEdge,
  strokeWidthForUtilisation,
  utilisationFromPlanJson,
} from "./edgeStyle";

function link(overrides: Partial<LogisticsLink> & Pick<LogisticsLink, "id" | "itemId">): LogisticsLink {
  return {
    fromFactoryId: "iron",
    toFactoryId: "elevator",
    itemsPerMinute: 5,
    transportKind: "belt",
    transportPlanJson: "{}",
    createdAt: "2026-05-10T00:00:00Z",
    updatedAt: "2026-05-10T00:00:00Z",
    ...overrides,
  };
}

describe("colourForKind", () => {
  it("maps each transport kind to a CSS variable reference", () => {
    expect(colourForKind("belt")).toContain("var(--color-belt");
    expect(colourForKind("pipe")).toContain("var(--color-pipe");
    expect(colourForKind("truck")).toContain("var(--color-transport-truck");
    expect(colourForKind("tractor")).toContain("var(--color-transport-truck");
    expect(colourForKind("train")).toContain("var(--color-transport-train");
    expect(colourForKind("drone")).toContain("var(--color-transport-drone");
  });
});

describe("strokeWidthForUtilisation", () => {
  it("returns the floor for non-positive or NaN inputs", () => {
    expect(strokeWidthForUtilisation(0)).toBe(1.5);
    expect(strokeWidthForUtilisation(-1)).toBe(1.5);
    expect(strokeWidthForUtilisation(NaN)).toBe(1.5);
  });

  it("returns 6.0 at full utilisation", () => {
    expect(strokeWidthForUtilisation(1)).toBeCloseTo(6.0);
  });

  it("caps at 6.0 for over-100% inputs", () => {
    // Caller is expected to keep utilisation in [0, 1]; clamp anyway.
    expect(strokeWidthForUtilisation(2)).toBeCloseTo(6.0);
  });

  it("scales linearly between 1.5 and 6.0", () => {
    expect(strokeWidthForUtilisation(0.5)).toBeCloseTo(3.75);
  });
});

describe("curvatureForParallelEdge", () => {
  it("keeps React Flow's own default curvature for a lone edge", () => {
    expect(curvatureForParallelEdge(0, 1)).toBe(0.25);
  });

  it("fans two edges symmetrically around the default so neither sits on the other", () => {
    // #71: two links between the same factory pair used to draw one on
    // top of the other, hiding one label entirely and reading as a
    // single edge with the wrong (unsummed) total.
    const a = curvatureForParallelEdge(0, 2);
    const b = curvatureForParallelEdge(1, 2);
    expect(a).not.toBeCloseTo(b);
    // Symmetric around the default curvature — the pair fans out
    // evenly rather than skewing to one side.
    expect(a + b).toBeCloseTo(0.5);
  });

  it("keeps every edge in a larger group distinct", () => {
    const curvatures = [0, 1, 2].map((i) => curvatureForParallelEdge(i, 3));
    expect(new Set(curvatures.map((c) => c.toFixed(6))).size).toBe(3);
  });
});

describe("buildNetworkEdges", () => {
  const items = new Map([
    ["Desc_IronPlateReinforced_C", { name: "Reinforced Iron Plate", isFluid: false }],
    ["Desc_Rotor_C", { name: "Rotor", isFluid: false }],
  ]);

  it("gives two links between the same factory pair distinct edges, each named for its own item (#71)", () => {
    // Regresses: Iron Works -> Elevator Yard carrying both Reinforced
    // Iron Plate and Rotor at 5/min each used to draw as one overlapping
    // edge labelled "5 ipm" — the wrong (unsummed) total, and no way to
    // tell which item it was.
    const links = [
      link({ id: "link-rip", itemId: "Desc_IronPlateReinforced_C" }),
      link({ id: "link-rotor", itemId: "Desc_Rotor_C" }),
    ];
    const edges = buildNetworkEdges(links, items);

    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.label)).toEqual([
      "Reinforced Iron Plate · 5 ipm",
      "Rotor · 5 ipm",
    ]);
    // Distinct curvature so the two edges don't draw on top of each
    // other — the actual bug behind the collapsed single edge.
    const [a, b] = edges;
    expect(a.data?.curvature).not.toBeCloseTo(b.data?.curvature ?? 0);
  });

  it("keeps a lone link at the default curvature — no visible change for the common case", () => {
    const edges = buildNetworkEdges(
      [link({ id: "link-rip", itemId: "Desc_IronPlateReinforced_C" })],
      items,
    );
    expect(edges[0].data?.curvature).toBe(0.25);
  });

  it("falls back to the fluid unit and the raw id when the item lookup is missing an entry", () => {
    const edges = buildNetworkEdges(
      [link({ id: "link-unknown", itemId: "Desc_Water_C", itemsPerMinute: 120 })],
      new Map(),
    );
    expect(edges[0].label).toBe("Desc_Water_C · 120 ipm");
  });

  it("keeps a fractional rate's decimal instead of rounding it away", () => {
    // Throughput is routinely fractional in this app (a Motor line at
    // 2.5/min, say) — `toFixed(0)` used to round that to "3 ipm", a
    // figure that isn't what's actually flowing.
    const edges = buildNetworkEdges(
      [link({ id: "link-rip", itemId: "Desc_IronPlateReinforced_C", itemsPerMinute: 2.5 })],
      items,
    );
    expect(edges[0].label).toBe("Reinforced Iron Plate · 2.5 ipm");
  });
});

describe("utilisationFromPlanJson", () => {
  it("extracts utilisationPct and converts to a 0..1 fraction", () => {
    expect(utilisationFromPlanJson(JSON.stringify({ utilisationPct: 80 }))).toBeCloseTo(0.8);
    expect(utilisationFromPlanJson(JSON.stringify({ utilisationPct: 0 }))).toBe(0);
    expect(utilisationFromPlanJson(JSON.stringify({ utilisationPct: 100 }))).toBe(1);
  });

  it("clamps values outside 0..100 into [0, 1]", () => {
    expect(utilisationFromPlanJson(JSON.stringify({ utilisationPct: 150 }))).toBe(1);
    expect(utilisationFromPlanJson(JSON.stringify({ utilisationPct: -5 }))).toBe(0);
  });

  it("returns 0 for malformed JSON", () => {
    expect(utilisationFromPlanJson("not json")).toBe(0);
    expect(utilisationFromPlanJson("{}")).toBe(0);
    expect(utilisationFromPlanJson(JSON.stringify({ utilisationPct: "high" }))).toBe(0);
  });
});
