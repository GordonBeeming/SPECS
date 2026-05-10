/**
 * Edge styling derived from the persisted plan JSON. We avoid hard-coding
 * brand colour values here — the network canvas reads from CSS variables
 * so light/dark themes get the right contrast automatically.
 */

import type { TransportKind } from "@/features/logistics/types";

/** CSS variable names per transport kind (defined in `brand.css`). */
const KIND_COLOR_VAR: Record<TransportKind, string> = {
  belt: "--color-belt-mk3", // mid-tier belt as the default belt edge colour
  pipe: "--color-pipe-mk1",
  truck: "--color-transport-truck",
  tractor: "--color-transport-truck",
  train: "--color-transport-train",
  drone: "--color-transport-drone",
};

/** Resolves the CSS variable to a usable colour string for SVG `stroke`. */
export function colourForKind(kind: TransportKind): string {
  return `var(${KIND_COLOR_VAR[kind]})`;
}

/**
 * Maps utilisation (0..1) to stroke width. A near-empty link draws thin;
 * a near-capacity link draws thick. Caps at 6px so the canvas doesn't
 * lose readable spacing when one link is wildly over-provisioned.
 */
export function strokeWidthForUtilisation(util: number): number {
  if (!Number.isFinite(util) || util <= 0) return 1.5;
  const clamped = Math.min(1, util);
  return 1.5 + clamped * 4.5; // 1.5 → 6.0
}

/**
 * Parses the planner-serialised plan JSON to recover utilisation. Returns
 * 0 if the JSON is malformed (the slice's repo doesn't store malformed
 * JSON, but old rows from before validation existed might).
 */
export function utilisationFromPlanJson(json: string): number {
  try {
    const parsed = JSON.parse(json);
    const v = Number(parsed?.utilisationPct);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v)) / 100;
  } catch {
    return 0;
  }
}
