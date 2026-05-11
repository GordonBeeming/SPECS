import { describe, expect, it } from "vitest";
import { pctToWorld, WORLD_BOUNDS, worldDistance, worldToPct } from "./transform";

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
});
