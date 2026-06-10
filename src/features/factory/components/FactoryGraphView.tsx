import { useEffect, useMemo, useRef, useState } from "react";
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

// Handle either binding shape Vite hands us — pre-bundled CJS modules
// surface either as default or as namespace-with-default depending on
// the optimisation pass.
const dagre: typeof import("dagre") =
  (dagreNs as unknown as { default?: typeof import("dagre") }).default ??
  (dagreNs as unknown as typeof import("dagre"));

import { useQueryClient } from "@tanstack/react-query";

import { useRecipes } from "@/features/library/hooks/useLibrary";
import { useThemeMode } from "@/shared/theme/useThemeMode";
import { factoryApi } from "../api";
import { useRemoveMachine, useUpdateMachine } from "../hooks/useFactories";
import type { FactoryMachine, UpdateMachineInput } from "../types";
import {
  MachineNodeCard,
  NODE_HEIGHT,
  NODE_WIDTH,
  NODE_WIDTH_EDITING,
} from "./MachineNode";

interface FactoryGraphViewProps {
  factoryId: string;
  machines: FactoryMachine[];
  buildingNames: Map<string, string>;
  recipeNames: Map<string, string>;
  layouts: Map<string, { x: number; y: number }>;
}

// `Node<TData>` from xyflow requires `TData extends Record<string, unknown>`
// so we model the payload via a type alias rather than an interface — TS
// interfaces don't widen to index signatures the same way.
type MachineNodeData = {
  machine: FactoryMachine;
  buildingName: string;
  recipeName: string;
  editing: boolean;
  updating: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onRemove: () => void;
  onUpdate: (patch: UpdateMachineInput) => void;
} & Record<string, unknown>;

type FlowNode = Node<MachineNodeData, "machine">;

function MachineNode({ data }: { data: MachineNodeData }) {
  return (
    <MachineNodeCard
      machine={data.machine}
      buildingName={data.buildingName}
      recipeName={data.recipeName}
      editing={data.editing}
      onEdit={data.onEdit}
      onCancelEdit={data.onCancelEdit}
      onRemove={data.onRemove}
      onUpdate={data.onUpdate}
      updating={data.updating}
    />
  );
}

const nodeTypes = { machine: MachineNode };

function autoLayout(machines: FactoryMachine[]): Map<string, { x: number; y: number }> {
  // dagre is a CJS dep — if its interop binding goes sideways under a
  // particular bundler config the `graphlib` access throws. Fall back
  // to a deterministic grid so the page never blanks.
  try {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const m of machines) {
      g.setNode(m.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    dagre.layout(g);
    const out = new Map<string, { x: number; y: number }>();
    for (const m of machines) {
      const node = g.node(m.id);
      if (!node) continue;
      out.set(m.id, { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2 });
    }
    return out;
  } catch (err) {
    console.warn("dagre layout failed, falling back to grid:", err);
    const out = new Map<string, { x: number; y: number }>();
    machines.forEach((m, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      out.set(m.id, { x: col * (NODE_WIDTH + 40), y: row * (NODE_HEIGHT + 40) });
    });
    return out;
  }
}

function GraphInner({ factoryId, machines, buildingNames, recipeNames, layouts }: FactoryGraphViewProps) {
  const recipes = useRecipes();
  // Same colour-scheme trap as PlanGraphCanvas: xyflow's default
  // light colorMode re-scopes the brand tokens inside the canvas.
  const { mode } = useThemeMode();
  const removeMachine = useRemoveMachine(factoryId);
  const updateMachine = useUpdateMachine(factoryId);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Stash mutation callbacks in refs so memoised node-data don't churn.
  const removeRef = useRef(removeMachine.mutate);
  useEffect(() => {
    removeRef.current = removeMachine.mutate;
  }, [removeMachine.mutate]);
  const updateRef = useRef(updateMachine.mutate);
  useEffect(() => {
    updateRef.current = updateMachine.mutate;
  }, [updateMachine.mutate]);
  const editRef = useRef<(id: string) => void>(() => {});
  const cancelEditRef = useRef<() => void>(() => {});
  useEffect(() => {
    editRef.current = (id) => setEditingId(id);
    cancelEditRef.current = () => setEditingId(null);
  });

  const computedLayout = useMemo(() => autoLayout(machines), [machines]);

  const initialNodes: FlowNode[] = useMemo(() => {
    return machines.map((m) => {
      const fromUser = layouts.get(m.id);
      const pos = fromUser ?? computedLayout.get(m.id) ?? { x: 0, y: 0 };
      const recipeName = recipeNames.get(m.recipeId) ?? m.recipeId;
      const isEditing = editingId === m.id;
      return {
        id: m.id,
        type: "machine" as const,
        position: pos,
        // xyflow uses the stored width for edge anchor calcs; expand
        // when in edit mode so the wider editor card doesn't clip edges.
        width: isEditing ? NODE_WIDTH_EDITING : NODE_WIDTH,
        data: {
          machine: m,
          buildingName: buildingNames.get(m.buildingId) ?? m.buildingId,
          recipeName,
          editing: isEditing,
          updating: isEditing && updateMachine.isPending,
          onEdit: () => editRef.current(m.id),
          onCancelEdit: () => cancelEditRef.current(),
          onRemove: () => removeRef.current(m.id),
          onUpdate: (patch: UpdateMachineInput) =>
            updateRef.current(patch, {
              onSuccess: () => setEditingId(null),
            }),
        },
      };
    });
  }, [
    machines,
    layouts,
    computedLayout,
    buildingNames,
    recipeNames,
    editingId,
    updateMachine.isPending,
  ]);

  // Derive edges from the recipe graph — for any two machines where the
  // upstream's recipe outputs an item that the downstream's recipe takes
  // as input, draw a chevroned edge.
  const initialEdges: Edge[] = useMemo(() => {
    if (!recipes.data) return [];
    const recipeById = new Map(recipes.data.map((r) => [r.id, r]));
    const edges: Edge[] = [];
    for (const upstream of machines) {
      const upRecipe = recipeById.get(upstream.recipeId);
      if (!upRecipe) continue;
      for (const downstream of machines) {
        if (upstream.id === downstream.id) continue;
        const downRecipe = recipeById.get(downstream.recipeId);
        if (!downRecipe) continue;
        const sharedItem = upRecipe.outputs.find((o) =>
          downRecipe.inputs.some((i) => i.itemId === o.itemId),
        );
        if (!sharedItem) continue;
        edges.push({
          id: `${upstream.id}->${downstream.id}-${sharedItem.itemId}`,
          source: upstream.id,
          target: downstream.id,
          label: sharedItem.itemId.replace(/^Desc_/, "").replace(/_C$/, ""),
          animated: true,
          style: { stroke: "var(--color-primary)" },
        });
      }
    }
    return edges;
  }, [machines, recipes.data]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Re-fit the viewport when entering edit mode — the expanded card is
  // wider/taller than the collapsed one and would otherwise spill out
  // of the visible canvas. Skip when leaving edit mode so dropping out
  // of the editor doesn't pull other nodes off-screen.
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (editingId) {
      // requestAnimationFrame so the DOM has flushed the resized node
      // before xyflow measures it for the fit.
      const rafId = requestAnimationFrame(() => {
        fitView({ duration: 200, padding: 0.2 });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [editingId, fitView]);

  const queryClient = useQueryClient();

  return (
    <div className="h-[560px] w-full rounded-md border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        colorMode={mode}
        fitView
        onNodeDragStop={(_, node) => {
          void factoryApi
            .setMachineLayout({
              machineId: node.id,
              x: node.position.x,
              y: node.position.y,
            })
            .then(() => {
              queryClient.invalidateQueries({
                queryKey: ["factory", "machine-layouts", factoryId],
              });
            });
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function FactoryGraphView(props: FactoryGraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
