/**
 * Mirror of `src-tauri/src/features/playthrough/dto.rs`.
 */

export interface PlaythroughSummary {
  id: string;
  displayName: string;
  createdAt: string;
  lastOpenedAt: string | null;
  schemaVersion: number;
}

export interface PlaythroughDetail {
  id: string;
  displayName: string;
  gameVersion: string;
  createdAt: string;
  currentTier: number;
  currentMilestoneProgress: number;
}

export interface CreatePlaythroughInput {
  displayName: string;
  startingTier: number;
}

/**
 * Per-playthrough amplifier inventory the player chose to track.
 * Zeroed by default — the UI suppresses low-supply warnings when both
 * fields are zero (interpreted as "don't bug me about supply").
 */
export interface AmplifierInventory {
  somersloopQuantity: number;
  powerShardQuantity: number;
}

export interface SetAmplifierInventoryInput {
  somersloopQuantity: number;
  powerShardQuantity: number;
}
