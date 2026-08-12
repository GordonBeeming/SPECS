import { describe, expect, it } from "vitest";

import type { ItemTier } from "./types";
import { obtainableTier, obtainableTierById } from "./itemTiers";

describe("obtainableTier", () => {
  it("takes the hand-gathered route when it's the only one", () => {
    // Wood off a tree: nothing extracts it, nothing makes it, and the
    // Biomass Burner burns it from Tier 0.
    const wood: ItemTier = {
      itemId: "Desc_Wood_C",
      tier: null,
      standardTier: null,
      handGatheredTier: 0,
    };
    expect(obtainableTier(wood)).toBe(0);
  });

  it("falls back to the automated tier when hand gathering buys nothing", () => {
    const fuel: ItemTier = { itemId: "Desc_LiquidFuel_C", tier: 5, standardTier: 5 };
    expect(obtainableTier(fuel)).toBe(5);
  });

  it("stays null for an item no route reaches", () => {
    const stranded: ItemTier = { itemId: "Desc_Nope_C", tier: null, standardTier: null };
    expect(obtainableTier(stranded)).toBeNull();
  });
});

describe("obtainableTierById", () => {
  it("leaves an unreachable item out rather than giving it a stand-in tier", () => {
    const map = obtainableTierById([
      { itemId: "Desc_Wood_C", tier: null, standardTier: null, handGatheredTier: 0 },
      { itemId: "Desc_LiquidFuel_C", tier: 5, standardTier: 5 },
      { itemId: "Desc_Nope_C", tier: null, standardTier: null },
    ]);
    expect(map.get("Desc_Wood_C")).toBe(0);
    expect(map.get("Desc_LiquidFuel_C")).toBe(5);
    expect(map.has("Desc_Nope_C")).toBe(false);
  });

  it("is empty while the tier query is still loading", () => {
    expect(obtainableTierById(undefined).size).toBe(0);
  });
});
