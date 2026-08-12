import type { FilterOption } from "@/shared/ui/FilterSelect";
import type { Item, Recipe } from "@/features/library/types";
import type { ItemTier } from "./types";

/** The one category no factory produces: a miner's output. Equipment
 * deliberately isn't here — the Portable Miner has an Assembler alt,
 * and a factory built around it is ordinary mid-game play. */
const UNPRODUCIBLE_CATEGORIES: ReadonlySet<string> = new Set(["raw"]);

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
 *
 * What isn't pickable is anything a factory can't produce: raw
 * resources (a miner's job, and the planner rejects them as targets)
 * and items whose only route to the player is hand gathering.
 * `tier === null` is exactly that second group — Wood, Biomass, Solid
 * Biofuel, and everything else no belt ever carries.
 */
export function buildTargetOptions(
  items: Item[] | undefined,
  itemTiers: ItemTier[] | undefined,
  currentTier: number | undefined,
): FilterOption[] {
  if (!items || !itemTiers) return [];
  const tiers = new Map(itemTiers.map((t) => [t.itemId, t]));

  const producible: { item: Item; tier: number; standardTier: number | null }[] = [];
  for (const item of items) {
    if (UNPRODUCIBLE_CATEGORIES.has(item.category)) continue;
    const entry = tiers.get(item.id);
    if (!entry || entry.tier === null) continue;
    producible.push({ item, tier: entry.tier, standardTier: entry.standardTier });
  }
  producible.sort((a, b) =>
    a.tier === b.tier ? a.item.name.localeCompare(b.item.name) : a.tier - b.tier,
  );

  return producible.map(({ item, tier, standardTier }) => {
    const aboveTier = currentTier !== undefined && tier > currentTier;
    // The alt is only load-bearing when the standard route is out of
    // reach *at the tier you're on*. An item whose standard recipe
    // works right now doesn't need an alt just because some alt would
    // also have reached it earlier — badging those sends you hunting
    // for a problem that isn't there, and pulls attention off the ones
    // that are. With no tier to compare against, only an alt-only item
    // (no standard route at all) qualifies.
    const needsAlt =
      !aboveTier &&
      (standardTier === null || (currentTier !== undefined && standardTier > currentTier));
    return {
      value: item.id,
      label: item.name,
      iconId: item.id,
      group: aboveTier ? `Tier ${tier} — not unlocked yet` : `Tier ${tier}`,
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
