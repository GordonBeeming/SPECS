import { describe, expect, it } from "vitest";

import { floorClockPct } from "./clock";

describe("floorClockPct", () => {
  it("floors an exact whole number that arrives with float noise just under it", () => {
    // 60 / 1.2 in floating point lands a hair under 50, not exactly on
    // it — the epsilon exists so this still reads as the true 50, not 49.
    expect(floorClockPct(49.999999999999)).toBe(50);
  });

  it("does not round a genuinely sub-integer value up to the next integer", () => {
    // Regression: a 1e-4 epsilon nudged this over the line to 163,
    // handing back a clock that still overshoots the port and repeats
    // the same warning.
    expect(floorClockPct(162.99995)).toBe(162);
  });

  it("floors a plain fractional value normally", () => {
    expect(floorClockPct(162.5)).toBe(162);
  });

  it("passes an exact whole number through unchanged", () => {
    expect(floorClockPct(60)).toBe(60);
  });
});
