import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useResourceNodes } from "@/features/resources/hooks/useResources";
import { factoryApi } from "@/features/factory/api";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";

import mapAsset from "@/assets/map/satisfactory-map.webp";

import { pctToWorld, worldToPct } from "../transform";

const PURITY_COLOURS = {
  Pure: "#facc15",
  Normal: "#94a3b8",
  Impure: "#b45309",
} as const;

export function MapView() {
  const playthrough = useCurrentPlaythrough();
  const factories = useFactoryList();
  const nodes = useResourceNodes();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<{
    factoryId: string;
    rect: DOMRect;
  } | null>(null);
  const [dragPos, setDragPos] = useState<{ xPct: number; yPct: number } | null>(
    null,
  );
  const [showOnlyClaimed, setShowOnlyClaimed] = useState(true);

  // Drag handlers wired up at the window level so the pin keeps
  // following the cursor even if it leaves the container during a
  // fast drag (browsers stop firing mouseover on the source element
  // when it's mid-drag).
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const { rect } = dragging;
      const xPct = clamp((e.clientX - rect.left) / rect.width);
      const yPct = clamp((e.clientY - rect.top) / rect.height);
      setDragPos({ xPct, yPct });
    };
    const onUp = async (e: MouseEvent) => {
      const { factoryId, rect } = dragging;
      const xPct = clamp((e.clientX - rect.left) / rect.width);
      const yPct = clamp((e.clientY - rect.top) / rect.height);
      const { worldX, worldY } = pctToWorld(xPct, yPct);
      setDragging(null);
      setDragPos(null);
      try {
        await factoryApi.setPosition({ id: factoryId, worldX, worldY });
      } finally {
        await factories.refetch();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, factories]);

  const visibleNodes = useMemo(() => {
    const data = nodes.data ?? [];
    return showOnlyClaimed ? data.filter((n) => n.claim) : data;
  }, [nodes.data, showOnlyClaimed]);

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Map</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to start placing
          factories on the in-game map.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
              <MapPin className="h-4 w-4" />
              Map
            </h1>
            <p className="text-xs text-fg-muted">
              Drag a factory pin to place it on the map. The planner uses
              these coords to surface "nearest claimed node" hints.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={showOnlyClaimed}
              onChange={(e) => setShowOnlyClaimed(e.target.checked)}
            />
            Show only claimed nodes
          </label>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div
          ref={containerRef}
          className="relative w-full select-none"
          style={{ aspectRatio: "2048 / 1981" }}
        >
          <img
            src={mapAsset}
            alt="Satisfactory map"
            className="absolute inset-0 h-full w-full"
            draggable={false}
          />

          {visibleNodes.map((node) => {
            const { xPct, yPct } = worldToPct(node.x, node.y);
            return (
              <div
                key={node.id}
                title={`${node.resourceItemName} · ${node.purity}${
                  node.claim ? ` · ${node.itemsPerMinute.toFixed(0)} ipm` : ""
                }`}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40"
                style={{
                  left: `${xPct * 100}%`,
                  top: `${yPct * 100}%`,
                  width: node.claim ? 10 : 6,
                  height: node.claim ? 10 : 6,
                  background:
                    PURITY_COLOURS[node.purity as keyof typeof PURITY_COLOURS],
                  opacity: node.claim ? 1 : 0.55,
                }}
              />
            );
          })}

          {(factories.data ?? []).map((f) => {
            const live =
              dragging?.factoryId === f.id && dragPos
                ? dragPos
                : worldToPct(f.worldX, f.worldY);
            return (
              <button
                key={f.id}
                type="button"
                onMouseDown={(e) => {
                  if (!containerRef.current) return;
                  const rect = containerRef.current.getBoundingClientRect();
                  setDragging({ factoryId: f.id, rect });
                  e.preventDefault();
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-md border-2 border-primary bg-bg-raised/90 px-2 py-1 text-[11px] font-medium text-fg shadow-sm hover:bg-bg-raised active:cursor-grabbing"
                style={{
                  left: `${live.xPct * 100}%`,
                  top: `${live.yPct * 100}%`,
                }}
                title={`${f.name} (drag to move)`}
              >
                {f.iconId ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon itemId={f.iconId} alt={f.name} className="h-4 w-4" />
                    {f.name}
                  </span>
                ) : (
                  f.name
                )}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function clamp(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
