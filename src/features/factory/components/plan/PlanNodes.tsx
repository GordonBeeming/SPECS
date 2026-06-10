import { Handle, Position } from "@xyflow/react";
import { CircleAlert, Hammer, PackageOpen, Plus, Trash2, TriangleAlert } from "lucide-react";

import { Icon } from "@/shared/ui/Icon";
import { FilterSelect, type FilterOption } from "@/shared/ui/FilterSelect";
import type { PlanNode } from "@/features/planner/types";

export const PLAN_NODE_WIDTH = 250;

/** Per-kind height estimates for dagre — xyflow measures the real DOM,
 * but dagre needs numbers up front. Imports grow with source rows. */
export function planNodeHeight(node: PlanNode): number {
  switch (node.kind) {
    case "recipe":
      return 132;
    case "import":
      return 96 + node.allocations.length * 44 + (node.unassignedIpm > 0 ? 28 : 0);
    case "raw":
      return 76;
    case "byproduct":
      return 64;
  }
}

function rate(n: number): string {
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}/min`;
}

/** Invisible-but-functional connection points; the graph is read-only
 * wiring-wise, so the handles only anchor edges. */
function FlowHandles({ left = true, right = true }: { left?: boolean; right?: boolean }) {
  return (
    <>
      {left && (
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-border" isConnectable={false} />
      )}
      {right && (
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-border" isConnectable={false} />
      )}
    </>
  );
}

// ---- Step (recipe) ----

export interface RecipeStepNodeProps {
  node: Extract<PlanNode, { kind: "recipe" }>;
  recipeOptions: FilterOption[];
  onSwapRecipe: (itemId: string, recipeId: string) => void;
  onSupplyFromElsewhere: (itemId: string) => void;
}

export function RecipeStepNodeCard({
  node,
  recipeOptions,
  onSwapRecipe,
  onSupplyFromElsewhere,
}: RecipeStepNodeProps) {
  return (
    <div
      className={`rounded-md border bg-bg-raised p-3 text-xs shadow-sm ${
        node.isTarget ? "border-primary" : "border-border"
      }`}
      style={{ width: PLAN_NODE_WIDTH }}
    >
      <FlowHandles />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon itemId={node.itemId} alt="" className="h-6 w-6 shrink-0" />
          <span className="truncate font-medium text-fg">{node.itemName}</span>
        </div>
        {node.isTarget && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">
            Target
          </span>
        )}
      </div>
      <div className="mt-1 tabular-nums text-fg-muted">
        {node.machineCount}× {node.buildingName} @ {node.clockPct.toFixed(0)}% ·{" "}
        {node.powerMw.toFixed(1)} MW
      </div>
      <div className="mt-1 tabular-nums font-semibold text-fg">{rate(node.outputIpm)}</div>
      {recipeOptions.length > 1 && (
        <div className="nodrag mt-2">
          <FilterSelect
            compact
            ariaLabel={`Recipe for ${node.itemName}`}
            options={recipeOptions}
            value={node.recipeId}
            clearable={false}
            onChange={(next) => {
              if (next && next !== node.recipeId) onSwapRecipe(node.itemId, next);
            }}
          />
        </div>
      )}
      {!node.isTarget && (
        <button
          type="button"
          onClick={() => onSupplyFromElsewhere(node.itemId)}
          className="nodrag mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-fg"
        >
          <PackageOpen className="h-3 w-3" />
          Supply from elsewhere
        </button>
      )}
    </div>
  );
}

// ---- Input (import) ----

export interface ImportNodeProps {
  node: Extract<PlanNode, { kind: "import" }>;
  factoryOptions: FilterOption[];
  /** Current specs for this item, in declared order. */
  sources: Array<{ sourceFactoryId: string | null; ipmCap: number | null }>;
  factoryNames: Map<string, string>;
  onSetSource: (itemId: string, index: number, factoryId: string | null) => void;
  onSetCap: (itemId: string, index: number, cap: number | null) => void;
  onAddSource: (itemId: string) => void;
  onRemoveSource: (itemId: string, index: number) => void;
  onBuildHere: (itemId: string) => void;
}

export function ImportNodeCard({
  node,
  factoryOptions,
  sources,
  onSetSource,
  onSetCap,
  onAddSource,
  onRemoveSource,
  onBuildHere,
}: ImportNodeProps) {
  return (
    <div
      className="rounded-md border border-accent/60 bg-bg-raised p-3 text-xs shadow-sm"
      style={{ width: PLAN_NODE_WIDTH }}
    >
      {/* Inputs sit at the graph's left edge — only a source handle. */}
      <FlowHandles left={false} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon itemId={node.itemId} alt="" className="h-6 w-6 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{node.itemName}</div>
            <div className="text-[10px] uppercase tracking-wide text-fg-muted">Input</div>
          </div>
        </div>
        <span className="tabular-nums font-semibold text-fg">{rate(node.ipm)}</span>
      </div>

      {node.unassignedIpm > 0 && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-warning/15 px-2 py-1 text-[11px] text-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" />
          Unsourced · {rate(node.unassignedIpm)} — a future factory will supply this
        </div>
      )}

      <div className="nodrag mt-2 flex flex-col gap-1.5">
        {sources.map((src, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <FilterSelect
                compact
                ariaLabel={`Source factory for ${node.itemName}`}
                options={factoryOptions}
                value={src.sourceFactoryId}
                placeholder="Pick a source factory…"
                onChange={(next) => onSetSource(node.itemId, idx, next)}
              />
            </div>
            <input
              type="number"
              min={1}
              value={src.ipmCap ?? ""}
              placeholder="cap"
              aria-label={`Cap for source ${idx + 1}`}
              onChange={(e) => {
                const v = e.target.value === "" ? null : Number(e.target.value);
                onSetCap(node.itemId, idx, v !== null && Number.isFinite(v) && v > 0 ? v : null);
              }}
              className="h-9 w-16 rounded-md border border-border bg-bg px-2 tabular-nums text-fg outline-none focus:border-primary"
            />
            {sources.length > 1 && (
              <button
                type="button"
                aria-label="Remove source"
                onClick={() => onRemoveSource(node.itemId, idx)}
                className="rounded p-1 text-fg-muted hover:bg-border hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onAddSource(node.itemId)}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-fg-muted hover:bg-border hover:text-fg"
          >
            <Plus className="h-3 w-3" />
            Add source
          </button>
          <button
            type="button"
            onClick={() => onBuildHere(node.itemId)}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-fg-muted hover:bg-border hover:text-fg"
          >
            <Hammer className="h-3 w-3" />
            Build it here
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Raw ----

export function RawInputNodeCard({ node }: { node: Extract<PlanNode, { kind: "raw" }> }) {
  const short = node.ipm > node.claimedSupplyIpm + 1e-3;
  return (
    <div
      className={`rounded-md border bg-bg-raised p-3 text-xs shadow-sm ${
        short ? "border-danger/60" : "border-border"
      }`}
      style={{ width: PLAN_NODE_WIDTH }}
    >
      <FlowHandles left={false} />
      <div className="flex items-center gap-2">
        <Icon itemId={node.itemId} alt="" className="h-6 w-6 shrink-0" />
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{node.itemName}</div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">Raw</div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between tabular-nums">
        <span className="font-semibold text-fg">{rate(node.ipm)}</span>
        <span className={`flex items-center gap-1 ${short ? "text-danger" : "text-success"}`}>
          {short && <CircleAlert className="h-3 w-3" />}
          {rate(node.claimedSupplyIpm)} claimed
        </span>
      </div>
    </div>
  );
}

// ---- Byproduct ----

export function ByproductNodeCard({ node }: { node: Extract<PlanNode, { kind: "byproduct" }> }) {
  return (
    <div
      className="rounded-md border border-dashed border-border bg-bg-raised/60 p-3 text-xs shadow-sm"
      style={{ width: PLAN_NODE_WIDTH }}
    >
      <FlowHandles right={false} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon itemId={node.itemId} alt="" className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-fg-muted">{node.itemName}</div>
            <div className="text-[10px] uppercase tracking-wide text-fg-muted">Byproduct</div>
          </div>
        </div>
        <span className="tabular-nums text-fg-muted">{rate(node.surplusIpm)}</span>
      </div>
    </div>
  );
}
