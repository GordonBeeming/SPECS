/**
 * Phase 5 wires the actual `invoke()` calls here once the Rust commands
 * land. The export exists so callers can import from `./api` from day one
 * without churning the import path; the surface is intentionally empty
 * until the Rust commands ship in subsequent commits.
 */
export const logisticsApi = {};
