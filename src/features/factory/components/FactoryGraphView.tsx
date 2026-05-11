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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
// dagre ships as CJS — `import * as` keeps the namespace shape stable
// whether Vite pre-bundles it as default or named exports.
import * as dagreNs from "dagre";
import { Pencil } from "lucide-react";

// Handle either binding shape Vite hands us — pre-bundled CJS modules
// surface either as default or as namespace-with-default depending on
// the optimisation pass.
const dagre: typeof import("dagre") =
  (dagreNs as unknown as { default?: typeof import("dagre") }).default ??
  (dagreNs as unknown as typeof import("dagre"));

import { useQueryClient } from "@tanstack/react-query";

import { Icon } from "@/shared/ui/Icon";
import { ConfirmDeleteButton } from "@/shared/ui/ConfirmDeleteButton";
import { useRecipes } from "@/features/library/hooks/useLibrary";
import { factoryApi } from "../api";
import { useRemoveMachine } from "../hooks/useFactories";
import type { FactoryMachine } from "../types";
import { ampSlotsForBuilding } from "../ampRules";
import { EditMachineModal } from "./EditMachineModal";

interface FactoryGraphViewProps {
  factoryId: string;
  machines: FactoryMachine[];
  buildingNames: Map<string, string>;
  recipeNames: Map<string, string>;
  layouts: Map<string, { x: number; y: number }>;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 110;

// `Node<TData>` from xyflow requires `TData extends Record<string, unknown>`
// so we model the payload via a type alias rather than an interface — TS
// interfaces don't widen to index signatures the same way.
type MachineNodeData = {
  machine: FactoryMachine;
  buildingName: string;
  recipeName: string;
  onEdit: () => void;
  onRemove: () => void;
} & Record<string, unknown>;

type FlowNode = Node<MachineNodeData, "machine">;

function MachineNode({ data }: { data: MachineNodeData }) {
  const { machine, buildingName, recipeName, onEdit, onRemove } = data;
  const slots = ampSlotsForBuilding(machine.buildingId);
  const amp =
    machine.useSomersloop && machine.somersloopSlotsFilled > 0
      ? `${machine.somersloopSlotsFilled}/${slots}× S`
      : null;
  return (
    <div
      className="rounded-md border border-border bg-bg-raised p-3 text-xs shadow-sm"
      style={{ width: NODE_WIDTH }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon itemId={machine.buildingId} alt={buildingName} className="h-5 w-5" />
          <span className="truncate font-medium text-fg">{recipeName}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit machine"
            className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <ConfirmDeleteButton onConfirm={onRemove} label="Remove machine" />
        </div>
      </div>
      <div className="mt-1 text-fg-muted">{buildingName}</div>
      <div className="mt-2 grid grid-cols-3 gap-1 tabular-nums">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">count</div>
          <div className="font-semibold text-fg">{machine.count}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">clock</div>
          <div className="font-semibold text-fg">{machine.clockPct.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">amp</div>
          <div className="font-semibold text-fg">
            {amp ?? (machine.powerShardCount > 0 ? `${machine.powerShardCount}× PS` : "—")}
          </div>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { machine: MachineNode };

/**
 * Dagre layered layout. Nodes flow left → right grouped by which
 * machine feeds which. We don't actually have a "feeds" relationship
 * at the machine level (those happen at the factory boundary via
 * logistics_link), so the auto layout is a grid; persisted positions
 * override it once the user drags.
 */
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
  const removeMachine = useRemoveMachine(factoryId);
  const [editingId, setEditingId] = useState<string | null>(null);

  // The mutation object's reference changes every render, but
  // `mutate` is what we actually need inside the node's onRemove
  // callback. Stash it in a ref so closing over it doesn't make
  // initialNodes unstable and trigger an infinite setNodes loop
  // through xyflow's StoreUpdater.
  const removeRef = useRef(removeMachine.mutate);
  useEffect(() => {
    removeRef.current = removeMachine.mutate;
  }, [removeMachine.mutate]);
  const editRef = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    editRef.current = (id) => setEditingId(id);
  });

  const computedLayout = useMemo(() => autoLayout(machines), [machines]);

  const initialNodes: FlowNode[] = useMemo(() => {
    return machines.map((m) => {
      const fromUser = layouts.get(m.id);
      const pos = fromUser ?? computedLayout.get(m.id) ?? { x: 0, y: 0 };
      const recipeName = recipeNames.get(m.recipeId) ?? m.recipeId;
      return {
        id: m.id,
        type: "machine" as const,
        position: pos,
        data: {
          machine: m,
          buildingName: buildingNames.get(m.buildingId) ?? m.buildingId,
          recipeName,
          onEdit: () => editRef.current(m.id),
          // Two-click confirm lives in MachineNode itself (Tauri 2
          // suppresses window.confirm so the dialog never showed) —
          // just hand the actual mutation through.
          onRemove: () => removeRef.current(m.id),
        },
      };
    });
  }, [machines, layouts, computedLayout, buildingNames, recipeNames]);

  // Derive edges from the recipe graph — for any two machines where the
  // upstream's recipe outputs an item that the downstream's recipe takes
  // as input, draw a chevroned edge. This is a heuristic (machines on
  // the same factory aren't formally "linked"), but it gives the graph
  // its visual meaning until a future commit introduces real machine-
  // to-machine routing.
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

  // useEdgesState only seeds on first mount, so without this the
  // edge set is frozen at the recipes.data === undefined snapshot
  // (empty array). Re-derive whenever the recipe-driven dependency
  // graph changes — covers both the initial load and add/remove
  // machine paths.
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // After a drag-save, mark the factory.layout cache stale so any
  // subsequent re-render (e.g. add/remove machine triggers a
  // refetch and rehydrates from `layouts`) reads the freshly-saved
  // coordinates instead of stomping them back to a cached value.
  const queryClient = useQueryClient();

  const editingMachine = machines.find((m) => m.id === editingId) ?? null;

  return (
    <div className="h-[560px] w-full rounded-md border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        onNodeDragStop={(_, node) => {
          void factoryApi
            .setMachineLayout({
              machineId: node.id,
              x: node.position.x,
              y: node.position.y,
            })
            .then(() => {
              // useMachineLayouts is the rehydration source on
              // factory-detail re-renders — without this any
              // subsequent add/remove machine would refetch the
              // pre-drag layout and visually snap the node back.
              queryClient.invalidateQueries({
                queryKey: ["factory", "machine-layouts", factoryId],
              });
            });
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
      {editingMachine && (
        <EditMachineModal
          factoryId={factoryId}
          machine={editingMachine}
          recipeName={recipeNames.get(editingMachine.recipeId) ?? editingMachine.recipeId}
          buildingName={buildingNames.get(editingMachine.buildingId) ?? editingMachine.buildingId}
          onClose={() => setEditingId(null)}
        />
      )}
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
