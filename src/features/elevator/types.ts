/**
 * Mirror of `src-tauri/src/features/elevator/dto.rs`. Until ts-rs/specta
 * generates these, any field added on the Rust side must be reflected here.
 */

export interface ElevatorOverview {
  phases: ElevatorPhase[];
}

export interface ElevatorPhase {
  phase: number;
  name: string;
  /** HUB tiers this phase's delivery unlocks (empty for the final launch). */
  unlocksTiers: number[];
  parts: ElevatorPartProgress[];
}

export interface ElevatorPartProgress {
  itemId: string;
  itemName: string;
  /** Total units the phase requires delivered to the elevator. */
  requiredQuantity: number;
  /** Sum of `producedPerMinute` across every factory making this part. */
  totalProducedPerMinute: number;
  /** The factories producing this part, busiest first. */
  producers: ElevatorProducer[];
}

export interface ElevatorProducer {
  factoryId: string;
  factoryName: string;
  producedPerMinute: number;
  /** Consumed by other recipes inside this same factory. */
  consumedInternallyPerMinute: number;
  /** Sent onward to other factories via logistics links. */
  syncedOutPerMinute: number;
  /** `produced − consumedInternally − syncedOut`. Negative = over-committed. */
  availablePerMinute: number;
}
