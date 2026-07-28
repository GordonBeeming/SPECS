import { afterEach, describe, expect, it } from "vitest";
import {
  clampLoadoutMinerId,
  DEFAULT_LOADOUT,
  readLoadout,
  writeLoadout,
  type MapLoadout,
} from "./PlacementLoadout";
import type { ExtractorOption } from "@/features/resources/types";

function mark(id: string, unlockTier: number): ExtractorOption {
  return { id, name: `Miner ${id}`, baseIpm: 0, unlockTier };
}

// Ascending by unlockTier, same shape `list_resource_nodes` returns.
const T0_ONLY: ExtractorOption[] = [mark("Build_MinerMk1_C", 0)];
const T0_T4: ExtractorOption[] = [mark("Build_MinerMk1_C", 0), mark("Build_MinerMk2_C", 4)];

describe("clampLoadoutMinerId", () => {
  it("leaves the loadout untouched while options haven't loaded yet", () => {
    const loadout: MapLoadout = { ...DEFAULT_LOADOUT, minerId: "Build_MinerMk2_C" };
    expect(clampLoadoutMinerId(loadout, [])).toBe(loadout);
  });

  it("leaves an already-eligible selection untouched", () => {
    const loadout: MapLoadout = { ...DEFAULT_LOADOUT, minerId: "Build_MinerMk1_C" };
    expect(clampLoadoutMinerId(loadout, T0_T4)).toBe(loadout);
  });

  it("downgrades a stale above-tier mark to the best eligible one", () => {
    // The exact bug behind #57: a Mk2 preference persisted from a
    // higher-tier playthrough (or an earlier bug) must not carry over
    // as the default at a Tier 0 restart.
    const loadout: MapLoadout = { ...DEFAULT_LOADOUT, minerId: "Build_MinerMk2_C" };
    const clamped = clampLoadoutMinerId(loadout, T0_ONLY);
    expect(clamped.minerId).toBe("Build_MinerMk1_C");
  });

  it("picks the highest eligible mark, not just the lowest", () => {
    const loadout: MapLoadout = { ...DEFAULT_LOADOUT, minerId: "Build_MinerMk3_C" };
    const clamped = clampLoadoutMinerId(loadout, T0_T4);
    expect(clamped.minerId).toBe("Build_MinerMk2_C");
  });
});

describe("readLoadout / writeLoadout — scoped per playthrough (#64)", () => {
  afterEach(() => localStorage.clear());

  it("doesn't bleed a mark saved under one playthrough into another", () => {
    // The exact bug #64 fixes: a Mk.2 preference from a later-tier
    // playthrough used to sit in one global key and be read straight
    // back by a brand-new Tier 0 one.
    writeLoadout({ ...DEFAULT_LOADOUT, minerId: "Build_MinerMk2_C" }, "playthrough-a");
    expect(readLoadout("playthrough-b").minerId).toBe(DEFAULT_LOADOUT.minerId);
    expect(readLoadout("playthrough-a").minerId).toBe("Build_MinerMk2_C");
  });

  it("keeps working unscoped for callers that haven't threaded a playthrough id through yet", () => {
    // ResourcesView's quick-claim reads the loadout without a
    // playthrough id — must not throw or silently discard the save.
    writeLoadout({ ...DEFAULT_LOADOUT, minerId: "Build_MinerMk3_C" });
    expect(readLoadout().minerId).toBe("Build_MinerMk3_C");
  });
});
