/**
 * The advised clock in a `claimOverPortCapacity` finding is a ceiling on
 * what the port can carry — anything above it overshoots, so the
 * percent shown must floor, not round. Naively rounding a `.5` ratio
 * (e.g. 162.5%) up to 163% hands back a clock that still exceeds the
 * port and repeats the identical warning.
 *
 * The epsilon absorbs float noise that could otherwise land an exact
 * whole number (e.g. 50.0 arriving as 49.999999999999) just under it —
 * but it has to stay small. `1e-4` was large enough to nudge a real
 * sub-integer value (162.99995) over the line and floor it *up* to 163,
 * reintroducing the exact "follow the advice, get the same warning
 * again" loop this helper exists to prevent. `1e-9` still catches the
 * float-noise case without touching a value that's genuinely below the
 * next integer.
 *
 * Shared between the Validate panel and the Resources row inline flag —
 * both render the same finding's advice text.
 */
export function floorClockPct(pct: number): number {
  return Math.floor(pct + 1e-9);
}
