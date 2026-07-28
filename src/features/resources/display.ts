import type { Purity, ResourceNodeRow } from "./types";

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
 *
 * The index resets at 1 for each purity within a resource (Pure/Normal/
 * Impure each number their own nodes), so "Iron Ore #1" alone can name
 * either a Pure or a Normal node — the purity initial in front of the
 * number is what keeps the two apart when the label is read on its own,
 * without renumbering (and without touching the index math the Rust
 * side mirrors for `claimOverPortCapacity` findings).
 */
export function nodeDisplayLabel(
  node: Pick<ResourceNodeRow, "x" | "y" | "purity">,
  index: number,
): string {
  return `#${purityInitial(node.purity)}${index + 1} · ${coordChip(node.x, node.y)}`;
}

function purityInitial(purity: Purity): string {
  switch (purity) {
    case "Pure":
      return "P";
    case "Normal":
      return "N";
    case "Impure":
      return "I";
  }
}

/**
 * Satisfactory's purity multiplier — mirrors `NodePurity::multiplier()`
 * on the Rust side (`shared/gamedata/types.rs`). Every *saved* extractor
 * rate is meant to come from Rust over IPC (`extractor_output_ipm`), not
 * be recomputed here — this exists only for `previewExtractorIpm` below,
 * where there's no saved rate yet to read.
 */
function purityMultiplier(purity: Purity): number {
  switch (purity) {
    case "Impure":
      return 0.5;
    case "Normal":
      return 1;
    case "Pure":
      return 2;
  }
}

/**
 * Live preview of an extractor's output while the clock editor is open
 * and still unsaved — `base × purity × clock`, the same formula
 * `extractor_output_ipm` uses server-side to produce the row's own ipm
 * chip once a claim is saved. A claim mid-edit has no saved rate to
 * read yet, which is the one case where re-deriving this on the
 * TypeScript side is the right call rather than a drift risk: the
 * alternative is a round trip to the backend per keystroke/drag tick,
 * or no feedback at all until Save.
 *
 * Deliberately the *theoretical* rate, not belt-capped — the row
 * already has a separate "over port cap" flag for that, and a preview
 * that silently caps itself would hide the exact thing dragging the
 * clock is trying to avoid.
 */
export function previewExtractorIpm(baseIpm: number, purity: Purity, clockPct: number): number {
  if (!Number.isFinite(clockPct) || clockPct <= 0) return 0;
  return baseIpm * purityMultiplier(purity) * (clockPct / 100);
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
