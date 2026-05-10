/**
 * Auto-layout helpers for the network canvas.
 *
 * v1 deliberately ships without dagre/elkjs to keep the bundle small and
 * the layout deterministic. Factories arrange in a grid sized to fit the
 * count, with a stable per-id order so re-renders don't reshuffle. The
 * user can drag nodes; their positions persist in component state for
 * the session (a future PR will round-trip them through `factory.world_x`
 * / `factory.world_y` once the React Flow drag handles are wired up).
 */

import type { Node } from "@xyflow/react";

import type { FactoryNodeData } from "./types";

const NODE_W = 220;
const NODE_H = 84;
const GAP_X = 40;
const GAP_Y = 64;

/**
 * Place factories in a square-ish grid. With N factories, lay them out
 * as `cols = ceil(sqrt(N))` so the aspect ratio stays close to 1:1
 * regardless of count. Sort by factory id for stable ordering — without
 * that, two render cycles can land the same network in two different
 * shapes which is jarring.
 */
export function layoutFactoryGrid(
  factories: { id: string; name: string; machineCount: number }[],
  ledgerByFactoryId: Map<string, { hasDeficit: boolean; hasSurplus: boolean }>,
): Node<FactoryNodeData>[] {
  const sorted = [...factories].sort((a, b) => a.id.localeCompare(b.id));
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));

  return sorted.map((f, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const balance = ledgerByFactoryId.get(f.id) ?? { hasDeficit: false, hasSurplus: false };
    return {
      id: f.id,
      type: "factory",
      position: {
        x: col * (NODE_W + GAP_X),
        y: row * (NODE_H + GAP_Y),
      },
      data: {
        factoryId: f.id,
        name: f.name,
        machineCount: f.machineCount,
        hasDeficit: balance.hasDeficit,
        hasSurplus: balance.hasSurplus,
      },
      width: NODE_W,
      height: NODE_H,
    };
  });
}
