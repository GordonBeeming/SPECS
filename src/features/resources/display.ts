import type { ResourceNodeRow } from "./types";

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
