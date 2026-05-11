/**
 * In-game world coordinates → bundled map image coordinates.
 *
 * Bounds taken verbatim from SCIM's leaflet config (their bundle
 * exposes `mappingBoundWest/East/North/South`); since
 * `scripts/fetch-map.ts` stitches SCIM's own tile pyramid for the
 * map image, the bundled WebP and these bounds are aligned to a
 * fraction of a pixel.
 *
 * Don't tweak these in isolation — they belong with the tile image
 * the script produces. Change one and you have to change the other.
 */
export const WORLD_BOUNDS = {
  xMin: -324698.832031,
  xMax: 425301.832031,
  yMin: -375000,
  yMax: 375000,
} as const;

export function worldToPct(worldX: number, worldY: number): { xPct: number; yPct: number } {
  // SCIM's bounds put north at yMin (-375k) and south at yMax (+375k),
  // so the y mapping is a straight ratio — no flip — because the
  // image's top (yPct 0) lines up with the world's smallest y.
  const xPct =
    (worldX - WORLD_BOUNDS.xMin) / (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin);
  const yPct =
    (worldY - WORLD_BOUNDS.yMin) / (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin);
  return { xPct, yPct };
}

export function pctToWorld(xPct: number, yPct: number): { worldX: number; worldY: number } {
  return {
    worldX: xPct * (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin) + WORLD_BOUNDS.xMin,
    worldY: yPct * (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin) + WORLD_BOUNDS.yMin,
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
