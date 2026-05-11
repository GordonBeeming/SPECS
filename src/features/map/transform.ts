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

/**
 * SCIM's tile pyramid bakes a fixed `extraBackgroundSize` padding on
 * each side at every zoom level — the playable world doesn't fill
 * the tiles; it sits in a centered inner rect. From their JS:
 *
 *     backgroundSize = 32768  // world pixels
 *     extraBackgroundSize = 4096  // padding each side
 *     // total raster = 32768 + 2×4096 = 40960
 *
 * So 4096 / 40960 = 0.1 of the image on each side is "outside the
 * world" padding, regardless of which zoom you stitched at. Bake
 * that into worldToPct so pixel offsets land on the right map
 * features.
 */
export const IMAGE_INSET_PCT = 4096 / 40960;

export function worldToPct(worldX: number, worldY: number): { xPct: number; yPct: number } {
  // SCIM puts north at yMin and south at yMax, so y is a straight
  // ratio with no flip. The IMAGE_INSET_PCT shifts pct=0 from the
  // image's left edge to where the world's western boundary lives,
  // and the (1 - 2×inset) factor compresses the world range into
  // the playable inner rect rather than the full image.
  const innerScale = 1 - 2 * IMAGE_INSET_PCT;
  const xWorldPct =
    (worldX - WORLD_BOUNDS.xMin) / (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin);
  const yWorldPct =
    (worldY - WORLD_BOUNDS.yMin) / (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin);
  return {
    xPct: IMAGE_INSET_PCT + xWorldPct * innerScale,
    yPct: IMAGE_INSET_PCT + yWorldPct * innerScale,
  };
}

export function pctToWorld(xPct: number, yPct: number): { worldX: number; worldY: number } {
  const innerScale = 1 - 2 * IMAGE_INSET_PCT;
  const xWorldPct = (xPct - IMAGE_INSET_PCT) / innerScale;
  const yWorldPct = (yPct - IMAGE_INSET_PCT) / innerScale;
  return {
    worldX: xWorldPct * (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin) + WORLD_BOUNDS.xMin,
    worldY: yWorldPct * (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin) + WORLD_BOUNDS.yMin,
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
