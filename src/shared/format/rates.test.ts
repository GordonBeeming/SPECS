import { describe, expect, it } from "vitest";

import { FLOW_EPS, isReportable, num, rate, REPORTABLE_IPM } from "./rates";

describe("rate formatting", () => {
  it("drops the trailing .0 on whole rates and keeps one decimal otherwise", () => {
    expect(rate(12)).toBe("12/min");
    expect(rate(2.5)).toBe("2.5/min");
    expect(num(12)).toBe("12");
    expect(num(2.5)).toBe("2.5");
  });

  it("never rounds a fractional rate to a whole number", () => {
    // A Motor line at 2.5/min displayed as 3 is a figure the player
    // can't build to, and a prefill taken off that string carries the
    // error into the plan.
    expect(rate(2.5)).not.toBe("3/min");
    expect(rate(0.6)).toBe("0.6/min");
  });

  it("prints one decimal for a unit other than /min through num", () => {
    // The water extractor editor renders m³/min off the same rule, so
    // the map and the plan graph can't disagree on how a rate looks.
    expect(`${num(487.5)} m³/min`).toBe("487.5 m³/min");
    expect(`${num(480)} m³/min`).toBe("480 m³/min");
  });
});

describe("the two thresholds", () => {
  it("keeps the arithmetic tolerance well under the reporting one", () => {
    // Confusing these is the failure mode the pair is named for: a gap
    // large enough to exist is not automatically large enough to put a
    // sentence on screen.
    expect(FLOW_EPS).toBeLessThan(REPORTABLE_IPM);
  });

  it("stays silent about a gap that would print as 0.0/min", () => {
    expect(isReportable(0.04)).toBe(false);
    // Which is the whole reason for the threshold: a gap this size has
    // no digits left to show, so a warning about it is a warning about
    // nothing.
    expect(rate(0.04)).toBe("0.0/min");
    expect(isReportable(0.5)).toBe(true);
  });
});
