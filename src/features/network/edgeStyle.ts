/**
 * Edge styling derived from the persisted plan JSON. We avoid hard-coding
 * brand colour values here — the network canvas reads from CSS variables
 * so light/dark themes get the right contrast automatically.
 */

import type { Edge } from "@xyflow/react";

import type { LogisticsLink, TransportKind } from "@/features/logistics/types";

import type { LogisticsEdgeData } from "./types";

/** CSS variable names per transport kind (defined in `brand.css`). */
const KIND_COLOR_VAR: Record<TransportKind, string> = {
  belt: "--color-belt-mk3", // mid-tier belt as the default belt edge colour
  pipe: "--color-pipe-mk1",
  truck: "--color-transport-truck",
  tractor: "--color-transport-truck",
  train: "--color-transport-train",
  drone: "--color-transport-drone",
};

/** Resolves the CSS variable to a usable colour string for SVG `stroke`. */
export function colourForKind(kind: TransportKind): string {
  return `var(${KIND_COLOR_VAR[kind]})`;
}

/**
 * Maps utilisation (0..1) to stroke width. A near-empty link draws thin;
 * a near-capacity link draws thick. Caps at 6px so the canvas doesn't
 * lose readable spacing when one link is wildly over-provisioned.
 */
export function strokeWidthForUtilisation(util: number): number {
  if (!Number.isFinite(util) || util <= 0) return 1.5;
  const clamped = Math.min(1, util);
  return 1.5 + clamped * 4.5; // 1.5 → 6.0
}

/**
 * Bezier curvature for one edge among `groupSize` edges that share the
 * same source/target factory pair. React Flow's own default bezier
 * curvature is 0.25; a lone edge (the common case) keeps exactly that,
 * unchanged from before. Two or more edges between the same pair (e.g.
 * separate logistics links for different items) fan out around it
 * instead of drawing on top of each other — overlapping edges used to
 * leave only one label visible and read as a single link carrying the
 * wrong combined total (#71).
 */
export function curvatureForParallelEdge(indexInGroup: number, groupSize: number): number {
  if (groupSize <= 1) return 0.25;
  const step = 0.35;
  const centered = indexInGroup - (groupSize - 1) / 2;
  return 0.25 + centered * step;
}

/**
 * Parses the planner-serialised plan JSON to recover utilisation. Returns
 * 0 if the JSON is malformed (the slice's repo doesn't store malformed
 * JSON, but old rows from before validation existed might).
 */
export function utilisationFromPlanJson(json: string): number {
  try {
    const parsed = JSON.parse(json);
    const v = Number(parsed?.utilisationPct);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v)) / 100;
  } catch {
    return 0;
  }
}

/** `LogisticsEdgeData` plus the render-only curvature offset that keeps
 * parallel edges between the same factory pair from drawing on top of
 * each other (#71) — computed at build time, not part of the link's own
 * persisted shape. */
export interface NetworkEdgeData extends LogisticsEdgeData {
  curvature: number;
}

/**
 * Builds the React Flow edge list from raw logistics links. Pulled out
 * of the view as a pure function so the grouping/curvature/labelling
 * behaviour is testable without rendering React Flow itself — jsdom has
 * no real layout engine, so asserting on the actual SVG path React Flow
 * draws isn't reliable in this suite; asserting on what this function
 * hands it is.
 */
export function buildNetworkEdges(
  links: LogisticsLink[],
  itemLookup: Map<string, { name: string; isFluid: boolean }>,
): Edge<NetworkEdgeData>[] {
  // Group by factory pair so links sharing a source and target (two
  // items moving between the same two factories) each get a distinct
  // curvature instead of drawing exactly on top of one another.
  const byPair = new Map<string, LogisticsLink[]>();
  for (const link of links) {
    const key = `${link.fromFactoryId}->${link.toFactoryId}`;
    const bucket = byPair.get(key);
    if (bucket) bucket.push(link);
    else byPair.set(key, [link]);
  }
  return links.map((link) => {
    const item = itemLookup.get(link.itemId);
    const utilisation = utilisationFromPlanJson(link.transportPlanJson);
    const colour = colourForKind(link.transportKind);
    const key = `${link.fromFactoryId}->${link.toFactoryId}`;
    const group = byPair.get(key) ?? [link];
    const itemName = item?.name ?? link.itemId;
    const unit = item?.isFluid ? "m³/min" : "ipm";
    return {
      id: link.id,
      type: "logistics",
      source: link.fromFactoryId,
      target: link.toFactoryId,
      animated: false,
      // Name the item on the edge itself — with two links between the
      // same pair, "5 ipm" on its own doesn't say which flow it is
      // (#71). Still terse: full detail lives in the Logistics tab.
      label: `${itemName} · ${link.itemsPerMinute.toFixed(0)} ${unit}`,
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      style: {
        stroke: colour,
        strokeWidth: strokeWidthForUtilisation(utilisation),
      },
      data: {
        linkId: link.id,
        itemId: link.itemId,
        itemName,
        isFluid: item?.isFluid ?? false,
        itemsPerMinute: link.itemsPerMinute,
        transportKind: link.transportKind,
        utilisation,
        edgeColor: colour,
        curvature: curvatureForParallelEdge(group.indexOf(link), group.length),
      },
    };
  });
}
