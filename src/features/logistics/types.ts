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

export interface CreateLogisticsLinkInput {
  fromFactoryId: string;
  toFactoryId: string;
  itemId: string;
  itemsPerMinute: number;
  transportKind: TransportKind;
  /** JSON-serialised TransportPlan the user picked from the planner output. */
  transportPlanJson: string;
  distanceM?: number;
  notes?: string;
}

export interface UpdateLogisticsLinkInput {
  id: string;
  itemsPerMinute: number;
  transportKind: TransportKind;
  transportPlanJson: string;
  distanceM?: number;
  notes?: string;
}

/**
 * Two pieces of context the React side might be tempted to send —
 * `isFluid` and `unlockedTier` — are deliberately *not* on this struct.
 * The Rust planner derives them from the bundled game data (`item.is_fluid`)
 * and the active playthrough's `progress.current_tier`. Trusting client-
 * supplied values would let a stale UI request belts for a fluid or see
 * high-tier plans as unlocked at tier 0.
 */
export interface PlanInput {
  itemId: string;
  itemsPerMinute: number;
  /** Optional distance hint for vehicle/train/drone plans (Phase 5b). */
  distanceM?: number;
}

export interface TransportSegment {
  mark: number;
  count: number;
  /** Capacity of a single unit at this mark (ipm for belts, m³/min for pipes). */
  perUnitCapacity: number;
  unlockTier: number;
}

export interface TransportPlan {
  kind: TransportKind;
  segments: TransportSegment[];
  totalCapacityPerMinute: number;
  /** 0..100 — capped so over-provisioning shows as "100% capacity used". */
  utilisationPct: number;
  minUnlockTier: number;
  /** True if any segment's unlock tier is above the playthrough's tier. */
  locked: boolean;
  /** Vehicle plans only — id of the picked vehicle (Build_Truck_C, …). */
  vehicleId?: string;
  /** Drone plans only — batteries/min the player needs to supply at the launchpad. */
  batteryPerMinute?: number;
}
