import { describe, expect, it } from "vitest";

import type { FactoryLedger, ItemFlow } from "@/features/factory/types";
import type { Recipe } from "@/features/library/types";

import { rawRequirements, shortfallsByItem } from "./shortfalls";

const IRON_ORE = "Desc_OreIron_C";
const IRON_INGOT = "Desc_IronIngot_C";
const COPPER_ORE = "Desc_OreCopper_C";

const extracted = new Set([IRON_ORE, COPPER_ORE]);

const recipes: Recipe[] = [
  {
    id: "Recipe_IngotIron_C",
    name: "Iron Ingot",
    buildingId: "Build_SmelterMk1_C",
    isAlt: false,
    unlockTier: 0,
    cycleSeconds: 2,
    inputs: [{ itemId: IRON_ORE, perMinute: 30 }],
    outputs: [{ itemId: IRON_INGOT, perMinute: 30 }],
  },
];

function flow(partial: Partial<ItemFlow> & { itemId: string }): ItemFlow {
  return {
    itemName: partial.itemId,
    isFluid: false,
    producedPerMinute: 0,
    consumedPerMinute: 0,
    netPerMinute: 0,
    ...partial,
  };
}

function ledger(factoryId: string, flows: ItemFlow[]): FactoryLedger {
  return { factoryId, flows, powerMw: 0 };
}

describe("rawRequirements", () => {
  it("rolls an intermediate's deficit back to the ore it comes out of", () => {
    const req = rawRequirements(
      ledger("iron-works", [flow({ itemId: IRON_INGOT, netPerMinute: -30 })]),
      recipes,
      extracted,
    );

    expect(req).toEqual([{ itemId: IRON_ORE, required: 30, bound: 0, missing: 30 }]);
  });

  it("burns the requirement down as bound nodes contribute", () => {
    const req = rawRequirements(
      ledger("iron-works", [
        flow({ itemId: IRON_INGOT, netPerMinute: -30 }),
        flow({ itemId: IRON_ORE, fromNodesPerMinute: 12 }),
      ]),
      recipes,
      extracted,
    );

    // Gross demand survives the subtraction so the card can print
    // "12 of 30 bound" rather than a lone "18 missing".
    expect(req).toEqual([{ itemId: IRON_ORE, required: 30, bound: 12, missing: 18 }]);
  });

  it("treats a deficit covered by an incoming link as supplied, not as ore missing", () => {
    const req = rawRequirements(
      ledger("plates", [
        flow({ itemId: IRON_INGOT, netPerMinute: -30, fromLinksPerMinute: 30 }),
      ]),
      recipes,
      extracted,
    );

    expect(req).toEqual([]);
  });
});

describe("shortfallsByItem", () => {
  const ironShort = {
    factoryId: "iron-works",
    requirements: [{ itemId: IRON_ORE, required: 300, bound: 19, missing: 281 }],
  };
  const ironCovered = {
    factoryId: "steel-works",
    requirements: [{ itemId: IRON_ORE, required: 120, bound: 120, missing: 0 }],
  };
  const copperShort = {
    factoryId: "copper-works",
    requirements: [{ itemId: COPPER_ORE, required: 60, bound: 0, missing: 60 }],
  };

  it("indexes each resource by the factories still short of it", () => {
    const byItem = shortfallsByItem([ironShort, ironCovered, copperShort]);

    expect([...(byItem.get(IRON_ORE) ?? [])]).toEqual(["iron-works"]);
    expect([...(byItem.get(COPPER_ORE) ?? [])]).toEqual(["copper-works"]);
  });

  it("leaves out a factory whose bound nodes already cover the requirement", () => {
    // The boundary that matters: a fully-covered factory has to be
    // absent, not present with a zero — the claim popup ranks on
    // membership alone.
    const byItem = shortfallsByItem([ironCovered]);

    expect(byItem.has(IRON_ORE)).toBe(false);
  });

  it("has no entry for a resource nobody needs", () => {
    const byItem = shortfallsByItem([copperShort]);

    expect(byItem.get(IRON_ORE)).toBeUndefined();
  });
});
