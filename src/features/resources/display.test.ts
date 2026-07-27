import { describe, expect, it } from "vitest";
import { coordChip, nodeKindLabel } from "./display";

describe("coordChip", () => {
  it("prints west and north for negative x/y, not signed east/north", () => {
    // 2.5km west, 1.3km north: SCIM's convention is +x = east, +y = south,
    // so a west/north node is negative on both axes.
    expect(coordChip(-250000, -130000)).toBe("2.5km W · 1.3km N");
  });

  it("prints east and south for positive x/y", () => {
    expect(coordChip(250000, 130000)).toBe("2.5km E · 1.3km S");
  });

  it("defaults to east/south at the origin", () => {
    expect(coordChip(0, 0)).toBe("0.0km E · 0.0km S");
  });
});

describe("nodeKindLabel", () => {
  it("labels a fracking well a well satellite", () => {
    expect(nodeKindLabel({ kind: "fracking_well", resourceItemId: "Desc_LiquidOil_C" })).toBe(
      "Well satellite",
    );
    // Nitrogen Gas has no seep equivalent, but the well itself still
    // gets the label — there's no ambiguity to resolve, just a fact
    // about the node worth stating.
    expect(nodeKindLabel({ kind: "fracking_well", resourceItemId: "Desc_NitrogenGas_C" })).toBe(
      "Well satellite",
    );
  });

  it("labels a Crude Oil miner node an oil seep", () => {
    expect(nodeKindLabel({ kind: "miner_node", resourceItemId: "Desc_LiquidOil_C" })).toBe(
      "Oil seep",
    );
  });

  it("returns null for ordinary miner nodes and geysers, where the resource name is already unambiguous", () => {
    expect(nodeKindLabel({ kind: "miner_node", resourceItemId: "Desc_OreIron_C" })).toBeNull();
    expect(nodeKindLabel({ kind: "geyser", resourceItemId: "Desc_Geyser_C" })).toBeNull();
  });
});
