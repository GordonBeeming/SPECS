import { describe, expect, it } from "vitest";
import { deriveItemUnlockTiers } from "./tiers";
import type { Recipe } from "./types";

function recipe(overrides: Partial<Recipe> & Pick<Recipe, "id" | "outputs">): Recipe {
  return {
    name: overrides.id,
    buildingId: "Build_Smelter_C",
    isAlt: false,
    unlockTier: 0,
    cycleSeconds: 1,
    inputs: [],
    ...overrides,
  };
}

describe("deriveItemUnlockTiers", () => {
  it("leaves a raw resource with no producing recipe out of the map — callers default it to Tier 0", () => {
    const tiers = deriveItemUnlockTiers([]);
    expect(tiers.has("Desc_OreIron_C")).toBe(false);
  });

  it("takes a standard item's tier from its earliest producing recipe", () => {
    const tiers = deriveItemUnlockTiers([
      recipe({
        id: "Recipe_IngotIron_C",
        unlockTier: 0,
        outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 30 }],
      }),
      // A later, less-common recipe for the same output must not push
      // the tier up — the earliest one wins.
      recipe({
        id: "Recipe_Alloy_IronIngot_C",
        unlockTier: 5,
        outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 50 }],
      }),
    ]);
    expect(tiers.get("Desc_IronIngot_C")).toBe(0);
  });

  it("ignores alt recipes so an alt can't pull an item's tier earlier than its real milestone", () => {
    const tiers = deriveItemUnlockTiers([
      recipe({
        id: "Recipe_Alternate_PureIronIngot_C",
        isAlt: true,
        unlockTier: 1,
        outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 65 }],
      }),
      recipe({
        id: "Recipe_IngotIron_C",
        unlockTier: 3,
        outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 30 }],
      }),
    ]);
    expect(tiers.get("Desc_IronIngot_C")).toBe(3);
  });

  it("ignores Unpackage recipes so unpacking a fluid doesn't understate its tier", () => {
    // Packaged Water can be unpackaged back to Water at Tier 0 packaging,
    // but Water itself (the fluid) is available from Tier 0 anyway — use
    // a later fluid to make the case unambiguous: if the Unpackage
    // recipe were counted, Nitrogen Gas would wrongly read as available
    // as early as packaging is.
    const tiers = deriveItemUnlockTiers([
      recipe({
        id: "Recipe_UnpackageNitrogenGas_C",
        unlockTier: 0,
        outputs: [{ itemId: "Desc_NitrogenGas_C", perMinute: 60 }],
      }),
      recipe({
        id: "Recipe_NitrogenGas_C",
        unlockTier: 6,
        outputs: [{ itemId: "Desc_NitrogenGas_C", perMinute: 120 }],
      }),
    ]);
    expect(tiers.get("Desc_NitrogenGas_C")).toBe(6);
  });
});
