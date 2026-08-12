import type { ItemTier } from "./types";

/**
 * Earliest tier the player can have the item at all — an automated
 * chain if there is one, otherwise whatever they can carry in by hand.
 *
 * This is the question a fuel picker asks. The Biomass Burner exists to
 * be hand-fed Wood at Tier 0, so gating its fuels on `tier` alone (an
 * automated route no burner fuel has) leaves the only Tier 0 generator
 * with nothing to burn. A *product* picker asks the other question and
 * wants `tier` on its own.
 *
 * `null` when neither route reaches the item.
 */
export function obtainableTier(entry: ItemTier): number | null {
  return entry.handGatheredTier ?? entry.tier;
}

/**
 * Item id → obtainable tier, for the items that have one. An id absent
 * from the map is unreachable, and callers gate on the absence rather
 * than substituting a number for it: a stand-in "99" reads as a real
 * tier at every comparison it flows into.
 */
export function obtainableTierById(tiers: ItemTier[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of tiers ?? []) {
    const tier = obtainableTier(entry);
    if (tier !== null) map.set(entry.itemId, tier);
  }
  return map;
}
