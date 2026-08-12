import { describe, expect, it } from "vitest";

import type { Generator, Item } from "@/features/library/types";

import {
  eligibleGenerators,
  fuelFilterOptions,
  fuelNameOptions,
  generatorFilterOptions,
  isFuelAvailable,
} from "./fuelOptions";

const item = (id: string, name: string): Item => ({
  id,
  name,
  category: "raw",
  stackSize: 100,
  isFluid: false,
});

const itemsById = new Map<string, Item>([
  ["Desc_Coal_C", item("Desc_Coal_C", "Coal")],
  ["Desc_Water_C", item("Desc_Water_C", "Water")],
  ["Desc_NuclearFuelRod_C", item("Desc_NuclearFuelRod_C", "Uranium Fuel Rod")],
]);

const coalGenerator: Generator = {
  id: "Build_GeneratorCoal_C",
  name: "Coal Generator",
  category: "burner",
  powerMw: 75,
  unlockTier: 3,
  fuels: [{ fuelItemId: "Desc_Coal_C", fuelPerMinute: 15 }],
};

const nuclearPlant: Generator = {
  id: "Build_GeneratorNuclear_C",
  name: "Nuclear Power Plant",
  category: "nuclear",
  powerMw: 2500,
  unlockTier: 8,
  fuels: [
    {
      fuelItemId: "Desc_NuclearFuelRod_C",
      fuelPerMinute: 0.2,
      supplementalItemId: "Desc_Water_C",
      supplementalPerMinute: 240,
    },
  ],
};

const geothermal: Generator = {
  id: "Build_GeneratorGeoThermal_C",
  name: "Geothermal Generator",
  category: "geothermal",
  powerMw: 200,
  unlockTier: 5,
  fuels: [],
};

describe("eligibleGenerators", () => {
  it("keeps only what the playthrough's tier has unlocked", () => {
    expect(eligibleGenerators([coalGenerator, nuclearPlant, geothermal], 5)).toEqual([
      coalGenerator,
      geothermal,
    ]);
  });

  it("copes with the generator list still loading", () => {
    expect(eligibleGenerators(undefined, 9)).toEqual([]);
  });
});

describe("isFuelAvailable", () => {
  const tiers = new Map([
    ["Desc_Coal_C", 3],
    ["Desc_IonizedFuel_C", 8],
  ]);

  it("gates on the fuel's own obtainable tier", () => {
    expect(isFuelAvailable("Desc_Coal_C", tiers, 5)).toBe(true);
    expect(isFuelAvailable("Desc_IonizedFuel_C", tiers, 5)).toBe(false);
  });

  it("excludes a fuel nothing reaches", () => {
    expect(isFuelAvailable("Desc_Unreachable_C", tiers, 9)).toBe(false);
  });

  it("lets a hand-gathered fuel through at the tier it can be carried in", () => {
    // Wood has no producing recipe, so it only ever arrives via the
    // hand-gathered route `obtainableTierById` folds in. Reading the
    // automated tier alone leaves the Biomass Burner — the only Tier 0
    // generator — with nothing at all to burn.
    const handGathered = new Map([["Desc_Wood_C", 0]]);
    expect(isFuelAvailable("Desc_Wood_C", handGathered, 0)).toBe(true);
  });

  it("never drops the fuel already saved on the row being edited", () => {
    // Reassigning a choice the player already made, just because their
    // tier cap moved, would be an edit nobody asked for.
    expect(isFuelAvailable("Desc_IonizedFuel_C", tiers, 5, "Desc_IonizedFuel_C")).toBe(true);
  });
});

describe("fuelFilterOptions", () => {
  const tiers = new Map([
    ["Desc_Coal_C", 3],
    ["Desc_NuclearFuelRod_C", 8],
  ]);

  it("names the fuel and spells out its burn rate", () => {
    expect(fuelFilterOptions(coalGenerator, { itemsById, fuelTierById: tiers, tierCap: 5 })).toEqual([
      { value: "Desc_Coal_C", label: "Coal", hint: "15.00 /min", iconId: "Desc_Coal_C" },
    ]);
  });

  it("names the supplemental input, since that flow decides affordability", () => {
    const [option] = fuelFilterOptions(nuclearPlant, {
      itemsById,
      fuelTierById: tiers,
      tierCap: 9,
    });
    expect(option.hint).toBe("0.20 /min + 240 Water");
  });

  it("is empty for a generator that burns nothing", () => {
    expect(fuelFilterOptions(geothermal, { itemsById, fuelTierById: tiers, tierCap: 9 })).toEqual([]);
  });

  it("is empty when no generator is picked yet", () => {
    expect(fuelFilterOptions(undefined, { itemsById, fuelTierById: tiers, tierCap: 9 })).toEqual([]);
  });

  it("falls back to the raw id when the item catalog has no name for it", () => {
    const options = fuelFilterOptions(coalGenerator, {
      itemsById: new Map(),
      fuelTierById: tiers,
      tierCap: 5,
    });
    expect(options[0].label).toBe("Desc_Coal_C");
  });
});

describe("fuelNameOptions", () => {
  it("reshapes the same list for the plain select the edit modal uses", () => {
    expect(
      fuelNameOptions(coalGenerator, {
        itemsById,
        fuelTierById: new Map([["Desc_Coal_C", 3]]),
        tierCap: 5,
      }),
    ).toEqual([{ id: "Desc_Coal_C", name: "Coal" }]);
  });
});

describe("generatorFilterOptions", () => {
  it("tags each generator with its output and unlock tier", () => {
    expect(generatorFilterOptions([coalGenerator])).toEqual([
      {
        value: "Build_GeneratorCoal_C",
        label: "Coal Generator",
        hint: "75 MW · T3",
        iconId: "Build_GeneratorCoal_C",
      },
    ]);
  });
});
