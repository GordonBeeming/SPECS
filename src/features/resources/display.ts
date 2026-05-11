import type { ResourceNodeRow } from "./types";

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
  // on kilometres for human-readable distances.
  const km = (v: number) => (v / 100000).toFixed(1);
  const ew = x >= 0 ? "E" : "W";
  const ns = y >= 0 ? "N" : "S"; // world +y is in-game North
  return `${km(Math.abs(x))}km ${ew} · ${km(Math.abs(y))}km ${ns}`;
}
