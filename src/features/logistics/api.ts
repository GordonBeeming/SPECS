/**
 * Phase 5 wires the actual `invoke()` calls here once the Rust commands
 * land. Keeping the export shape stable from day one means the React side
 * can grow against `logisticsApi.*` without touching this import path.
 */
export const logisticsApi = {};
