/**
 * The one place a per-minute rate becomes a string, and the two
 * tolerances that decide whether a rate is worth comparing or worth
 * mentioning.
 *
 * Shared rather than slice-local because the plan graph, the map's
 * water extractor editor and the factory panels all print rates on
 * screens the user reads side by side — an inline `toFixed(1)` renders
 * `12.0/min` next to this helper's `12/min` for the same flow.
 */

/**
 * One decimal, and no trailing `.0` on whole numbers — the number half
 * of a rate, without the unit.
 *
 * Never round a rate to a whole number. Satisfactory ratios are
 * genuinely fractional: a Motor line at 2.5/min displayed as 3 is a
 * figure the player can't build to, and prefilling it from that string
 * carries the error into the plan.
 */
export function num(n: number): string {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

/** A per-minute rate: `12/min`, `2.5/min`. */
export function rate(n: number): string {
  return `${num(n)}/min`;
}

/**
 * The smallest gap the designer will talk about, matching
 * `REPORTABLE_IPM` on the Rust side. Rates render to one decimal, so
 * anything under half of that prints as "0.0/min" — a shortfall of
 * 0.0/min on a plan that balances is a warning about nothing, and it
 * costs the reader a trip to go and check.
 */
export const REPORTABLE_IPM = 0.05;

/** Is this rate big enough to be worth a sentence? */
export function isReportable(ipm: number): boolean {
  return ipm > REPORTABLE_IPM;
}

/**
 * The smallest ipm difference that counts as a difference, matching
 * `FLOW_EPS_IPM` on the Rust side.
 *
 * Distinct from `REPORTABLE_IPM` and twenty times tighter: this decides
 * whether a gap *exists*, the other decides whether it's worth a
 * sentence. Rates arrive as f32 sums round-tripped through IPC, so a
 * factory that balances exactly lands a hair either side of zero and
 * every comparison needs a floor under it.
 */
export const FLOW_EPS = 1e-3;
