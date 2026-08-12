import { describe, expect, it } from "vitest";

import { compassToWorld, coordChip, worldToCompass } from "./coords";

describe("coordChip", () => {
  it("labels a north-west position with its compass directions", () => {
    // SCIM's convention is +x = east, +y = south, so both negatives
    // read as west and north.
    expect(coordChip(-250000, -130000)).toBe("2.5km W · 1.3km N");
  });

  it("labels a south-east position with its compass directions", () => {
    expect(coordChip(250000, 130000)).toBe("2.5km E · 1.3km S");
  });

  it("puts the origin at 0 rather than dropping the suffixes", () => {
    expect(coordChip(0, 0)).toBe("0.0km E · 0.0km S");
  });
});

describe("compassToWorld", () => {
  it("is the inverse of the reading the map prints", () => {
    const world = compassToWorld({ ewKm: 1.9, ew: "W", nsKm: 1.2, ns: "N" });
    expect(world).toEqual({ x: -190000, y: -120000 });
    expect(coordChip(world.x, world.y)).toBe("1.9km W · 1.2km N");
  });

  it("takes the distance as a magnitude so a stray minus can't flip the direction", () => {
    // The select owns the direction; a "-2" typed into a "km West" box
    // must not silently place the factory in the east.
    expect(compassToWorld({ ewKm: -2, ew: "W", nsKm: -1, ns: "S" })).toEqual({
      x: -200000,
      y: 100000,
    });
  });
});

describe("worldToCompass", () => {
  it("round-trips a position back through compassToWorld", () => {
    const original = { x: -190000, y: 120000 };
    expect(compassToWorld(worldToCompass(original.x, original.y))).toEqual(original);
  });
});
