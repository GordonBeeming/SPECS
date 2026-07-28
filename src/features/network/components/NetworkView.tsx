import { useMemo } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  Panel,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
} from "@xyflow/react";
import { AlertTriangle, ArrowDownCircle } from "lucide-react";

import "@xyflow/react/dist/style.css";

import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useLogisticsLinks } from "@/features/logistics/hooks/useLogistics";
import { useItems } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { Card } from "@/shared/ui/Card";
import { useThemeMode } from "@/shared/theme/useThemeMode";

import { buildNetworkEdges, type NetworkEdgeData } from "../edgeStyle";
import { layoutFactoryGrid } from "../layout";
import type { FactoryNodeData } from "../types";
import { FactoryNode } from "./FactoryNode";

const nodeTypes = { factory: FactoryNode } as const;
const edgeTypes = { logistics: LogisticsEdge } as const;

/**
 * Top-level network canvas. Composes factories + logistics into a
 * React Flow graph. Read-only in v1: positions come from
 * `layoutFactoryGrid` (deterministic), edits happen in the Logistics
 * tab. Edge thickness scales with utilisation, edge colour with
 * transport kind.
 */
export function NetworkView() {
  const playthrough = useCurrentPlaythrough();
  const factories = useFactoryList();
  const logistics = useLogisticsLinks();
  const items = useItems();
  // xyflow defaults to colorMode="light", which adds a `light` class to
  // the canvas — and brand.css scopes every --color-* token under
  // .light/.dark, so the factory cards flipped to light-mode colours
  // inside a dark app (#61/#72) even though FactoryNode itself only
  // ever used theme-aware classes. Same fix as PlanGraphCanvas.
  const { mode } = useThemeMode();

  const itemLookup = useMemo(() => {
    const m = new Map<string, { name: string; isFluid: boolean }>();
    (items.data ?? []).forEach((i) => m.set(i.id, { name: i.name, isFluid: i.isFluid }));
    return m;
  }, [items.data]);

  const balanceLookup = useMemo(() => {
    // v1 deficit/surplus heuristic: a factory with outgoing links but no
    // machines is in deficit (it's promising flows it can't produce); a
    // factory with machines but no outgoing links is in surplus
    // (assumed: it's making things nobody asked for). The richer ledger-
    // based signal lands with the power planner in Phase 9.
    const linkOut = new Map<string, number>();
    const linkIn = new Map<string, number>();
    (logistics.data ?? []).forEach((l) => {
      linkOut.set(l.fromFactoryId, (linkOut.get(l.fromFactoryId) ?? 0) + 1);
      linkIn.set(l.toFactoryId, (linkIn.get(l.toFactoryId) ?? 0) + 1);
    });
    const m = new Map<string, { hasDeficit: boolean; hasSurplus: boolean }>();
    (factories.data ?? []).forEach((f) => {
      const out = linkOut.get(f.id) ?? 0;
      const inn = linkIn.get(f.id) ?? 0;
      m.set(f.id, {
        hasDeficit: out > 0 && f.machineCount === 0,
        hasSurplus: f.machineCount > 0 && out === 0 && inn === 0,
      });
    });
    return m;
  }, [factories.data, logistics.data]);

  const nodes = useMemo<Node<FactoryNodeData>[]>(() => {
    return layoutFactoryGrid(factories.data ?? [], balanceLookup);
  }, [factories.data, balanceLookup]);

  const edges = useMemo<Edge<NetworkEdgeData>[]>(
    () => buildNetworkEdges(logistics.data ?? [], itemLookup),
    [logistics.data, itemLookup],
  );

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Network</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to see the
          factory network.
        </p>
      </Card>
    );
  }

  if ((factories.data?.length ?? 0) === 0) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Network</h1>
        <p className="mt-2 text-sm text-fg-muted">
          No factories yet. Visit <strong>Factories</strong> to add some,
          then come back to see them on the canvas.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Every other screen opens with a title + playthrough/tier line;
          the canvas used to jump straight to the graph with nothing
          saying what it was or which playthrough it belonged to. */}
      <div>
        <h1 className="text-lg font-semibold text-primary">Network</h1>
        <p className="text-xs text-fg-muted">
          {playthrough.data.displayName} · T{playthrough.data.currentTier}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-bg">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={mode}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} />
          <Controls />
          {/* `FactoryNode`'s deficit/surplus badges have no legend
              anywhere else on this screen — a lone amber down-arrow on
              Copper Works meant nothing without one (#72). */}
          <Panel
            position="top-right"
            className="rounded-md border border-border bg-bg-raised/95 px-2.5 py-2 text-[10px] text-fg-muted shadow-sm backdrop-blur"
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 shrink-0 text-danger" />
              Inputs in deficit
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <ArrowDownCircle className="h-3 w-3 shrink-0 text-warning" />
              Surplus, nothing ships it out
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}

/**
 * Custom edge so parallel links between the same factory pair can each
 * get their own curvature (`data.curvature`) instead of all drawing the
 * same straight bezier and hiding every label but one. Otherwise
 * behaves exactly like React Flow's own default bezier edge.
 */
function LogisticsEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  label,
  labelBgPadding,
  labelBgBorderRadius,
  data,
}: EdgeProps<Edge<NetworkEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: data?.curvature ?? 0.25,
  });
  return (
    <BaseEdge
      id={id}
      path={path}
      style={style}
      markerEnd={markerEnd}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
  );
}
