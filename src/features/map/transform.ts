import type { FilterOption } from "@/shared/ui/FilterSelect";

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
 * `scripts/fetch-map.ts` crops SCIM's tile-pyramid output to the
 * inner 80% rect (the playable world without SCIM's surrounding
 * `extraBackgroundSize` padding), so the bundled image and the
 * world bounds line up 1:1 — no inset needed in the math.
 */
export function worldToPct(worldX: number, worldY: number): { xPct: number; yPct: number } {
  return {
    xPct: (worldX - WORLD_BOUNDS.xMin) / (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin),
    yPct: (worldY - WORLD_BOUNDS.yMin) / (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin),
  };
}

export function pctToWorld(xPct: number, yPct: number): { worldX: number; worldY: number } {
  return {
    worldX: xPct * (WORLD_BOUNDS.xMax - WORLD_BOUNDS.xMin) + WORLD_BOUNDS.xMin,
    worldY: yPct * (WORLD_BOUNDS.yMax - WORLD_BOUNDS.yMin) + WORLD_BOUNDS.yMin,
  };
}

/** Straight-line distance in in-game units (cm) between two world points. */
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

/**
 * A factory that has never been dragged onto the map keeps the schema's
 * `(0, 0)` default position, which is also a legitimate spot inside the
 * world bounds — there's no way to tell "not placed yet" from "placed at
 * the origin" except by this convention. Anything deriving distance from
 * a factory's coords needs the guard, or an unplaced factory silently
 * produces a plausible-looking distance to nowhere.
 */
export function hasWorldPosition(point: { worldX: number; worldY: number }): boolean {
  return point.worldX !== 0 || point.worldY !== 0;
}

/**
 * Straight-line distance in meters between two factories' map positions,
 * or `null` when either hasn't been placed yet (see `hasWorldPosition`).
 * World coords are stored in cm (see `coordChip`'s km conversion) — divide
 * by 100 to land on meters, the unit vehicle/train/drone plans consume.
 */
export function factoryDistanceMeters(
  a: { worldX: number; worldY: number },
  b: { worldX: number; worldY: number },
): number | null {
  if (!hasWorldPosition(a) || !hasWorldPosition(b)) return null;
  return worldDistance(a.worldX, a.worldY, b.worldX, b.worldY) / 100;
}

/** A factory as far as the node/water-group→factory picker cares:
 * identity, its icon (falls back to the picker's default glyph when
 * unset), and the position `factoryDistanceMeters` needs. */
export interface FactoryPickerCandidate {
  id: string;
  name: string;
  iconId?: string;
  worldX: number;
  worldY: number;
}

/**
 * Combobox options for "which factory does this claim feed" — name,
 * icon and straight-line distance from the claim's coords, nearest
 * first. A native `<select>` can only show the name; this is the one
 * model both the map's node card and the Resources row editor use, so
 * the two pickers can't drift out of sync with each other.
 */
export function factoryPickerOptions(
  point: { x: number; y: number },
  factories: FactoryPickerCandidate[],
): FilterOption[] {
  const withDistance = factories.map((factory) => ({
    factory,
    // Unlike two factories, `point` (a claimed node, or a water group's
    // drop spot) is always a real in-game coordinate — it's never the
    // "hasn't been placed yet" case `hasWorldPosition` guards against,
    // so that guard only applies to the factory side here. Reusing
    // `factoryDistanceMeters`, which checks both sides, would wrongly
    // report every distance as unmeasurable for a node that happens to
    // sit exactly at world (0, 0).
    distanceM: hasWorldPosition(factory)
      ? worldDistance(point.x, point.y, factory.worldX, factory.worldY) / 100
      : null,
  }));
  // Unplaced factories (no distance) sort after every measured one —
  // "1,200 m away" is still something to act on; "unknown" isn't a
  // fair fight against it.
  withDistance.sort((a, b) => {
    if (a.distanceM == null && b.distanceM == null) {
      return a.factory.name.localeCompare(b.factory.name);
    }
    if (a.distanceM == null) return 1;
    if (b.distanceM == null) return -1;
    return a.distanceM - b.distanceM;
  });
  return withDistance.map(({ factory, distanceM }) => ({
    value: factory.id,
    label: factory.name,
    iconId: factory.iconId,
    hint: distanceM != null ? `${Math.round(distanceM).toLocaleString()} m` : undefined,
  }));
}
