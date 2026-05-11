/**
 * Client-side mirror of Rust's amp slot + power-shard rules so the
 * machine form can validate inputs before round-tripping. The
 * authoritative checks still live in
 * `src-tauri/src/features/factory/commands.rs`; this exists so the
 * UI surfaces failures inline.
 */

const FOUR_SLOT_BUILDINGS = new Set([
  "Build_ManufacturerMk1_C",
  "Build_Blender_C",
  "Build_HadronCollider_C",
  "Build_QuantumEncoder_C",
]);

export function ampSlotsForBuilding(buildingId: string): number {
  return FOUR_SLOT_BUILDINGS.has(buildingId) ? 4 : 1;
}

export function clockCapForShards(shards: number): number {
  // Mirrors `validate_clock_against_shards` — 0 shards keeps the
  // machine at the base 100%, each additional shard unlocks 50%.
  switch (shards) {
    case 0:
      return 100;
    case 1:
      return 150;
    case 2:
      return 200;
    case 3:
      return 250;
    default:
      return 100;
  }
}
