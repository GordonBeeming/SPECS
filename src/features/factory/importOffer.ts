/**
 * What the graph's one-click "import instead" has to do before the
 * import carries anything.
 *
 * The offer is sized on the producer's machine-side spare, but an
 * uncapped source resolves to the producer's *export slice* (see
 * `effective_external_cap` in `src-tauri/src/features/planner/domain.rs`).
 * A factory making 20/min with no slice open offers 0/min, so adding the
 * row on its own leaves the local line building 100% of the demand and
 * the screen unchanged — and a logistics link the exporter never agreed
 * to, which Validate reports as "exports cover 0.0".
 *
 * So the click is two halves: open the producer's slice wide enough for
 * what's being claimed, then add the source. Kept out of the component
 * because which half is needed is a decision with four cases, and every
 * one of them is a bug the user reads as "clicking did nothing".
 */

import type { ExistingProducerSource } from "@/features/planner/types";
import { FLOW_EPS } from "@/shared/format/rates";

export interface ImportFromProducerPlan {
  /** How much of the local demand this source will take on. */
  claimIpm: number;
  /**
   * The export slice to ask the producer for, or `null` when no raise
   * is needed (or possible). `null` means "add the source and nothing
   * else" — the source already offers enough, or it's an intermediate
   * whose surplus is capacity without any slice.
   */
  raiseIpm: number | null;
}

/**
 * Decide what taking `source` up on its offer costs, given the rate the
 * local line currently builds.
 *
 * The claim never exceeds the spare the offer advertised: growing
 * another factory's machines is a decision with its own map, power and
 * ore cost, and a button reading "N/min spare — import instead" never
 * promised it. Where the spare falls short of the demand the local line
 * keeps the remainder, which is what the elastic self row is for.
 */
export function planImportFromProducer(
  source: ExistingProducerSource,
  localIpm: number,
): ImportFromProducerPlan {
  const claimIpm = Math.max(0, Math.min(localIpm, source.spareIpm));
  if (!source.hasTarget) {
    // An intermediate: no target to raise, and its surplus already
    // counts as capacity, so the uncapped row resolves on its own.
    return { claimIpm, raiseIpm: null };
  }
  if (claimIpm <= FLOW_EPS) {
    // Nothing left to take — the offer went stale between the solve
    // that produced it and the click. Adding the row still says what
    // the user meant; the Sources panel is where they'd fix the rest.
    return { claimIpm, raiseIpm: null };
  }
  if (source.remainingIpm >= claimIpm - FLOW_EPS) {
    return { claimIpm, raiseIpm: null };
  }
  return { claimIpm, raiseIpm: claimIpm };
}
