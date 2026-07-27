import type { FilterOption } from "@/shared/ui/FilterSelect";
import type { Item, Recipe } from "@/features/library/types";
import type { ItemTier } from "./types";

/**
 * Tier-grouped item options for "what should this factory make?"
 * pickers.
 *
 * Tiers come from the Rust side (`list_item_tiers`), which walks the
 * whole input chain. Deriving them here from `recipe.unlockTier` is
 * what filed AI Limiter under Tier 7 while the planner would happily
 * build it at Tier 5, and — worse — said nothing about a product being
 * out of reach: a recipe's own stamp doesn't know whether its
 * ingredients exist yet.
 *
 * Above-tier products stay pickable. Planning the endgame backwards is
 * supported, and the plan carries an above-tier warning of its own once
 * it computes; the group header and hint are so the choice is an
 * informed one.
 */
export function buildTargetOptions(
  items: Item[] | undefined,
  itemTiers: ItemTier[] | undefined,
  currentTier: number | undefined,
): FilterOption[] {
  if (!items || !itemTiers) return [];
  const tiers = new Map(itemTiers.map((t) => [t.itemId, t]));
  const eligible = items.filter((i) => i.category !== "raw" && tiers.has(i.id));
  const tierOf = (itemId: string): number => tiers.get(itemId)?.tier ?? 99;
  eligible.sort((a, b) => {
    const at = tierOf(a.id);
    const bt = tierOf(b.id);
    return at === bt ? a.name.localeCompare(b.name) : at - bt;
  });
  return eligible.map((i) => {
    const entry = tiers.get(i.id);
    const tier = entry?.tier ?? null;
    const aboveTier = tier !== null && currentTier !== undefined && tier > currentTier;
    const standardTier = entry?.standardTier ?? null;
    // The alt is only load-bearing when the standard route is out of
    // reach *at the tier you're on*. An item whose standard recipe
    // works right now doesn't need an alt just because some alt would
    // also have reached it earlier — badging those sends you hunting
    // for a problem that isn't there, and pulls attention off the ones
    // that are. With no tier to compare against, only an alt-only item
    // (no standard route at all) qualifies.
    const needsAlt =
      tier !== null &&
      !aboveTier &&
      (standardTier === null || (currentTier !== undefined && standardTier > currentTier));
    return {
      value: i.id,
      label: i.name,
      iconId: i.id,
      group: tier === null ? "Tier ?" : aboveTier ? `Tier ${tier} — not unlocked yet` : `Tier ${tier}`,
      hint: aboveTier ? "above your tier" : needsAlt ? "needs an alt recipe" : undefined,
    };
  });
}

/**
 * Recipes a swap picker may offer per output item: standard recipes
 * plus every alt at or below the playthrough's current tier — collected
 * or not, matching the Rust planner's tier gate. Inverse Unpackage_*
 * recipes filtered the same way the planner filters them. The picker
 * badges uncollected alts separately; availability here is about tier,
 * not hard drives.
 */
export function buildRecipesByOutput(
  recipes: Recipe[] | undefined,
  currentTier: number | undefined,
): Map<string, Recipe[]> {
  const byOutput = new Map<string, Recipe[]>();
  for (const r of recipes ?? []) {
    if (r.id.startsWith("Recipe_Unpackage")) continue;
    // Tier still loading → keep alts visible rather than flashing a
    // standard-only list for a frame.
    if (r.isAlt && currentTier !== undefined && r.unlockTier > currentTier) continue;
    for (const o of r.outputs) {
      const arr = byOutput.get(o.itemId) ?? [];
      arr.push(r);
      byOutput.set(o.itemId, arr);
    }
  }
  return byOutput;
}
