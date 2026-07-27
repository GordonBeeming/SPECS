import type { Recipe } from "./types";

/**
 * Derive each item's unlock tier from the earliest standard recipe that
 * produces it — items don't carry a tier of their own in the dataset.
 * Alt recipes are skipped (an alt shouldn't pull an item's "real" tier
 * earlier than the milestone that actually introduces it), and so are
 * `Recipe_Unpackage*` recipes: unpackaging a fluid into its packaged
 * form exists at whatever tier packaging itself unlocks, not the tier
 * of the fluid it unpacks, so counting it here would understate items
 * that are otherwise fluid-only for many tiers (e.g. Packaged Water).
 *
 * A raw resource has no producing recipe, so it gets no entry at all
 * rather than a zero — callers decide what an absent item means, and
 * today they all treat it as Tier 0.
 */
export function deriveItemUnlockTiers(recipes: Recipe[]): Map<string, number> {
  const tierByItem = new Map<string, number>();
  for (const r of recipes) {
    if (r.isAlt) continue;
    if (r.id.startsWith("Recipe_Unpackage")) continue;
    for (const o of r.outputs) {
      const cur = tierByItem.get(o.itemId);
      if (cur === undefined || r.unlockTier < cur) {
        tierByItem.set(o.itemId, r.unlockTier);
      }
    }
  }
  return tierByItem;
}
