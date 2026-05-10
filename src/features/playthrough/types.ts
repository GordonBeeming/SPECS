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
