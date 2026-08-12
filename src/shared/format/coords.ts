/**
 * World positions are stored in Unreal `cm` — what the bundled catalog
 * and the game's own saves use. Nothing user-facing prints or accepts
 * that unit: the map, the resource rows and Validate all speak
 * "1.9km W · 1.2km N", so the conversion lives here once rather than as
 * a `/ 100000` scattered across the slices that need it.
 */
export const WORLD_UNITS_PER_KM = 100_000;

/** SCIM's axis convention, which the bundled node catalog follows:
 * +x runs east, +y runs south. Getting this backwards silently mirrors
 * every position, so both directions of the conversion read it from
 * here. */
export type EastWest = "E" | "W";
export type NorthSouth = "N" | "S";

/** A world position as the player reads it: two unsigned distances in
 * kilometres, each with the compass direction it runs in. */
export interface CompassCoord {
  ewKm: number;
  ew: EastWest;
  nsKm: number;
  ns: NorthSouth;
}

/**
 * Round world coords to a `1.9km W · 1.2km N` chip. Compass suffixes
 * save the player from having to remember which axis is which.
 */
export function coordChip(x: number, y: number): string {
  const c = worldToCompass(x, y);
  return `${c.ewKm.toFixed(1)}km ${c.ew} · ${c.nsKm.toFixed(1)}km ${c.ns}`;
}

/** World cm → the km + compass pair the rest of the app prints. */
export function worldToCompass(x: number, y: number): CompassCoord {
  return {
    ewKm: Math.abs(x) / WORLD_UNITS_PER_KM,
    ew: x >= 0 ? "E" : "W",
    nsKm: Math.abs(y) / WORLD_UNITS_PER_KM,
    ns: y >= 0 ? "S" : "N",
  };
}

/**
 * The inverse of {@link worldToCompass}, for the position fields on the
 * new-factory dialog. Distances are taken as magnitudes so a stray
 * minus sign in a "1.9 km West" field can't flip the factory to the
 * east — the direction is the select's job, and only its job.
 */
export function compassToWorld(coord: CompassCoord): { x: number; y: number } {
  return {
    x: Math.abs(coord.ewKm) * WORLD_UNITS_PER_KM * (coord.ew === "E" ? 1 : -1),
    y: Math.abs(coord.nsKm) * WORLD_UNITS_PER_KM * (coord.ns === "S" ? 1 : -1),
  };
}
