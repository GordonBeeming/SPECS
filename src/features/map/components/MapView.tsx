import { useMemo, useRef, useState } from "react";
import { MapPin, Minus, Plus, RotateCcw } from "lucide-react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useFactoryList } from "@/features/factory/hooks/useFactories";
import {
  useClearNodeClaim,
  useResourceNodes,
  useSetNodeClaim,
} from "@/features/resources/hooks/useResources";
import { factoryApi } from "@/features/factory/api";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";

import mapAsset from "@/assets/map/satisfactory-map.webp";

import { pctToWorld, worldToPct } from "../transform";
import type { ResourceNodeRow } from "@/features/resources/types";

const PURITY_COLOURS = {
  Pure: "#facc15",
  Normal: "#94a3b8",
  Impure: "#b45309",
} as const;

const MAP_W = 2048;
const MAP_H = 1981;

export function MapView() {
  const playthrough = useCurrentPlaythrough();
  const factories = useFactoryList();
  const nodes = useResourceNodes();
  const setClaim = useSetNodeClaim();
  const clearClaim = useClearNodeClaim();
  const wrapRef = useRef<ReactZoomPanPinchRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Default to "only show what you can still claim" — the player's
  // typical question is "where can I drop another extractor?", not
  // "where are the nodes I've already wired up?".
  const [showClaimedToo, setShowClaimedToo] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const visibleNodes = useMemo(() => {
    const data = nodes.data ?? [];
    return showClaimedToo ? data : data.filter((n) => !n.claim);
  }, [nodes.data, showClaimedToo]);

  const selectedNode = useMemo(
    () => visibleNodes.find((n) => n.id === selectedNodeId) ?? null,
    [visibleNodes, selectedNodeId],
  );

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
              Scroll to zoom, drag to pan. Click a node to claim it; drag a
              factory pin to place it. The planner uses these coords for
              "nearest claimed node" hints.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={showClaimedToo}
              onChange={(e) => setShowClaimedToo(e.target.checked)}
            />
            Show claimed nodes too
          </label>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="relative">
          {/* Zoom controls — overlaid on the map so they stay reachable
              regardless of pan state. react-zoom-pan-pinch's built-in
              controls are minimal, so we render our own to keep the
              brand styling consistent. */}
          <div className="absolute right-3 top-3 z-20 flex flex-col gap-1">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => wrapRef.current?.zoomIn()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-raised/90 text-fg hover:bg-bg-raised"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => wrapRef.current?.zoomOut()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-raised/90 text-fg hover:bg-bg-raised"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Reset view"
              onClick={() => wrapRef.current?.resetTransform()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-raised/90 text-fg hover:bg-bg-raised"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          <div ref={containerRef} className="h-[700px] w-full bg-black/40">
            <TransformWrapper
              ref={wrapRef}
              minScale={0.4}
              maxScale={6}
              initialScale={0.6}
              limitToBounds={false}
              // Wheel step is the multiplier per tick — the lib's
              // default 0.2 is huge on a Mac trackpad (every scroll
              // event is a "tick"), so a regular two-finger flick
              // zooms 5×+ in a single frame. 0.03 keeps zoom smooth.
              wheel={{ step: 0.03, smoothStep: 0.003 }}
              doubleClick={{ disabled: true }}
              // Only drag the canvas when the user grabs the background
              // — clicks on markers/pins shouldn't initiate a pan.
              panning={{ excluded: ["specs-map-marker", "specs-map-pin"] }}
            >
              <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%" }}
                contentStyle={{ width: MAP_W, height: MAP_H }}
              >
                <div
                  className="relative"
                  style={{ width: MAP_W, height: MAP_H }}
                  onClick={() => setSelectedNodeId(null)}
                >
                  <img
                    src={mapAsset}
                    alt="Satisfactory map"
                    className="absolute inset-0 h-full w-full"
                    draggable={false}
                  />

                  {visibleNodes.map((node) => {
                    const { xPct, yPct } = worldToPct(node.x, node.y);
                    const selected = selectedNodeId === node.id;
                    const size = node.claim ? 14 : 10;
                    return (
                      <button
                        type="button"
                        key={node.id}
                        className="specs-map-marker absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/40 transition-transform hover:scale-125"
                        style={{
                          left: `${xPct * MAP_W}px`,
                          top: `${yPct * MAP_H}px`,
                          width: size,
                          height: size,
                          background:
                            PURITY_COLOURS[node.purity as keyof typeof PURITY_COLOURS],
                          opacity: node.claim ? 1 : 0.6,
                          outline: selected ? "2px solid var(--color-primary)" : undefined,
                          outlineOffset: 2,
                        }}
                        title={`${node.resourceItemName} · ${node.purity}${node.claim ? ` · ${node.itemsPerMinute.toFixed(0)} ipm` : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNodeId(node.id === selectedNodeId ? null : node.id);
                        }}
                      />
                    );
                  })}

                  {(factories.data ?? []).map((f) => (
                    <FactoryPin
                      key={f.id}
                      factory={f}
                      dragging={dragging === f.id}
                      onDragStart={() => setDragging(f.id)}
                      onDragEnd={(pt) => {
                        setDragging(null);
                        const { worldX, worldY } = pctToWorld(
                          pt.x / MAP_W,
                          pt.y / MAP_H,
                        );
                        void factoryApi
                          .setPosition({ id: f.id, worldX, worldY })
                          .finally(() => factories.refetch());
                      }}
                      currentScale={() => wrapRef.current?.state.scale ?? 1}
                    />
                  ))}
                </div>
              </TransformComponent>
            </TransformWrapper>
          </div>

          {/* Selected-node popover. Floats over the map so the user
              doesn't lose their pan/zoom state when claiming. */}
          {selectedNode && (
            <div className="absolute bottom-3 left-3 z-20">
              <NodePopover
                node={selectedNode}
                factories={factories.data ?? []}
                onClaim={(input) => {
                  void setClaim
                    .mutateAsync({
                      nodeId: selectedNode.id,
                      ...input,
                    })
                    .then(() => setSelectedNodeId(null));
                }}
                onRelease={() => {
                  void clearClaim
                    .mutateAsync(selectedNode.id)
                    .then(() => setSelectedNodeId(null));
                }}
                onClose={() => setSelectedNodeId(null)}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

interface FactoryPinProps {
  factory: { id: string; name: string; worldX: number; worldY: number; iconId?: string };
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: (pt: { x: number; y: number }) => void;
  /** Reads the current zoom scale from the wrapper so pixel deltas
      from drag events translate into world deltas correctly. */
  currentScale: () => number;
}

function FactoryPin({ factory, onDragStart, onDragEnd, currentScale }: FactoryPinProps) {
  const { xPct, yPct } = worldToPct(factory.worldX, factory.worldY);
  const startRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const baseX = xPct * MAP_W;
  const baseY = yPct * MAP_H;
  const px = hoverPos?.x ?? baseX;
  const py = hoverPos?.y ?? baseY;

  return (
    <button
      type="button"
      className="specs-map-pin absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-md border-2 border-primary bg-bg-raised/95 px-2 py-1 text-[11px] font-medium text-fg shadow-sm hover:bg-bg-raised active:cursor-grabbing"
      style={{ left: `${px}px`, top: `${py}px` }}
      title={`${factory.name} (drag to move)`}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startRef.current = {
          x: baseX,
          y: baseY,
          clientX: e.clientX,
          clientY: e.clientY,
        };
        onDragStart();
        const onMove = (ev: MouseEvent) => {
          const s = startRef.current;
          if (!s) return;
          const scale = currentScale();
          const dx = (ev.clientX - s.clientX) / scale;
          const dy = (ev.clientY - s.clientY) / scale;
          setHoverPos({ x: s.x + dx, y: s.y + dy });
        };
        const onUp = (ev: MouseEvent) => {
          const s = startRef.current;
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          startRef.current = null;
          if (!s) return;
          const scale = currentScale();
          const dx = (ev.clientX - s.clientX) / scale;
          const dy = (ev.clientY - s.clientY) / scale;
          setHoverPos(null);
          onDragEnd({ x: s.x + dx, y: s.y + dy });
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    >
      {factory.iconId ? (
        <span className="inline-flex items-center gap-1">
          <Icon itemId={factory.iconId} alt={factory.name} className="h-4 w-4" />
          {factory.name}
        </span>
      ) : (
        factory.name
      )}
    </button>
  );
}

interface NodePopoverProps {
  node: ResourceNodeRow;
  factories: { id: string; name: string }[];
  onClaim: (input: {
    minerId: string | null;
    clockPct: number;
    factoryId: string | null;
    notes: string | null;
  }) => void;
  onRelease: () => void;
  onClose: () => void;
}

function NodePopover({ node, factories, onClaim, onRelease, onClose }: NodePopoverProps) {
  const [minerId, setMinerId] = useState<string>(
    node.claim?.minerId ??
      (node.kind === "fracking_well"
        ? "Build_FrackingSmasher_C"
        : "Build_MinerMk1_C"),
  );
  const [clockPct, setClockPct] = useState(node.claim?.clockPct ?? 100);
  const [factoryId, setFactoryId] = useState(node.claim?.factoryId ?? "");

  return (
    <Card className="w-[300px] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Icon itemId={node.resourceItemId} className="h-4 w-4" />
            {node.resourceItemName} · {node.purity}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-muted">
            {(node.x / 100000).toFixed(1)}km E ·{" "}
            {(node.y / 100000).toFixed(1)}km N
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
        >
          ×
        </button>
      </div>

      {node.kind !== "geyser" && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <label className="block">
            <span className="text-fg-muted">Extractor</span>
            <select
              value={minerId}
              onChange={(e) => setMinerId(e.target.value)}
              className="mt-1 h-7 w-full rounded-md border border-border bg-bg px-1.5 text-[12px] text-fg outline-none focus:border-primary"
            >
              {node.kind === "fracking_well" ? (
                <option value="Build_FrackingSmasher_C">Well Extractor</option>
              ) : (
                <>
                  <option value="Build_MinerMk1_C">Miner Mk1</option>
                  <option value="Build_MinerMk2_C">Miner Mk2</option>
                  <option value="Build_MinerMk3_C">Miner Mk3</option>
                </>
              )}
            </select>
          </label>
          <label className="block">
            <span className="text-fg-muted">Clock {clockPct}%</span>
            <input
              type="range"
              min={1}
              max={250}
              step={1}
              value={clockPct}
              onChange={(e) => setClockPct(Number(e.target.value))}
              className="mt-2 h-2 w-full accent-primary"
            />
          </label>
        </div>
      )}

      <label className="mt-2 block text-xs">
        <span className="text-fg-muted">Factory</span>
        <select
          value={factoryId}
          onChange={(e) => setFactoryId(e.target.value)}
          className="mt-1 h-7 w-full rounded-md border border-border bg-bg px-1.5 text-[12px] text-fg outline-none focus:border-primary"
        >
          <option value="">— none —</option>
          {factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 flex items-center justify-end gap-2">
        {node.claim && (
          <Button variant="ghost" onClick={onRelease} className="px-2 py-1 text-xs">
            Release
          </Button>
        )}
        <Button
          onClick={() =>
            onClaim({
              minerId: node.kind === "geyser" ? null : minerId,
              clockPct,
              factoryId: factoryId.trim() === "" ? null : factoryId,
              notes: null,
            })
          }
          className="px-3 py-1 text-xs"
        >
          {node.claim ? "Update" : "Claim"}
        </Button>
      </div>
    </Card>
  );
}
