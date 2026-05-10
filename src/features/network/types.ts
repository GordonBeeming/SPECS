/**
 * Frontend-only types for the network slice. The data feeding it is
 * synthesised from logistics + factories + items at render time, so
 * there's no Rust DTO to mirror.
 */

import type { TransportKind } from "@/features/logistics/types";

// React Flow's `Node`/`Edge` generics require the `data` to be assignable
// to `Record<string, unknown>`. The index signature is the conventional
// way to opt in without losing the named field types.
export interface FactoryNodeData extends Record<string, unknown> {
  factoryId: string;
  name: string;
  /** Net machine count, for the secondary line. */
  machineCount: number;
  /** True if any item flow on this factory is in deficit (consumed > produced + imports). */
  hasDeficit: boolean;
  /** True if this factory has any unbalanced surplus (produced > consumed + exports). */
  hasSurplus: boolean;
}

export interface LogisticsEdgeData extends Record<string, unknown> {
  linkId: string;
  itemId: string;
  itemName: string;
  isFluid: boolean;
  itemsPerMinute: number;
  transportKind: TransportKind;
  /** 0..1 — utilisation pulled from the persisted plan JSON. */
  utilisation: number;
  /** Hex colour to paint the edge with. */
  edgeColor: string;
}
