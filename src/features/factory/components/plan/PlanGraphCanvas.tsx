import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  type Edge,
  type Node,
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
  factoryOptions: FilterOption[];
  factoryNames: Map<string, string>;
  importsByItem: Map<string, Array<{ sourceFactoryId: string | null; ipmCap: number | null }>>;
  onSwapRecipe: (itemId: string, recipeId: string) => void;
  onSupplyFromElsewhere: (itemId: string) => void;
  onBuildHere: (itemId: string) => void;
  onSetImportSource: (itemId: string, index: number, factoryId: string | null) => void;
  onSetImportCap: (itemId: string, index: number, cap: number | null) => void;
  onAddImportSource: (itemId: string) => void;
  onRemoveImportSource: (itemId: string, index: number) => void;
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
  dim: "opacity-35",
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
      }));
      return (
        <RecipeStepNodeCard
          node={planNode}
          recipeOptions={options}
          onSwapRecipe={canvas.onSwapRecipe}
          onSupplyFromElsewhere={canvas.onSupplyFromElsewhere}
        />
      );
    }
    case "import":
      return (
        <ImportNodeCard
          node={planNode}
          factoryOptions={canvas.factoryOptions}
          factoryNames={canvas.factoryNames}
          sources={canvas.importsByItem.get(planNode.itemId) ?? []}
          onSetSource={canvas.onSetImportSource}
          onSetCap={canvas.onSetImportCap}
          onAddSource={canvas.onAddImportSource}
          onRemoveSource={canvas.onRemoveImportSource}
          onBuildHere={canvas.onBuildHere}
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
  // A stale selection (node cut out of the graph) must not dim
  // everything forever.
  useEffect(() => {
    if (selectedKey && !graph.nodes.some((n) => n.nodeKey === selectedKey)) {
      setSelectedKey(null);
    }
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
        const stroke = incoming
          ? "var(--color-accent, var(--color-primary))"
          : "var(--color-primary)";
        return {
          id: e.id,
          source: e.fromNode,
          target: e.toNode,
          label: `${e.itemName} · ${e.ipm % 1 === 0 ? e.ipm.toFixed(0) : e.ipm.toFixed(1)}/min`,
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

  // Refit when the graph's shape changes (target added, subtree cut) so
  // new nodes never land off-screen.
  const { fitView } = useReactFlow();
  const shapeKey = useMemo(
    () => graph.nodes.map((n) => n.nodeKey).join("|"),
    [graph],
  );
  useEffect(() => {
    requestAnimationFrame(() => {
      fitView({ duration: 250, padding: 0.15 });
    });
  }, [shapeKey, fitView]);

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
      onNodeClick={(_, node) => setSelectedKey((cur) => (cur === node.id ? null : node.id))}
      onPaneClick={() => setSelectedKey(null)}
      onNodeDragStop={(_, node) => {
        void plannerApi.setPlanLayout(factoryId, node.id, node.position.x, node.position.y);
      }}
    >
      <Background />
      <Controls />
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
