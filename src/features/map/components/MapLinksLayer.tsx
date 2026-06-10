import { useMemo } from "react";

import type { LogisticsLink } from "@/features/logistics/types";
import { worldToPct } from "../transform";

export interface MapLinksLayerProps {
  links: LogisticsLink[];
  factories: Array<{ id: string; name: string; worldX: number; worldY: number }>;
  itemNames: Map<string, string>;
  /** Lines touching this factory render highlighted; the rest fade. */
  selectedFactoryId: string | null;
  mapW: number;
  mapH: number;
}

interface PairLine {
  key: string;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  items: Array<{ itemId: string; name: string; ipm: number }>;
}

/**
 * Every factory→factory logistics link on the map, aggregated to one
 * line per (from, to) pair so ten items between two factories don't
 * paint ten overlapping strokes. Unselected lines sit faint in the
 * background; selecting a factory lights up its lines (accent for
 * incoming, primary for outgoing) and fades the rest further.
 */
export function MapLinksLayer({
  links,
  factories,
  itemNames,
  selectedFactoryId,
  mapW,
  mapH,
}: MapLinksLayerProps) {
  const pairs = useMemo<PairLine[]>(() => {
    const factoryById = new Map(factories.map((f) => [f.id, f]));
    const byPair = new Map<string, PairLine>();
    for (const l of links) {
      const from = factoryById.get(l.fromFactoryId);
      const to = factoryById.get(l.toFactoryId);
      if (!from || !to) continue;
      const key = `${l.fromFactoryId}->${l.toFactoryId}`;
      let pair = byPair.get(key);
      if (!pair) {
        const p1 = worldToPct(from.worldX, from.worldY);
        const p2 = worldToPct(to.worldX, to.worldY);
        pair = {
          key,
          fromId: l.fromFactoryId,
          toId: l.toFactoryId,
          x1: p1.xPct * mapW,
          y1: p1.yPct * mapH,
          x2: p2.xPct * mapW,
          y2: p2.yPct * mapH,
          items: [],
        };
        byPair.set(key, pair);
      }
      pair.items.push({
        itemId: l.itemId,
        name: itemNames.get(l.itemId) ?? l.itemId,
        ipm: l.itemsPerMinute,
      });
    }
    return Array.from(byPair.values());
  }, [links, factories, itemNames, mapW, mapH]);

  if (pairs.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={mapW}
      height={mapH}
      viewBox={`0 0 ${mapW} ${mapH}`}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="specs-links-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>
      {pairs.map((p) => {
        const incoming = selectedFactoryId !== null && p.toId === selectedFactoryId;
        const outgoing = selectedFactoryId !== null && p.fromId === selectedFactoryId;
        const adjacent = incoming || outgoing;
        const colour = incoming
          ? "var(--color-accent, var(--color-primary))"
          : "var(--color-primary)";
        const opacity = selectedFactoryId === null ? 0.3 : adjacent ? 0.85 : 0.08;
        const midX = (p.x1 + p.x2) / 2;
        const midY = (p.y1 + p.y2) / 2;
        const label =
          p.items.length === 1
            ? `${p.items[0].name} ${p.items[0].ipm.toFixed(0)}/min`
            : `${p.items.length} items`;
        return (
          <g key={p.key} style={{ color: colour }}>
            <line
              x1={p.x1}
              y1={p.y1}
              x2={p.x2}
              y2={p.y2}
              stroke={colour}
              strokeWidth={adjacent ? 3 : 2}
              strokeOpacity={opacity}
              markerEnd="url(#specs-links-arrow)"
            />
            {(selectedFactoryId === null || adjacent) && (
              <>
                <title>
                  {p.items.map((i) => `${i.name} · ${i.ipm.toFixed(1)}/min`).join("\n")}
                </title>
                <text
                  x={midX}
                  y={midY - 6}
                  textAnchor="middle"
                  fill="var(--color-fg-muted, currentColor)"
                  fillOpacity={selectedFactoryId === null ? 0.7 : 1}
                  fontSize={13}
                  paintOrder="stroke"
                  stroke="var(--color-bg, #000)"
                  strokeWidth={3}
                  strokeOpacity={0.6}
                >
                  {label}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
