/**
 * In-game world coordinates → bundled map image coordinates.
 *
 * Satisfactory's world is roughly 750 km × 750 km in Unreal units
 * (~1 cm per unit). The bundled `satisfactory-map.webp` was produced
 * from the community high-res map; its bounds aren't perfectly
 * documented anywhere, so the constants below come from empirical
 * alignment against the SCIM node catalog (node coords range from
 * roughly (-282k, -314k) to (406k, 302k)). If pins drift, tweak
 * these — the math is unit-agnostic and a small offset / scale
 * change is enough to re-align without touching the renderer.
 */
export const WORLD_BOUNDS = {
  xMin: -324698,
  xMax: 425302,
  yMin: -375000,
  yMax: 375000,
} as const;

export function worldToPct(worldX: number, worldY: number): { xPct: number; yPct: number } {
  const xPct =
    (worldX - WORLD_BOUNDS.xMin) / (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin);
  // In-game +y is North; map +y is South — flip so North is up.
  const yPct =
    (WORLD_BOUNDS.yMax - worldY) / (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin);
  return { xPct, yPct };
}

export function pctToWorld(xPct: number, yPct: number): { worldX: number; worldY: number } {
  return {
    worldX: xPct * (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin) + WORLD_BOUNDS.xMin,
    worldY: WORLD_BOUNDS.yMax - yPct * (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin),
  };
}

/** Straight-line distance in in-game units between two world points. */
export function worldDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
