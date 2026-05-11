export type Purity = "Impure" | "Normal" | "Pure";
export type NodeKind = "miner_node" | "fracking_well" | "geyser";

export interface ResourceNodeClaim {
  miner_id?: string | null;
  clockPct: number;
  factoryId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

// camelCase passthrough of `ResourceNodeClaim` so the wire shape matches the
// rest of the slice. (`serde(rename_all = "camelCase")` on the Rust side
// turns `miner_id` → `minerId`.) Codegen-style alias to keep call sites
// readable.
export interface ResourceNodeClaimWire {
  minerId?: string | null;
  clockPct: number;
  factoryId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceNodeRow {
  id: string;
  resourceItemId: string;
  resourceItemName: string;
  purity: Purity;
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  coreId?: string | null;
  claim?: ResourceNodeClaimWire | null;
  itemsPerMinute: number;
}

export interface SetNodeClaimInput {
  nodeId: string;
  minerId?: string | null;
  clockPct: number;
  factoryId?: string | null;
  notes?: string | null;
}
