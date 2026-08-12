import { describe, expect, it } from "vitest";

import type { Item } from "@/features/library/types";
import type { ItemTier } from "./types";
import { buildTargetOptions } from "./options";

function item(id: string, name: string, category: Item["category"] = "part"): Item {
  return { id, name, category, stackSize: 100, isFluid: false };
}

const items: Item[] = [
  item("Desc_QuartzCrystal_C", "Quartz Crystal"),
  item("Desc_CircuitBoardHighSpeed_C", "AI Limiter"),
  item("Desc_AltOnly_C", "Alt-only Part"),
];

/** Quartz Crystal: standard route reachable at the same tier an alt
 * would reach it. AI Limiter: standard at T7, an alt lands it at T5.
 * Alt-only: no standard route at all. */
const tiers: ItemTier[] = [
  { itemId: "Desc_QuartzCrystal_C", tier: 5, standardTier: 5 },
  { itemId: "Desc_CircuitBoardHighSpeed_C", tier: 5, standardTier: 7 },
  { itemId: "Desc_AltOnly_C", tier: 5, standardTier: null },
];

function hintFor(itemId: string, currentTier: number | undefined): string | undefined {
  return buildTargetOptions(items, tiers, currentTier).find((o) => o.value === itemId)?.hint;
}

describe("buildTargetOptions — the needs-an-alt-recipe hint", () => {
  it("says nothing about alts once the standard recipe is in reach", () => {
    // The bug: at Tier 8, Quartz Crystal and Silica were badged as
    // needing an alt while their plain standard recipes selected fine,
    // which sent the run hunting for a problem that didn't exist.
    expect(hintFor("Desc_QuartzCrystal_C", 8)).toBeUndefined();
    // AI Limiter's standard route is Tier 7 — at Tier 8 that's reachable
    // too, so the alt stops being load-bearing.
    expect(hintFor("Desc_CircuitBoardHighSpeed_C", 8)).toBeUndefined();
  });

  it("badges an item that only gets here this early through an alt", () => {
    // At Tier 5 the AI Limiter chain is alt-only: the standard recipe
    // is two tiers away, and the alt still has to come off a Hard Drive.
    expect(hintFor("Desc_CircuitBoardHighSpeed_C", 5)).toBe("needs an alt recipe");
  });

  it("badges an item with no standard route at any tier", () => {
    expect(hintFor("Desc_AltOnly_C", 5)).toBe("needs an alt recipe");
    expect(hintFor("Desc_AltOnly_C", undefined)).toBe("needs an alt recipe");
  });

  it("leaves above-tier items reading as above tier, not as alt problems", () => {
    expect(hintFor("Desc_CircuitBoardHighSpeed_C", 4)).toBe("above your tier");
  });

  it("says nothing when there's no tier to compare a standard route against", () => {
    expect(hintFor("Desc_CircuitBoardHighSpeed_C", undefined)).toBeUndefined();
  });
});

describe("buildTargetOptions — what a factory can actually be pointed at", () => {
  const catalogue: Item[] = [
    item("Desc_IronPlate_C", "Iron Plate"),
    item("Desc_LiquidOil_C", "Crude Oil", "raw"),
    item("Desc_Water_C", "Water", "raw"),
    item("BP_ItemDescriptorPortableMiner_C", "Portable Miner", "equipment"),
    item("Desc_Biofuel_C", "Solid Biofuel"),
  ];
  const catalogueTiers: ItemTier[] = [
    { itemId: "Desc_IronPlate_C", tier: 0, standardTier: 0 },
    { itemId: "Desc_LiquidOil_C", tier: 5, standardTier: 5 },
    { itemId: "Desc_Water_C", tier: 3, standardTier: 3 },
    { itemId: "BP_ItemDescriptorPortableMiner_C", tier: 3, standardTier: null },
    // Hand-gathered all the way down: Biomass from Wood, and nothing
    // puts Wood on a belt.
    { itemId: "Desc_Biofuel_C", tier: null, standardTier: null, handGatheredTier: 2 },
  ];
  const values = buildTargetOptions(catalogue, catalogueTiers, 9).map((o) => o.value);

  it("offers a product a factory can be built around", () => {
    expect(values).toContain("Desc_IronPlate_C");
  });

  it("leaves out raw resources, which come off a node and not a machine", () => {
    expect(values).not.toContain("Desc_LiquidOil_C");
    expect(values).not.toContain("Desc_Water_C");
  });

  it("offers equipment a machine can actually build", () => {
    // The Portable Miner has an Assembler alt (Steel Pipe + Iron Plate,
    // T3), so a factory making them is ordinary play. What #115 asked
    // for was the raw blueprint id off the list, and the dataset now
    // carries a real name — dropping the whole category as well took a
    // legitimate product away with it.
    expect(values).toContain("BP_ItemDescriptorPortableMiner_C");
  });

  it("leaves out items only hand gathering reaches", () => {
    // Solid Biofuel is real and burnable, but a Constructor fed by a
    // player carrying Wood in isn't a factory anyone can plan.
    expect(values).not.toContain("Desc_Biofuel_C");
  });
});
