import { Handle, Position } from "@xyflow/react";
import {
  CircleAlert,
  Download,
  FlaskConical,
  Recycle,
  Share2,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";

import { Icon } from "@/shared/ui/Icon";
import { FilterSelect, type FilterOption } from "@/shared/ui/FilterSelect";
import type { ExistingProducer, PlanNode } from "@/features/planner/types";
import { RateInput } from "./RateInput";
import { rate } from "@/shared/format/rates";

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

/**
 * The rate to prefill an export field with. Takes `freeOutputIpm`
 * (production minus what this factory's own steps consume), never gross
 * `outputIpm` — prefilling from gross declares an export the factory
 * can't honour when other steps here are already eating most of it.
 *
 * Satisfactory ratios are exact and routinely fractional — a Motor line
 * running 2.5/min must not offer 3 — so this only trims the float dust
 * an f32 round-trip leaves behind, never the fraction itself.
 */
function exportPrefill(freeOutputIpm: number): number {
  return Number(freeOutputIpm.toFixed(3));
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
  /** True when this node's *active* recipe is a tier-reachable alt the
   * playthrough hasn't scanned yet — the same fact the recipe picker
   * already flags per option, read for the recipe actually in use. */
  uncollected: boolean;
  /** A factory that already makes this item with spare, when one
   * exists — absent means nothing to suggest, not "nobody else makes
   * this" (the check isn't run everywhere a graph is read). */
  existingProducer?: ExistingProducer;
  onSwapRecipe: (itemId: string, recipeId: string) => void;
  onOpenSources: (itemId: string) => void;
  /** Make this item a product exporting `ipm`/min (adds the target). */
  onStartExport: (itemId: string, ipm: number) => void;
  onSetExport: (itemId: string, exportIpm: number | null) => void;
  /** Import from an existing producer instead of building it here —
   * local production stays as the elastic remainder, same as any other
   * external source added from the Sources panel. */
  onImportFromProducer: (itemId: string, sourceFactoryId: string) => void;
}

export function RecipeStepNodeCard({
  node,
  recipeOptions,
  exportIpm,
  uncollected,
  existingProducer,
  onSwapRecipe,
  onOpenSources,
  onStartExport,
  onSetExport,
  onImportFromProducer,
}: RecipeStepNodeProps) {
  // "Free" only earns its own line when it actually differs from gross
  // production — for a leaf product with no internal consumer they're
  // the same number, and repeating it twice is noise, not information.
  const hasFreeGap = node.freeOutputIpm < node.outputIpm - 1e-3;
  const topSource = existingProducer?.sources[0];
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
        <div className="flex shrink-0 items-center gap-1">
          {uncollected && (
            <span
              title="Unlocked at this recipe's tier, but not scanned into your Alts list yet"
              className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent"
            >
              <FlaskConical className="h-3 w-3" />
              Not collected
            </span>
          )}
          {node.isTarget && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">
              Product
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 tabular-nums text-fg-muted">
        {node.machineCount}× {node.buildingName} @ {node.clockPct.toFixed(0)}% ·{" "}
        {node.powerMw.toFixed(1)} MW
      </div>
      <div className="mt-1 tabular-nums">
        <span className="font-semibold text-fg">{rate(node.outputIpm)}</span>
        <span className="text-fg-muted"> produced</span>
        {hasFreeGap && <span className="text-fg-muted">, {rate(node.freeOutputIpm)} free</span>}
      </div>

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

      {/* Surfaced at the point the solver is about to build a local
          copy, rather than waiting for Sources to be asked — the
          default outcome without this is rebuilding, every time. */}
      {!node.isTarget && topSource && (
        <div className="mt-2 flex items-start gap-1.5 rounded border border-accent/40 bg-accent/10 px-2 py-1.5 text-fg-muted">
          <Download className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="text-fg">{topSource.factoryName}</span> already makes this,{" "}
            {rate(topSource.spareIpm)} spare —{" "}
            <button
              type="button"
              onClick={() => onImportFromProducer(node.itemId, topSource.factoryId)}
              className="font-medium text-accent hover:underline"
            >
              import instead
            </button>
          </span>
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
            <RateInput
              value={exportIpm}
              // 0 is a real answer for an export slice: "listed, but
              // offering nothing right now".
              allowZero
              onCommit={(next) => onSetExport(node.itemId, next)}
              ariaLabel={`Export rate for ${node.itemName}`}
              className="h-6 w-16 rounded-md border border-border bg-bg px-1.5 tabular-nums text-fg outline-none focus:border-primary"
            />
            /min
          </label>
        ) : (
          <button
            type="button"
            onClick={() =>
              node.isTarget
                ? onSetExport(node.itemId, exportPrefill(node.freeOutputIpm))
                : onStartExport(node.itemId, exportPrefill(node.freeOutputIpm))
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
  /** Source factories' item-icon ids, for a face next to each name. */
  factoryIcons: Map<string, string | null>;
  /** True when a local line also builds this item (mixed sourcing). */
  hasLocal: boolean;
  onOpenSources: (itemId: string) => void;
  onAddLocal: (itemId: string) => void;
}

export function ImportNodeCard({
  node,
  factoryNames,
  factoryIcons,
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
          {node.allocations.map((a, i) => {
            const icon = factoryIcons.get(a.sourceFactoryId) ?? null;
            return (
              <li
                key={`${a.sourceFactoryId}-${i}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {icon && <Icon itemId={icon} alt="" className="h-4 w-4 shrink-0" />}
                  <span className="truncate text-fg">
                    {factoryNames.get(a.sourceFactoryId) ?? a.sourceFactoryId}
                  </span>
                </span>
                <span className="tabular-nums text-fg-muted">{rate(a.resolvedIpm)}</span>
              </li>
            );
          })}
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
  // A solid surplus goes to the AWESOME sink; a fluid surplus has no
  // sink and stalls the line — same data, very different urgency.
  //
  // Neither is a quiet node. Sunk output is throughput a refinery is
  // paying for and throwing away — a Tier 5-6 oil plan sinking 145/min
  // of Petroleum Coke needs to be legible at a glance, not the dimmest
  // card on the canvas.
  return (
    <div
      className={`rounded-md border-2 border-dashed p-3 text-xs shadow-sm ${
        node.isFluid ? "border-danger/70 bg-danger/10" : "border-warning/70 bg-warning/10"
      }`}
      style={{ width: PLAN_NODE_WIDTH }}
    >
      <FlowHandles right={false} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon itemId={node.itemId} alt="" className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{node.itemName}</div>
            <div
              className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
                node.isFluid ? "text-danger" : "text-warning"
              }`}
            >
              {node.isFluid ? (
                <TriangleAlert className="h-3 w-3 shrink-0" />
              ) : (
                <Recycle className="h-3 w-3 shrink-0" />
              )}
              {node.isFluid ? "Fluid surplus — will stall" : "Byproduct → sink"}
            </div>
          </div>
        </div>
        <span className={`tabular-nums font-semibold ${node.isFluid ? "text-danger" : "text-fg"}`}>
          {rate(node.surplusIpm)}
        </span>
      </div>
    </div>
  );
}
