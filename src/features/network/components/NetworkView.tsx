import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useLogisticsLinks } from "@/features/logistics/hooks/useLogistics";
import { useItems } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { Card } from "@/shared/ui/Card";

import { colourForKind, strokeWidthForUtilisation, utilisationFromPlanJson } from "../edgeStyle";
import { layoutFactoryGrid } from "../layout";
import type { FactoryNodeData, LogisticsEdgeData } from "../types";
import { FactoryNode } from "./FactoryNode";

const nodeTypes = { factory: FactoryNode } as const;

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

  const edges = useMemo<Edge<LogisticsEdgeData>[]>(() => {
    return (logistics.data ?? []).map((link) => {
      const item = itemLookup.get(link.itemId);
      const utilisation = utilisationFromPlanJson(link.transportPlanJson);
      const colour = colourForKind(link.transportKind);
      return {
        id: link.id,
        source: link.fromFactoryId,
        target: link.toFactoryId,
        animated: false,
        // The label gets clipped by React Flow when the edge is short, so
        // keep it terse — full detail is in the Logistics tab anyway.
        label: `${link.itemsPerMinute.toFixed(0)} ${item?.isFluid ? "m³/min" : "ipm"}`,
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        style: {
          stroke: colour,
          strokeWidth: strokeWidthForUtilisation(utilisation),
        },
        data: {
          linkId: link.id,
          itemId: link.itemId,
          itemName: item?.name ?? link.itemId,
          isFluid: item?.isFluid ?? false,
          itemsPerMinute: link.itemsPerMinute,
          transportKind: link.transportKind,
          utilisation,
          edgeColor: colour,
        },
      };
    });
  }, [logistics.data, itemLookup]);

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
    <div className="h-full w-full overflow-hidden rounded-lg border border-border bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls />
      </ReactFlow>
    </div>
  );
}
