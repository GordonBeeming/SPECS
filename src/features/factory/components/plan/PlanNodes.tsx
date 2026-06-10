import { Handle, Position } from "@xyflow/react";
import { CircleAlert, Share2, SlidersHorizontal, TriangleAlert } from "lucide-react";

import { Icon } from "@/shared/ui/Icon";
import { FilterSelect, type FilterOption } from "@/shared/ui/FilterSelect";
import type { PlanNode } from "@/features/planner/types";

export const PLAN_NODE_WIDTH = 250;

/** Per-kind height estimates for dagre — xyflow measures the real DOM,
 * but dagre needs numbers up front. Imports grow with source rows. */
export function planNodeHeight(node: PlanNode): number {
  switch (node.kind) {
    case "recipe":
      return 150;
    case "import":
      return 96 + node.allocations.length * 26 + (node.unassignedIpm > 0 ? 28 : 0);
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
  /** The target's current export slice (null/undefined = none). */
  exportIpm: number | null;
  onSwapRecipe: (itemId: string, recipeId: string) => void;
  onOpenSources: (itemId: string) => void;
  /** Make this item a product exporting `ipm`/min (adds the target). */
  onStartExport: (itemId: string, ipm: number) => void;
  onSetExport: (itemId: string, exportIpm: number | null) => void;
}

export function RecipeStepNodeCard({
  node,
  recipeOptions,
  exportIpm,
  onSwapRecipe,
  onOpenSources,
  onStartExport,
  onSetExport,
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
            Product
          </span>
        )}
      </div>
      <div className="mt-1 tabular-nums text-fg-muted">
        {node.machineCount}× {node.buildingName} @ {node.clockPct.toFixed(0)}% ·{" "}
        {node.powerMw.toFixed(1)} MW
      </div>
      <div className="mt-1 tabular-nums font-semibold text-fg">{rate(node.outputIpm)}</div>

      {/* Every step gets the recipe picker — re-recipe any link in the
          chain and the upstream re-derives. */}
      {recipeOptions.length > 0 && (
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

      <div className="nodrag mt-2 flex items-center justify-between gap-2">
        {!node.isTarget ? (
          <button
            type="button"
            onClick={() => onOpenSources(node.itemId)}
            className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-fg"
          >
            <SlidersHorizontal className="h-3 w-3" />
            Sources
          </button>
        ) : (
          <span />
        )}
        {node.isTarget && exportIpm != null ? (
          <label className="flex items-center gap-1 text-[11px] text-fg-muted">
            <Share2 className="h-3 w-3 text-accent" />
            Export
            <input
              type="number"
              min={0}
              step={1}
              value={exportIpm}
              aria-label={`Export rate for ${node.itemName}`}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0) onSetExport(node.itemId, v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="h-6 w-16 rounded-md border border-border bg-bg px-1.5 tabular-nums text-fg outline-none focus:border-primary"
            />
            /min
          </label>
        ) : (
          <button
            type="button"
            onClick={() =>
              node.isTarget
                ? onSetExport(node.itemId, Math.round(node.outputIpm))
                : onStartExport(node.itemId, Math.round(node.outputIpm))
            }
            title="Offer this item to other factories"
            className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-fg"
          >
            <Share2 className="h-3 w-3" />
            Export
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Input (import) ----

export interface ImportNodeProps {
  node: Extract<PlanNode, { kind: "import" }>;
  factoryNames: Map<string, string>;
  /** True when a local line also builds this item (mixed sourcing). */
  hasLocal: boolean;
  onOpenSources: (itemId: string) => void;
  onAddLocal: (itemId: string) => void;
}

export function ImportNodeCard({
  node,
  factoryNames,
  hasLocal,
  onOpenSources,
  onAddLocal,
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
            <div className="text-[10px] uppercase tracking-wide text-fg-muted">
              {hasLocal ? "Imported share" : "Input"}
            </div>
          </div>
        </div>
        <span className="tabular-nums font-semibold text-fg">{rate(node.ipm)}</span>
      </div>

      {node.allocations.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {node.allocations.map((a, i) => (
            <li key={`${a.sourceFactoryId}-${i}`} className="flex items-center justify-between gap-2">
              <span className="truncate text-fg">
                {factoryNames.get(a.sourceFactoryId) ?? a.sourceFactoryId}
              </span>
              <span className="tabular-nums text-fg-muted">{rate(a.resolvedIpm)}</span>
            </li>
          ))}
        </ul>
      )}

      {node.unassignedIpm > 0 && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-warning/15 px-2 py-1 text-[11px] text-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" />
          Unsourced · {rate(node.unassignedIpm)} — a future factory will supply this
        </div>
      )}

      <div className="nodrag mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenSources(node.itemId)}
          className="flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-[11px] text-fg-muted hover:border-accent hover:text-fg"
        >
          <SlidersHorizontal className="h-3 w-3" />
          Sources
        </button>
        {!hasLocal && (
          <button
            type="button"
            onClick={() => onAddLocal(node.itemId)}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-fg-muted hover:bg-border hover:text-fg"
          >
            Build it here too
          </button>
        )}
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
