import { describe, expect, it } from "vitest";

import { traceRawDemand } from "./traceRaw";
import type { Recipe } from "@/features/library/types";

function recipe(
  id: string,
  outputs: Array<[string, number]>,
  inputs: Array<[string, number]>,
  isAlt = false,
): Recipe {
  return {
    id,
    name: id,
    buildingId: "Build_ConstructorMk1_C",
    isAlt,
    unlockTier: 0,
    cycleSeconds: 4,
    inputs: inputs.map(([itemId, perMinute]) => ({ itemId, perMinute })),
    outputs: outputs.map(([itemId, perMinute]) => ({ itemId, perMinute })),
  };
}

// Iron Plate ← Iron Ingot ← Iron Ore, at the dataset's real ratios.
const chain: Recipe[] = [
  recipe("Recipe_IronPlate_C", [["Desc_IronPlate_C", 20]], [["Desc_IronIngot_C", 30]]),
  recipe("Recipe_IronIngot_C", [["Desc_IronIngot_C", 30]], [["Desc_OreIron_C", 30]]),
];

describe("traceRawDemand", () => {
  it("walks a chain down to the extracted resource it grounds out on", () => {
    const raw = traceRawDemand(
      [{ itemId: "Desc_IronPlate_C", ratePerMin: 20 }],
      chain,
      new Set(["Desc_OreIron_C"]),
    );
    expect(raw).toEqual({ Desc_OreIron_C: 30 });
  });

  it("keeps walking past an id missing from the extracted set", () => {
    // The regression this guards: the set used to be a second
    // hand-written copy of the planner's, so an id present on one side
    // and not the other changed where the walk stopped with nothing
    // erroring. Drop Iron Ore from the set and the trace runs past it,
    // looking for a recipe that makes ore and reporting the ore as a
    // terminal only because none exists. The number happens to survive
    // here; on a resource that IS a recipe byproduct — Water, Crude
    // Oil — it would not.
    const withOre = traceRawDemand(
      [{ itemId: "Desc_IronIngot_C", ratePerMin: 30 }],
      [
        ...chain,
        // A refinery-style recipe that emits ore as a byproduct is
        // enough to make the walk take a different route.
        recipe("Recipe_OreFromSlag_C", [["Desc_OreIron_C", 60]], [["Desc_Stone_C", 120]]),
      ],
      new Set(["Desc_OreIron_C", "Desc_Stone_C"]),
    );
    expect(withOre).toEqual({ Desc_OreIron_C: 30 });

    const withoutOre = traceRawDemand(
      [{ itemId: "Desc_IronIngot_C", ratePerMin: 30 }],
      [
        ...chain,
        recipe("Recipe_OreFromSlag_C", [["Desc_OreIron_C", 60]], [["Desc_Stone_C", 120]]),
      ],
      new Set(["Desc_Stone_C"]),
    );
    // 30 ore now resolves through the byproduct recipe into 60 stone,
    // and the factory's raw readout no longer mentions ore at all.
    expect(withoutOre).toEqual({ Desc_Stone_C: 60 });
  });

  it("sums demand for a raw reached down two separate branches", () => {
    const raw = traceRawDemand(
      [
        { itemId: "Desc_IronPlate_C", ratePerMin: 20 },
        { itemId: "Desc_IronIngot_C", ratePerMin: 30 },
      ],
      chain,
      new Set(["Desc_OreIron_C"]),
    );
    expect(raw).toEqual({ Desc_OreIron_C: 60 });
  });

  it("treats an item with no known recipe as terminal so its demand still surfaces", () => {
    const raw = traceRawDemand(
      [{ itemId: "Desc_Mystery_C", ratePerMin: 12 }],
      chain,
      new Set(["Desc_OreIron_C"]),
    );
    expect(raw).toEqual({ Desc_Mystery_C: 12 });
  });
});
