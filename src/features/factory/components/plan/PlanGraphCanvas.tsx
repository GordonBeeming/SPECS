import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  type Edge,
  type Node,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
// dagre ships as CJS — `import * as` keeps the namespace shape stable
// whether Vite pre-bundles it as default or named exports.
import * as dagreNs from "dagre";

const dagre: typeof import("dagre") =
  (dagreNs as unknown as { default?: typeof import("dagre") }).default ??
  (dagreNs as unknown as typeof import("dagre"));

import { useQueryClient } from "@tanstack/react-query";

import { plannerApi } from "@/features/planner/api";
import { useThemeMode } from "@/shared/theme/useThemeMode";
import type { PlanGraph, PlanLayoutEntry, PlanNode } from "@/features/planner/types";
import type { FilterOption } from "@/shared/ui/FilterSelect";
import type { Recipe } from "@/features/library/types";

import {
  ByproductNodeCard,
  ImportNodeCard,
  PLAN_NODE_WIDTH,
  planNodeHeight,
  RawInputNodeCard,
  RecipeStepNodeCard,
} from "./PlanNodes";

export interface PlanGraphCanvasProps {
  factoryId: string;
  graph: PlanGraph;
  layout: PlanLayoutEntry[];
  recipesByOutput: Map<string, Recipe[]>;
  factoryNames: Map<string, string>;
  factoryIcons: Map<string, string | null>;
  /** itemId → its export slice (targets only). */
  exportByItem: Map<string, number | null>;
  /** Items with a local "build it here" source row. */
  localItems: Set<string>;
  onSwapRecipe: (itemId: string, recipeId: string) => void;
  onOpenSources: (itemId: string) => void;
  onStartExport: (itemId: string, ipm: number) => void;
  onSetExport: (itemId: string, exportIpm: number | null) => void;
  onAddLocal: (itemId: string) => void;
}

/** How a node relates to the current selection: the clicked node, a
 * direct neighbour (shares an edge), or unrelated (dimmed). */
type PlanEmphasis = "none" | "selected" | "neighbour" | "dim";

type PlanFlowData = {
  planNode: PlanNode;
  emphasis: PlanEmphasis;
  canvas: PlanGraphCanvasProps;
} & Record<string, unknown>;

type PlanFlowNode = Node<PlanFlowData, "plan">;

const EMPHASIS_CLASS: Record<PlanEmphasis, string> = {
  none: "",
  selected: "rounded-md ring-2 ring-primary ring-offset-2 ring-offset-bg",
  neighbour: "rounded-md ring-2 ring-accent/80 ring-offset-2 ring-offset-bg",
  // pointer-events-none: a dimmed card can't eat a click meant for
  // something else (mis-cutting the wrong item).
  dim: "opacity-35 pointer-events-none",
};

function PlanFlowNodeComponent({ data }: { data: PlanFlowData }) {
  const card = renderPlanCard(data);
  return (
    <div className={`transition-opacity ${EMPHASIS_CLASS[data.emphasis]}`}>{card}</div>
  );
}

function renderPlanCard(data: PlanFlowData) {
  const { planNode, canvas } = data;
  switch (planNode.kind) {
    case "recipe": {
      const recipes = canvas.recipesByOutput.get(planNode.itemId) ?? [];
      const options: FilterOption[] = recipes.map((r) => ({
        value: r.id,
        label: r.name,
        group: r.isAlt ? "Alternate" : "Standard",
        iconId: r.outputs[0]?.itemId,
        // Inputs → outputs strip in the dropdown, so alternates can be
        // compared by ratio before committing to a swap.
        io: { inputs: r.inputs, outputs: r.outputs },
      }));
      return (
        <RecipeStepNodeCard
          node={planNode}
          recipeOptions={options}
          exportIpm={canvas.exportByItem.get(planNode.itemId) ?? null}
          onSwapRecipe={canvas.onSwapRecipe}
          onOpenSources={canvas.onOpenSources}
          onStartExport={canvas.onStartExport}
          onSetExport={canvas.onSetExport}
        />
      );
    }
    case "import":
      return (
        <ImportNodeCard
          node={planNode}
          factoryNames={canvas.factoryNames}
          factoryIcons={canvas.factoryIcons}
          hasLocal={canvas.localItems.has(planNode.itemId)}
          onOpenSources={canvas.onOpenSources}
          onAddLocal={canvas.onAddLocal}
        />
      );
    case "raw":
      return <RawInputNodeCard node={planNode} />;
    case "byproduct":
      return <ByproductNodeCard node={planNode} />;
  }
}

const nodeTypes = { plan: PlanFlowNodeComponent };

function autoLayout(graph: PlanGraph): Map<string, { x: number; y: number }> {
  try {
    const g = new dagre.graphlib.Graph();
    // ranksep has to clear the edge label (the "Iron Ingot · 60/min"
    // chip is ~120 px wide) with visible line on both sides — at 96
    // the cards sat nearly edge-to-edge and the connection didn't
    // read as a line at all.
    g.setGraph({ rankdir: "LR", nodesep: 72, ranksep: 220 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of graph.nodes) {
      g.setNode(n.nodeKey, { width: PLAN_NODE_WIDTH, height: planNodeHeight(n) });
    }
    for (const e of graph.edges) {
      g.setEdge(e.fromNode, e.toNode);
    }
    dagre.layout(g);
    const out = new Map<string, { x: number; y: number }>();
    for (const n of graph.nodes) {
      const pos = g.node(n.nodeKey);
      if (!pos) continue;
      out.set(n.nodeKey, {
        x: pos.x - PLAN_NODE_WIDTH / 2,
        y: pos.y - planNodeHeight(n) / 2,
      });
    }
    return out;
  } catch (err) {
    console.warn("dagre layout failed, falling back to grid:", err);
    const out = new Map<string, { x: number; y: number }>();
    graph.nodes.forEach((n, i) => {
      out.set(n.nodeKey, {
        x: (i % 4) * (PLAN_NODE_WIDTH + 220),
        y: Math.floor(i / 4) * 220,
      });
    });
    return out;
  }
}

function CanvasInner(props: PlanGraphCanvasProps) {
  const { factoryId, graph, layout } = props;
  // xyflow defaults to colorMode="light", which adds a `light` class
  // to the canvas — and brand.css scopes every --color-* token under
  // .light/.dark, so the nodes would flip to light-mode colours inside
  // a dark app. Follow the app theme instead.
  const { mode } = useThemeMode();

  // Click a node → its flows light up (incoming accent, outgoing
  // primary), direct neighbours get a ring, everything else dims.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const neighbours = useMemo(() => {
    if (!selectedKey) return new Set<string>();
    const out = new Set<string>();
    for (const e of graph.edges) {
      if (e.fromNode === selectedKey) out.add(e.toNode);
      if (e.toNode === selectedKey) out.add(e.fromNode);
    }
    return out;
  }, [graph, selectedKey]);
  // A recompute can swap an item's node kind under the selection —
  // adding an external source turns recipe:X into import:X (and vice
  // versa). The user is still mid-thought on that item, so follow it
  // to its new node instead of silently deselecting; only a node
  // that's truly gone clears the selection (a stale key must not dim
  // everything forever).
  useEffect(() => {
    if (!selectedKey || graph.nodes.some((n) => n.nodeKey === selectedKey)) return;
    const m = selectedKey.match(/^(recipe|import):(.+)$/);
    const twin = m ? `${m[1] === "recipe" ? "import" : "recipe"}:${m[2]}` : null;
    setSelectedKey(twin && graph.nodes.some((n) => n.nodeKey === twin) ? twin : null);
  }, [graph, selectedKey]);

  const savedLayout = useMemo(
    () => new Map(layout.map((l) => [l.nodeKey, { x: l.x, y: l.y }] as const)),
    [layout],
  );
  const computedLayout = useMemo(() => autoLayout(graph), [graph]);

  // The hook's callbacks are useCallback-stable, so building node data
  // straight from props doesn't churn identities — and source/option
  // edits render immediately instead of waiting for the debounced
  // recompute.
  const initialNodes: PlanFlowNode[] = useMemo(
    () =>
      graph.nodes.map((n) => {
        const emphasis: PlanEmphasis = !selectedKey
          ? "none"
          : n.nodeKey === selectedKey
            ? "selected"
            : neighbours.has(n.nodeKey)
              ? "neighbour"
              : "dim";
        return {
          id: n.nodeKey,
          type: "plan" as const,
          position: savedLayout.get(n.nodeKey) ?? computedLayout.get(n.nodeKey) ?? { x: 0, y: 0 },
          width: PLAN_NODE_WIDTH,
          data: { planNode: n, emphasis, canvas: props },
        };
      }),
    [graph, savedLayout, computedLayout, props, selectedKey, neighbours],
  );

  // Animating 50+ edges visibly hurts pan/zoom framerate; cap it.
  // With a selection, only the selected node's flows animate.
  const animate = graph.nodes.length <= 30;
  const initialEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const incoming = selectedKey !== null && e.toNode === selectedKey;
        const outgoing = selectedKey !== null && e.fromNode === selectedKey;
        const connected = incoming || outgoing;
        // Reuse lines (a byproduct fed back into the chain) read amber:
        // they're the part of the build that stalls everything when the
        // pipes are wrong, so they must not blend in with primary flows.
        const stroke = e.isReuse
          ? "var(--color-warning)"
          : incoming
            ? "var(--color-accent, var(--color-primary))"
            : "var(--color-primary)";
        return {
          id: e.id,
          source: e.fromNode,
          target: e.toNode,
          label: `${e.itemName} · ${e.ipm % 1 === 0 ? e.ipm.toFixed(0) : e.ipm.toFixed(1)}/min${
            e.isReuse ? " (reuse)" : ""
          }`,
          animated: selectedKey ? connected : animate,
          style: {
            stroke,
            strokeWidth: connected ? 3 : 2,
            opacity: selectedKey && !connected ? 0.15 : 1,
          },
          labelStyle: {
            fill: "var(--color-fg-muted)",
            fontSize: 10,
            opacity: selectedKey && !connected ? 0.15 : 1,
          },
          labelBgStyle: {
            fill: "var(--color-bg-raised)",
            opacity: selectedKey && !connected ? 0.15 : 1,
          },
        };
      }),
    [graph, animate, selectedKey],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // The view NEVER moves on its own — no fit/zoom/pan on recompute or
  // click (it was jarring mid-edit). `fitView` runs once on mount via
  // the prop; after that the user owns the camera. Auto-arrange below
  // is the explicit opt-in for re-running the layout.
  const { fitView } = useReactFlow();
  const queryClient = useQueryClient();
  const autoArrange = () => {
    const computed = autoLayout(graph);
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        position: computed.get(n.id) ?? n.position,
      })),
    );
    // Persist so the arrangement survives reloads, then refit once —
    // this is user-initiated, so moving the camera is expected.
    for (const [key, pos] of computed) {
      void plannerApi.setPlanLayout(factoryId, key, pos.x, pos.y);
    }
    queryClient.invalidateQueries({ queryKey: ["factory", "plan", factoryId] });
    requestAnimationFrame(() => fitView({ duration: 250, padding: 0.15 }));
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      colorMode={mode}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => setSelectedKey(node.id)}
      onPaneClick={() => setSelectedKey(null)}
      onNodeDragStop={(_, node) => {
        // Refresh the cached plan after persisting, like auto-arrange
        // does — otherwise the next recompute rebuilds nodes from the
        // stale layout prop and the dragged card snaps back.
        void plannerApi
          .setPlanLayout(factoryId, node.id, node.position.x, node.position.y)
          .then(() =>
            queryClient.invalidateQueries({ queryKey: ["factory", "plan", factoryId] }),
          );
      }}
    >
      <Background />
      <Controls />
      <Panel position="top-right">
        <button
          type="button"
          onClick={autoArrange}
          title="Re-run the automatic layout (also refits the view)"
          className="rounded-md border border-border bg-bg-raised/95 px-2.5 py-1.5 text-xs font-medium text-fg shadow hover:border-primary"
        >
          Auto-arrange
        </button>
      </Panel>
    </ReactFlow>
  );
}

export function PlanGraphCanvas(props: PlanGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
