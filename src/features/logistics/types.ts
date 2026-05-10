/**
 * Hand-mirrored from `src-tauri/src/features/logistics/dto.rs`. Phase 11/12
 * will replace these with `ts-rs`/`specta`-generated bindings; until then
 * any field added on the Rust side must be reflected here.
 */

/**
 * The six transport kinds the SQL CHECK constraint and the Rust slice both
 * enforce. Kept as a literal union so a typo on the React side is a
 * compile-time error rather than a runtime SQL rejection.
 */
export type TransportKind =
  | "belt"
  | "pipe"
  | "truck"
  | "tractor"
  | "train"
  | "drone";

export interface LogisticsLink {
  id: string;
  fromFactoryId: string;
  toFactoryId: string;
  itemId: string;
  itemsPerMinute: number;
  transportKind: TransportKind;
  transportPlanJson: string;
  distanceM?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
