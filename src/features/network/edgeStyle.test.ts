import { describe, expect, it } from "vitest";

import {
  colourForKind,
  strokeWidthForUtilisation,
  utilisationFromPlanJson,
} from "./edgeStyle";

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
