import type { ExtractorOption, ResourceNodeRow } from "./types";

/**
 * The extractor a fresh claim should default to: the caller's preferred
 * building when the node accepts it (the map placement loadout), else
 * the node's first allowed extractor (Mk1 for ore, the only choice for
 * oil/wells), else `null` for geysers.
 */
export function claimDefaultExtractor(
  node: Pick<ResourceNodeRow, "allowedExtractors">,
  preferredId?: string | null,
): string | null {
  // The type guarantees the field, but rows can arrive from a cache
  // populated before this field existed — guard the array itself.
  const allowed = node.allowedExtractors ?? [];
  if (allowed.length === 0) return null;
  if (preferredId && allowed.some((e) => e.id === preferredId)) return preferredId;
  return allowed[0].id;
}

/**
 * Extractor option label for pickers — same shape as the generator
 * picker's "Biomass Burner — 30 MW · T0" hint, so a Miner Mk2 reads
 * "Miner Mk.2 · T4" instead of leaving the tier invisible.
 */
export function extractorOptionLabel(option: Pick<ExtractorOption, "name" | "unlockTier">): string {
  return `${option.name} · T${option.unlockTier}`;
}

/**
 * Human-friendly label for a resource node. The bundled catalog ids
 * (e.g. `BP_ResourceNode114`) are unique-stable but mean nothing to a
 * player; show a sequential index within the node's (resource, purity)
 * bucket plus a coarse coordinate hint instead. The raw id stays on
 * the row's `title` so we can still trace which entry the user is
 * pointing at.
 */
export function nodeDisplayLabel(node: ResourceNodeRow, index: number): string {
  return `#${index + 1} · ${coordChip(node.x, node.y)}`;
}

/**
 * The one thing a bare resource name/purity can't tell apart: a Crude
 * Oil well satellite (`fracking_well`, a single Resource Well Extractor
 * option) versus an oil seep (`miner_node`, the Oil Extractor) — both
 * read "Crude Oil · Pure" otherwise, and the well's extractor is
 * usually still tier-locked when the seep's isn't. Returns `null` for
 * every other node kind, where the resource name alone is unambiguous.
 */
export function nodeKindLabel(
  node: Pick<ResourceNodeRow, "kind" | "resourceItemId">,
): string | null {
  if (node.kind === "fracking_well") return "Well satellite";
  if (node.kind === "miner_node" && node.resourceItemId === "Desc_LiquidOil_C") return "Oil seep";
  return null;
}

/**
 * Round world coords (Unreal `cm`) to a `(x km, y km)` chip. Compass
 * suffixes (E/W, N/S) save the player from having to remember which
 * axis is which.
 */
export function coordChip(x: number, y: number): string {
  // Unreal world coords are stored in cm — divide by 100,000 to land
  // on kilometres for human-readable distances. SCIM's convention
  // puts +x = east, +y = south (north is the smaller y).
  const km = (v: number) => (v / 100000).toFixed(1);
  const ew = x >= 0 ? "E" : "W";
  const ns = y >= 0 ? "S" : "N";
  return `${km(Math.abs(x))}km ${ew} · ${km(Math.abs(y))}km ${ns}`;
}
