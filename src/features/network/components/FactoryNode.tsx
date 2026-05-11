import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, ArrowDownCircle, ExternalLink } from "lucide-react";

import { useNavStore } from "@/shared/nav-store";

import type { FactoryNodeData } from "../types";

/**
 * Compact factory card. Two badges:
 *  - red ⚠ for deficit (this factory consumes more of some item than it
 *    produces + imports).
 *  - amber ↓ for surplus (this factory produces more than it consumes +
 *    exports — fine, but the player may want to ship the surplus).
 *
 * Both badges are derived from `compose_ledger` cross-referenced with
 * the factory's outgoing/incoming logistics_links — see `NetworkView`
 * for the assembly.
 */
export function FactoryNode({ data }: NodeProps & { data: FactoryNodeData }) {
  return (
    <div className="rounded-lg border border-border bg-bg-raised px-3 py-2 shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-primary" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-sm font-semibold text-fg"
            title={data.name}
          >
            {data.name}
          </div>
          <div className="mt-0.5 text-xs text-fg-muted tabular-nums">
            {data.machineCount} {data.machineCount === 1 ? "machine" : "machines"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {data.hasDeficit && (
            <span
              role="status"
              aria-label="Some inputs are in deficit"
              title="Some inputs are in deficit"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-danger/15 text-danger"
            >
              <AlertTriangle className="h-3 w-3" />
            </span>
          )}
          {data.hasSurplus && (
            <span
              role="status"
              aria-label="Surplus outputs not shipped anywhere"
              title="Surplus outputs not shipped anywhere"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning/15 text-warning"
            >
              <ArrowDownCircle className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </div>
  );
}
