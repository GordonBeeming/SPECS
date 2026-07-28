import { describe, expect, it } from "vitest";
import {
  factoryDistanceMeters,
  factoryPickerOptions,
  hasWorldPosition,
  pctToWorld,
  WORLD_BOUNDS,
  worldDistance,
  worldToPct,
} from "./transform";

describe("map transform", () => {
  it("maps the world's western edge to the image's left edge", () => {
    const { xPct, yPct } = worldToPct(WORLD_BOUNDS.xMin, WORLD_BOUNDS.yMin);
    expect(xPct).toBeCloseTo(0, 5);
    expect(yPct).toBeCloseTo(0, 5);
  });

  it("maps the world's eastern edge to the image's right edge", () => {
    const { xPct, yPct } = worldToPct(WORLD_BOUNDS.xMax, WORLD_BOUNDS.yMax);
    expect(xPct).toBeCloseTo(1, 5);
    expect(yPct).toBeCloseTo(1, 5);
  });

  it("renders SCIM's yMin (north) at the top of the image", () => {
    const north = worldToPct(0, WORLD_BOUNDS.yMin);
    const south = worldToPct(0, WORLD_BOUNDS.yMax);
    expect(north.yPct).toBeLessThan(south.yPct);
  });

  it("round-trips through pctToWorld", () => {
    const sample = [
      [12345, -67890],
      [-200000, 150000],
      [0, 0],
    ] as const;
    for (const [x, y] of sample) {
      const { xPct, yPct } = worldToPct(x, y);
      const back = pctToWorld(xPct, yPct);
      expect(back.worldX).toBeCloseTo(x, 1);
      expect(back.worldY).toBeCloseTo(y, 1);
    }
  });

  it("computes Euclidean distance between world points", () => {
    // 3-4-5 triangle scaled into world units.
    expect(worldDistance(0, 0, 30000, 40000)).toBeCloseTo(50000, 1);
  });

  it("treats the schema's (0, 0) default as unplaced", () => {
    expect(hasWorldPosition({ worldX: 0, worldY: 0 })).toBe(false);
    expect(hasWorldPosition({ worldX: 0, worldY: 12 })).toBe(true);
    expect(hasWorldPosition({ worldX: -5, worldY: 0 })).toBe(true);
  });

  it("derives factory distance in meters from a known coordinate pair", () => {
    // Same 3-4-5 triangle as above (world cm), offset off the origin so
    // neither point reads as the "unplaced" (0, 0) sentinel: 50,000 cm = 500 m.
    const a = { worldX: 10000, worldY: 10000 };
    const b = { worldX: 40000, worldY: 50000 };
    expect(factoryDistanceMeters(a, b)).toBeCloseTo(500, 1);
  });

  it("returns null distance when either factory hasn't been placed", () => {
    const unplaced = { worldX: 0, worldY: 0 };
    const placed = { worldX: 30000, worldY: 40000 };
    expect(factoryDistanceMeters(unplaced, placed)).toBeNull();
    expect(factoryDistanceMeters(placed, unplaced)).toBeNull();
  });

  describe("factoryPickerOptions", () => {
    it("sorts nearest-first and states the distance in the hint", () => {
      const options = factoryPickerOptions(
        { x: 0, y: 0 },
        [
          { id: "far", name: "Steel Mill", worldX: 30000, worldY: 40000 },
          { id: "near", name: "Iron Works", worldX: 300, worldY: 400 },
        ],
      );
      expect(options.map((o) => o.value)).toEqual(["near", "far"]);
      expect(options[0].hint).toBe("5 m");
      expect(options[1].hint).toBe("500 m");
    });

    it("carries the factory's icon through for the option row", () => {
      const options = factoryPickerOptions(
        { x: 0, y: 0 },
        [{ id: "f1", name: "Iron Works", iconId: "Build_SmelterMk1_C", worldX: 300, worldY: 400 }],
      );
      expect(options[0].iconId).toBe("Build_SmelterMk1_C");
    });

    it("sorts an unplaced factory after every measured one, with no distance hint", () => {
      // A resource node's own coords are always real (a node is never
      // "unplaced") — only the (0, 0) on the factory side should read
      // as the sentinel here, unlike `factoryDistanceMeters` which
      // guards both sides.
      const options = factoryPickerOptions(
        { x: 0, y: 0 },
        [
          { id: "unplaced", name: "Future Plant", worldX: 0, worldY: 0 },
          { id: "placed", name: "Iron Works", worldX: 300, worldY: 400 },
        ],
      );
      expect(options.map((o) => o.value)).toEqual(["placed", "unplaced"]);
      expect(options[0].hint).toBe("5 m");
      expect(options[1].hint).toBeUndefined();
    });
  });
});
