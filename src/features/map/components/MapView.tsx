import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Minus, Plus, RotateCcw } from "lucide-react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useFactoryDetail, useFactoryList } from "@/features/factory/hooks/useFactories";
import {
  useClearNodeClaim,
  useResourceNodes,
  useSetNodeClaim,
} from "@/features/resources/hooks/useResources";
import { factoryApi } from "@/features/factory/api";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";
import { useNavStore } from "@/shared/nav-store";
import { Factory as FactoryGlyph, Pencil } from "lucide-react";

import mapAsset from "@/assets/map/satisfactory-map.webp";

import { pctToWorld, worldToPct } from "../transform";
import type { ResourceNodeRow } from "@/features/resources/types";

const PURITY_GLOW = {
  Pure: "0 0 0 2px rgba(250, 204, 21, 0.95), 0 0 12px 3px rgba(250, 204, 21, 0.55)",
  Normal: "0 0 0 2px rgba(203, 213, 225, 0.95), 0 0 10px 2px rgba(203, 213, 225, 0.45)",
  Impure: "0 0 0 2px rgba(180, 83, 9, 0.95), 0 0 8px 2px rgba(180, 83, 9, 0.45)",
} as const;

/**
 * Resource icons aren't always the same as the item icon for the
 * extracted thing (Geysers in particular don't have a bundled item
 * icon since they aren't a craftable). Map the catalog's
 * `resourceItemId` to whatever icon best represents the node on the
 * map.
 */
function markerIconId(resourceItemId: string): string {
  if (resourceItemId === "Desc_Geyser_C") return "Build_GeneratorGeoThermal_C";
  return resourceItemId;
}

// Image dimensions of the bundled WebP. Must stay in lockstep with
// `scripts/fetch-map.ts` — zoom-4 stitch (2560²) cropped to the
// inner 80% playable rect = 2048². The world-coord transform in
// `transform.ts` is independent of these constants; pct-of-image
// gets multiplied by these to land on pixel offsets inside the
// canvas.
const MAP_W = 2048;
const MAP_H = 2048;

// localStorage keys for the map filter state — bumped suffix on shape
// changes if we ever extend what's persisted.
const STORAGE = {
  showClaimed: "specs:map:showClaimedToo",
  hiddenResources: "specs:map:hiddenResources",
  hiddenPurities: "specs:map:hiddenPurities",
} as const;

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  } catch {
    return fallback;
  }
}

function readStringArray(key: string): string[] {
  try {
    const v = localStorage.getItem(key);
    if (!v) return [];
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function MapView() {
  const playthrough = useCurrentPlaythrough();
  const factories = useFactoryList();
  const nodes = useResourceNodes();
  const setClaim = useSetNodeClaim();
  const clearClaim = useClearNodeClaim();
  const wrapRef = useRef<ReactZoomPanPinchRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Filter state survives reloads via localStorage — the player set
  // these to suit how they're working, surfacing a fresh default
  // every launch would be a step back. Stored globally (not per-
  // playthrough) because filter intent travels with the user, not
  // their save file.
  const [showClaimedToo, setShowClaimedToo] = useState(() =>
    readBool(STORAGE.showClaimed, false),
  );
  const [hiddenResources, setHiddenResourcesState] = useState<Set<string>>(() =>
    new Set(readStringArray(STORAGE.hiddenResources)),
  );
  const [hiddenPurities, setHiddenPuritiesState] = useState<Set<string>>(() =>
    new Set(readStringArray(STORAGE.hiddenPurities)),
  );
  const setHiddenResources: typeof setHiddenResourcesState = (action) => {
    setHiddenResourcesState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      writeStringArray(STORAGE.hiddenResources, Array.from(next));
      return next;
    });
  };
  const setHiddenPurities: typeof setHiddenPuritiesState = (action) => {
    setHiddenPuritiesState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      writeStringArray(STORAGE.hiddenPurities, Array.from(next));
      return next;
    });
  };
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE.showClaimed, showClaimedToo ? "1" : "0");
    } catch {}
  }, [showClaimedToo]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const resourceTypes = useMemo(() => {
    const m = new Map<string, { id: string; name: string; total: number }>();
    for (const n of nodes.data ?? []) {
      const entry = m.get(n.resourceItemId);
      if (entry) entry.total++;
      else m.set(n.resourceItemId, { id: n.resourceItemId, name: n.resourceItemName, total: 1 });
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes.data]);

  const visibleNodes = useMemo(() => {
    const data = nodes.data ?? [];
    return data.filter((n) => {
      if (!showClaimedToo && n.claim) return false;
      if (hiddenResources.has(n.resourceItemId)) return false;
      if (hiddenPurities.has(n.purity)) return false;
      return true;
    });
  }, [nodes.data, showClaimedToo, hiddenResources, hiddenPurities]);

  const selectedNode = useMemo(
    () => visibleNodes.find((n) => n.id === selectedNodeId) ?? null,
    [visibleNodes, selectedNodeId],
  );

  const toggleSet = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

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

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 text-fg-muted">Resources:</span>
          {resourceTypes.map((r) => {
            const hidden = hiddenResources.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setHiddenResources((s) => toggleSet(s, r.id))}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                  hidden
                    ? "border-border bg-bg text-fg-muted line-through"
                    : "border-primary/50 bg-primary/10 text-fg"
                }`}
                title={hidden ? `Show ${r.name}` : `Hide ${r.name}`}
              >
                <Icon itemId={markerIconId(r.id)} alt="" className="h-3.5 w-3.5" />
                {r.name}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 text-fg-muted">Purity:</span>
          {(["Pure", "Normal", "Impure"] as const).map((p) => {
            const hidden = hiddenPurities.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => setHiddenPurities((s) => toggleSet(s, p))}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                  hidden
                    ? "border-border bg-bg text-fg-muted line-through"
                    : "border-primary/50 bg-primary/10 text-fg"
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background:
                      p === "Pure" ? "#facc15" : p === "Normal" ? "#94a3b8" : "#b45309",
                  }}
                />
                {p}
              </button>
            );
          })}
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
              wheel={{ step: 0.03 }}
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
                    const size = 24;
                    const tooltip = `${node.resourceItemName} · ${node.purity}${
                      node.claim
                        ? ` · ${node.itemsPerMinute.toFixed(0)} ipm`
                        : " · click to claim"
                    }`;
                    return (
                      <button
                        type="button"
                        key={node.id}
                        aria-label={tooltip}
                        title={tooltip}
                        className="specs-map-marker absolute -translate-x-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-full bg-bg-raised transition-transform hover:scale-125"
                        style={{
                          left: `${xPct * MAP_W}px`,
                          top: `${yPct * MAP_H}px`,
                          width: size,
                          height: size,
                          // The purity glow doubles as a ring so each
                          // node still reads as "Pure / Normal /
                          // Impure" at a glance even with the icon
                          // taking the centre. Unclaimed gets the
                          // glow at 70% opacity to keep claimed
                          // nodes visually dominant when both layers
                          // are visible.
                          boxShadow:
                            PURITY_GLOW[node.purity as keyof typeof PURITY_GLOW],
                          opacity: node.claim ? 1 : 0.78,
                          outline: selected
                            ? "2px solid var(--color-primary)"
                            : undefined,
                          outlineOffset: 3,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNodeId(
                            node.id === selectedNodeId ? null : node.id,
                          );
                        }}
                      >
                        <Icon
                          itemId={markerIconId(node.resourceItemId)}
                          alt=""
                          className="h-4 w-4"
                        />
                      </button>
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
                      onClick={() => {
                        setSelectedNodeId(null);
                        setSelectedFactoryId(f.id);
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

          {selectedFactoryId && (
            <div className="absolute bottom-3 left-3 z-20">
              <FactoryPopover
                factoryId={selectedFactoryId}
                onEdit={() => {
                  useNavStore.getState().selectFactory(selectedFactoryId);
                  useNavStore.getState().goTo("factories");
                  setSelectedFactoryId(null);
                }}
                onClose={() => setSelectedFactoryId(null)}
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
  /** Fires when the mouseup happens within `CLICK_THRESHOLD_PX` of mousedown — treat as a click, not a drag. */
  onClick: () => void;
  /** Reads the current zoom scale from the wrapper so pixel deltas
      from drag events translate into world deltas correctly. */
  currentScale: () => number;
}

// Mousedown→up movement under this distance (in screen pixels) counts
// as a click instead of a drag. Trackpads register tiny jitter even on
// a real "click", so 4 px is safer than 0.
const CLICK_THRESHOLD_PX = 4;

function FactoryPin({ factory, onDragStart, onDragEnd, onClick, currentScale }: FactoryPinProps) {
  const { xPct, yPct } = worldToPct(factory.worldX, factory.worldY);
  const startRef = useRef<{
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    moved: boolean;
  } | null>(null);
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
      title={`${factory.name} — click for details, drag to move`}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startRef.current = {
          x: baseX,
          y: baseY,
          clientX: e.clientX,
          clientY: e.clientY,
          moved: false,
        };
        const onMove = (ev: MouseEvent) => {
          const s = startRef.current;
          if (!s) return;
          const dxScreen = ev.clientX - s.clientX;
          const dyScreen = ev.clientY - s.clientY;
          // Don't start the drag UI until the pointer moves past the
          // click threshold — otherwise a plain click flashes the pin
          // through a no-op "drag" before re-rendering at its origin.
          if (!s.moved && Math.hypot(dxScreen, dyScreen) >= CLICK_THRESHOLD_PX) {
            s.moved = true;
            onDragStart();
          }
          if (s.moved) {
            const scale = currentScale();
            setHoverPos({ x: s.x + dxScreen / scale, y: s.y + dyScreen / scale });
          }
        };
        const onUp = (ev: MouseEvent) => {
          const s = startRef.current;
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          startRef.current = null;
          if (!s) return;
          if (!s.moved) {
            // Plain click — open the factory card popover instead.
            setHoverPos(null);
            onClick();
            return;
          }
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

interface FactoryPopoverProps {
  factoryId: string;
  onEdit: () => void;
  onClose: () => void;
}

function FactoryPopover({ factoryId, onEdit, onClose }: FactoryPopoverProps) {
  const detail = useFactoryDetail(factoryId);
  const f = detail.data?.factory;
  const ledger = detail.data?.ledger;
  return (
    <Card className="w-[320px] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {f?.iconId ? (
            <Icon itemId={f.iconId} alt="" className="h-6 w-6" />
          ) : (
            <FactoryGlyph className="h-5 w-5 text-fg-muted" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">
              {f?.name ?? "Loading…"}
            </div>
            <div className="text-[11px] text-fg-muted tabular-nums">
              {detail.data
                ? `${detail.data.machines.length} machine${detail.data.machines.length === 1 ? "" : "s"} · ${ledger?.powerMw.toFixed(1)} MW`
                : ""}
            </div>
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

      {detail.data && ledger && ledger.flows.length > 0 && (
        <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-[11px]">
          {ledger.flows.slice(0, 8).map((flow) => (
            <li
              key={flow.itemId}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon itemId={flow.itemId} alt="" className="h-3.5 w-3.5" />
                <span className="truncate">{flow.itemName}</span>
              </span>
              <span
                className={`tabular-nums ${
                  flow.netPerMinute > 0.001
                    ? "text-success"
                    : flow.netPerMinute < -0.001
                      ? "text-danger"
                      : "text-fg-muted"
                }`}
              >
                {flow.netPerMinute > 0 ? "+" : ""}
                {flow.netPerMinute.toFixed(1)}/min
              </span>
            </li>
          ))}
          {ledger.flows.length > 8 && (
            <li className="pt-1 text-center text-fg-muted">
              + {ledger.flows.length - 8} more
            </li>
          )}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button onClick={onEdit} className="px-3 py-1 text-xs">
          <Pencil className="h-3 w-3" />
          Edit factory
        </Button>
      </div>
    </Card>
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
            <Icon itemId={markerIconId(node.resourceItemId)} className="h-4 w-4" />
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
