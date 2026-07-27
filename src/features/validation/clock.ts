/**
 * The advised clock in a `claimOverPortCapacity` finding is a ceiling on
 * what the port can carry — anything above it overshoots, so the
 * percent shown must floor, not round. Naively rounding a `.5` ratio
 * (e.g. 162.5%) up to 163% hands back a clock that still exceeds the
 * port and repeats the identical warning. The tiny epsilon absorbs
 * float noise that could otherwise land an exact whole number (e.g.
 * 50.0) just under it.
 *
 * Shared between the Validate panel and the Resources row inline flag —
 * both render the same finding's advice text.
 */
export function floorClockPct(pct: number): number {
  return Math.floor(pct + 1e-4);
}
