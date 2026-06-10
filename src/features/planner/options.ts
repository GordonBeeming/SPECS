import type { FilterOption } from "@/shared/ui/FilterSelect";
import type { Item, Recipe } from "@/features/library/types";

/**
 * Tier-grouped item options for "what should this factory make?"
 * pickers. Only items with a non-alt recipe path are listed, grouped
 * by their earliest standard tier so late-game items don't bucket
 * under Tier 0 because of a Hard Drive alt. Extracted from the old
 * FactoryTargetPanel / PlannerView memos so every target picker
 * shares one rule.
 */
export function buildTargetOptions(
  items: Item[] | undefined,
  recipes: Recipe[] | undefined,
): FilterOption[] {
  if (!items || !recipes) return [];
  const standardTier = new Map<string, number>();
  const altTier = new Map<string, number>();
  for (const r of recipes) {
    if (r.id.startsWith("Recipe_Unpackage")) continue;
    const bucket = r.isAlt ? altTier : standardTier;
    for (const o of r.outputs) {
      const cur = bucket.get(o.itemId);
      if (cur === undefined || r.unlockTier < cur) {
        bucket.set(o.itemId, r.unlockTier);
      }
    }
  }
  const effectiveTier = (itemId: string): number | undefined =>
    standardTier.get(itemId) ?? altTier.get(itemId);
  const eligible = items.filter(
    (i) => i.category !== "raw" && effectiveTier(i.id) !== undefined,
  );
  eligible.sort((a, b) => {
    const at = effectiveTier(a.id) ?? 99;
    const bt = effectiveTier(b.id) ?? 99;
    return at === bt ? a.name.localeCompare(b.name) : at - bt;
  });
  return eligible.map((i) => ({
    value: i.id,
    label: i.name,
    iconId: i.id,
    group: `Tier ${effectiveTier(i.id) ?? "?"}`,
  }));
}

/**
 * Recipes a swap picker may offer per output item: standard recipes
 * plus unlocked alts, with inverse Unpackage_* recipes filtered the
 * same way the Rust planner filters them.
 */
export function buildRecipesByOutput(
  recipes: Recipe[] | undefined,
  unlockedAlts: Set<string> | undefined,
): Map<string, Recipe[]> {
  const byOutput = new Map<string, Recipe[]>();
  for (const r of recipes ?? []) {
    if (r.id.startsWith("Recipe_Unpackage")) continue;
    if (r.isAlt && unlockedAlts && !unlockedAlts.has(r.id)) continue;
    for (const o of r.outputs) {
      const arr = byOutput.get(o.itemId) ?? [];
      arr.push(r);
      byOutput.set(o.itemId, arr);
    }
  }
  return byOutput;
}
