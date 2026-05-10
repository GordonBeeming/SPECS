/**
 * Hand-mirrored from `src-tauri/src/features/logistics/dto.rs`. Phase 11/12
 * will replace these with `ts-rs`/`specta`-generated bindings; until then
 * any field added on the Rust side must be reflected here.
 */
export interface LogisticsLink {
  id: string;
  fromFactoryId: string;
  toFactoryId: string;
  itemId: string;
  itemsPerMinute: number;
  /** 'belt' | 'pipe' | 'truck' | 'tractor' | 'train' | 'drone' */
  transportKind: string;
  transportPlanJson: string;
  distanceM?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
