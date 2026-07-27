/** One decimal, and no trailing `.0` on whole numbers. */
export function rate(n: number): string {
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}/min`;
}

/**
 * The smallest gap the designer will talk about, matching
 * `REPORTABLE_IPM` on the Rust side. Rates render to one decimal, so
 * anything under half of that prints as "0.0/min" — a shortfall of
 * 0.0/min on a plan that balances is a warning about nothing, and it
 * costs the reader a trip to go and check. Flow arithmetic keeps its
 * own tighter tolerance; this is the reporting threshold only.
 */
export const REPORTABLE_IPM = 0.05;

/** Is this rate big enough to be worth a sentence? */
export function isReportable(ipm: number): boolean {
  return ipm > REPORTABLE_IPM;
}
