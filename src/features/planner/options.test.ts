import { describe, expect, it } from "vitest";

import type { Item } from "@/features/library/types";
import type { ItemTier } from "./types";
import { buildTargetOptions } from "./options";

function item(id: string, name: string): Item {
  return { id, name, category: "part", stackSize: 100, isFluid: false };
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
