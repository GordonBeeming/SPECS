import { describe, expect, it } from "vitest";

import type { ExistingProducerSource } from "@/features/planner/types";

import { planImportFromProducer } from "./importOffer";

const source = (over: Partial<ExistingProducerSource> = {}): ExistingProducerSource => ({
  factoryId: "fac-iron-works",
  factoryName: "Iron Works",
  spareIpm: 5,
  remainingIpm: 5,
  hasTarget: true,
  ...over,
});

describe("planImportFromProducer", () => {
  it("opens the producer's slice when it makes the item but exports none of it", () => {
    // The state the offer is most often in: 5/min of machine-side spare
    // and no export slice. An uncapped row resolves to the slice, so
    // adding it alone pulls 0/min and nothing on screen moves.
    expect(planImportFromProducer(source({ remainingIpm: 0 }), 5)).toEqual({
      claimIpm: 5,
      raiseIpm: 5,
    });
  });

  it("adds the source alone when the producer already exports enough", () => {
    expect(planImportFromProducer(source(), 5)).toEqual({ claimIpm: 5, raiseIpm: null });
  });

  it("tops the slice up to the claim when it's open but too narrow", () => {
    expect(planImportFromProducer(source({ spareIpm: 20, remainingIpm: 3 }), 12)).toEqual({
      claimIpm: 12,
      raiseIpm: 12,
    });
  });

  it("claims no more than the spare the offer advertised", () => {
    // Growing the producer's machines is a decision with its own map,
    // power and ore cost — "5/min spare, import instead" never offered
    // it, so a 40/min local line takes the 5 and keeps building 35.
    expect(planImportFromProducer(source({ remainingIpm: 0 }), 40)).toEqual({
      claimIpm: 5,
      raiseIpm: 5,
    });
  });

  it("claims no more than the local line was building", () => {
    expect(planImportFromProducer(source({ spareIpm: 90, remainingIpm: 90 }), 12)).toEqual({
      claimIpm: 12,
      raiseIpm: null,
    });
  });

  it("leaves an intermediate alone — its surplus is capacity already", () => {
    // No target means no export slice to open and nothing to raise;
    // `gather_export_capacity` sizes these off the surplus directly.
    expect(
      planImportFromProducer(source({ hasTarget: false, remainingIpm: 0 }), 5),
    ).toEqual({ claimIpm: 5, raiseIpm: null });
  });

  it("doesn't ask for a raise when the offer went stale to nothing", () => {
    // A raise of 0 is rejected server-side; the row still records what
    // the user meant, and the Sources panel is where they'd chase it.
    expect(planImportFromProducer(source({ spareIpm: 0, remainingIpm: 0 }), 5)).toEqual({
      claimIpm: 0,
      raiseIpm: null,
    });
  });
});
