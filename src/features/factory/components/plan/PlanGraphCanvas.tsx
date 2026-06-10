import { useEffect, useMemo } from "react";
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

type PlanFlowData = {
  planNode: PlanNode;
  canvas: PlanGraphCanvasProps;
} & Record<string, unknown>;

type PlanFlowNode = Node<PlanFlowData, "plan">;

function PlanFlowNodeComponent({ data }: { data: PlanFlowData }) {
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
    g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96 });
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
        x: (i % 4) * (PLAN_NODE_WIDTH + 48),
        y: Math.floor(i / 4) * 200,
      });
    });
    return out;
  }
}

function CanvasInner(props: PlanGraphCanvasProps) {
  const { factoryId, graph, layout } = props;

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
      graph.nodes.map((n) => ({
        id: n.nodeKey,
        type: "plan" as const,
        position: savedLayout.get(n.nodeKey) ?? computedLayout.get(n.nodeKey) ?? { x: 0, y: 0 },
        width: PLAN_NODE_WIDTH,
        data: { planNode: n, canvas: props },
      })),
    [graph, savedLayout, computedLayout, props],
  );

  // Animating 50+ edges visibly hurts pan/zoom framerate; cap it.
  const animate = graph.nodes.length <= 30;
  const initialEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.fromNode,
        target: e.toNode,
        label: `${e.itemName} · ${e.ipm % 1 === 0 ? e.ipm.toFixed(0) : e.ipm.toFixed(1)}/min`,
        animated: animate,
        style: { stroke: "var(--color-primary)" },
        labelStyle: { fill: "var(--color-fg-muted)", fontSize: 10 },
        labelBgStyle: { fill: "var(--color-bg-raised)" },
      })),
    [graph, animate],
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
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
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
