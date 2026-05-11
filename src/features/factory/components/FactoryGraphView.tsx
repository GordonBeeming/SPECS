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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { Trash2 } from "lucide-react";

import { Icon } from "@/shared/ui/Icon";
import { useRecipes } from "@/features/library/hooks/useLibrary";
import { factoryApi } from "../api";
import { useRemoveMachine } from "../hooks/useFactories";
import type { FactoryMachine } from "../types";
import { ampSlotsForBuilding } from "../ampRules";

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
  onRemove: () => void;
} & Record<string, unknown>;

type FlowNode = Node<MachineNodeData, "machine">;

function MachineNode({ data }: { data: MachineNodeData }) {
  const { machine, buildingName, recipeName, onRemove } = data;
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
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove machine"
          className="rounded p-1 text-fg-muted hover:bg-danger/20 hover:text-danger"
        >
          <Trash2 className="h-3 w-3" />
        </button>
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
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const m of machines) {
    g.setNode(m.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const m of machines) {
    const { x, y } = g.node(m.id);
    out.set(m.id, { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 });
  }
  return out;
}

function GraphInner({ factoryId, machines, buildingNames, recipeNames, layouts }: FactoryGraphViewProps) {
  const recipes = useRecipes();
  const removeMachine = useRemoveMachine(factoryId);

  const computedLayout = useMemo(() => autoLayout(machines), [machines]);

  const initialNodes: FlowNode[] = useMemo(() => {
    return machines.map((m) => {
      const fromUser = layouts.get(m.id);
      const pos = fromUser ?? computedLayout.get(m.id) ?? { x: 0, y: 0 };
      return {
        id: m.id,
        type: "machine" as const,
        position: pos,
        data: {
          machine: m,
          buildingName: buildingNames.get(m.buildingId) ?? m.buildingId,
          recipeName: recipeNames.get(m.recipeId) ?? m.recipeId,
          onRemove: () => {
            if (confirm(`Remove this ${recipeNames.get(m.recipeId) ?? "machine"} row?`)) {
              removeMachine.mutate(m.id);
            }
          },
        },
      };
    });
  }, [machines, layouts, computedLayout, buildingNames, recipeNames, removeMachine]);

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
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

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
          void factoryApi.setMachineLayout({
            machineId: node.id,
            x: node.position.x,
            y: node.position.y,
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
