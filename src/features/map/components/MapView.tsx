import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LocateFixed, MapPin, Minus, Plus, RotateCcw } from "lucide-react";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import {
  useCreateFactory,
  useFactoryDetail,
  useFactoryList,
  useUnsourcedInputs,
} from "@/features/factory/hooks/useFactories";
import { useItems, useRecipes } from "@/features/library/hooks/useLibrary";
import { TierBadge } from "@/features/library/components/TierBadge";
import { traceRawDemand } from "@/features/factory/traceRaw";
import { useLogisticsLinks } from "@/features/logistics/hooks/useLogistics";
import { useAllPowerGens } from "@/features/power/hooks/usePower";
import {
  useClearNodeClaim,
  useDeleteWaterGroup,
  useResourceNodes,
  useSetNodeClaim,
  useSetWaterGroup,
  useWaterExtractorGroups,
} from "@/features/resources/hooks/useResources";
import { factoryApi } from "@/features/factory/api";
import { plannerApi } from "@/features/planner/api";
import type { UnsourcedInput } from "@/features/planner/types";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";
import { openPlanDesigner, useNavStore } from "@/shared/nav-store";
import {
  CircleAlert,
  Droplets,
  Factory as FactoryGlyph,
  GripVertical,
  Maximize2,
  Minimize2,
  Unlink,
  Workflow,
  Zap,
} from "lucide-react";

import { MapLinksLayer, NodeBindingLinesLayer } from "./MapLinksLayer";
import {
  clampLoadoutMinerId,
  PlacementLoadout,
  readLoadout,
  writeLoadout,
  type MapLoadout,
} from "./PlacementLoadout";
import { WaterExtractorPin, WaterExtractorPopover } from "./WaterExtractors";
import { ResourceBudgetPanel } from "@/features/resources/components/ResourceBudgetPanel";
import type { PortCapacityFinding } from "@/features/resources/components/NodeRow";
import { useValidation } from "@/features/validation/hooks/useValidation";
import { floorClockPct } from "@/features/validation/clock";
import { ClockInput } from "@/shared/ui/ClockInput";

import mapAsset from "@/assets/map/satisfactory-map.webp";

import { factoryPickerOptions, pctToWorld, worldToPct, type FactoryPickerCandidate } from "../transform";
import { claimDefaultExtractor, coordChip, nodeKindLabel } from "@/features/resources/display";
import type { ResourceNodeRow, WaterExtractorGroup } from "@/features/resources/types";
import { FilterSelect } from "@/shared/ui/FilterSelect";

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

/**
 * A node marker's tooltip/aria-label. A claimed node's marker is the
 * map's only record of which factory that claim feeds — a bare
 * "Iron Ore · Normal · 30 ipm" can't answer "which factory?" without
 * opening the card, so a claimed node's tooltip names the factory and
 * repeats the coordinates. Unclaimed nodes keep the plain bind hint;
 * there's no claim to describe yet. Exported so a regression test can
 * pin the exact string for a known node + claim.
 */
export function nodeTooltip(
  node: Pick<
    ResourceNodeRow,
    "resourceItemName" | "purity" | "x" | "y" | "itemsPerMinute" | "claim" | "kind" | "resourceItemId"
  >,
  factoryNameById: Map<string, string>,
): string {
  const kindLabel = nodeKindLabel(node);
  const base = kindLabel
    ? `${node.resourceItemName} · ${node.purity} · ${kindLabel}`
    : `${node.resourceItemName} · ${node.purity}`;
  if (!node.claim) return `${base} · click to bind or drag onto a factory`;
  const factoryLabel = node.claim.factoryId
    ? factoryNameById.get(node.claim.factoryId) ?? "unknown factory"
    : "no factory yet";
  return `${base} · ${node.itemsPerMinute.toFixed(0)} ipm · ${coordChip(node.x, node.y)} · feeds ${factoryLabel}`;
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
// Droplet-shaped cursor while water placement is armed — the mode is
// visible at the pointer itself, not just on the armed button.
const WATER_CURSOR = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="%2338bdf8" stroke="white" stroke-width="1.5"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>'.replace('%2338bdf8', '#38bdf8'),
)}") 12 22, crosshair`;

// Every one of these is about "what this playthrough's map looks
// like right now" — pan/zoom position, which resources/links/water
// are on screen — not a personal tool preference, so each key gets
// suffixed with the active playthrough id (see `scopedKey`). Without
// that, opening a fresh playthrough reopens the previous one's view:
// scrolled to its factories, filtered to what it was filtered to.
const STORAGE = {
  showClaimed: "specs:map:showClaimedToo",
  hiddenResources: "specs:map:hiddenResources",
  hiddenPurities: "specs:map:hiddenPurities",
  showAllLinks: "specs:map:showAllLinks",
  showWater: "specs:map:showWaterExtractors",
  transform: "specs:map:transform",
} as const;

function scopedKey(base: string, playthroughId: string | null): string {
  return playthroughId ? `${base}:${playthroughId}` : base;
}

// Where the Reset button returns to, and the initial value used for a
// frame or two before the fit-to-container effect further down
// measures the real container and replaces it.
const DEFAULT_SCALE = 0.6;

/** Last pan/zoom state, restored on mount so leaving the tab and
 * coming back continues exactly where the user was. */
function readTransform(key: string): { scale: number; x: number; y: number } | null {
  try {
    const v = localStorage.getItem(key);
    if (!v) return null;
    const p: unknown = JSON.parse(v);
    if (
      typeof p === "object" && p !== null &&
      typeof (p as { scale?: unknown }).scale === "number" &&
      typeof (p as { x?: unknown }).x === "number" &&
      typeof (p as { y?: unknown }).y === "number"
    ) {
      const t = p as { scale: number; x: number; y: number };
      if (
        Number.isFinite(t.scale) && t.scale >= 0.4 && t.scale <= 6 &&
        Number.isFinite(t.x) && Number.isFinite(t.y)
      ) {
        return t;
      }
    }
  } catch {}
  return null;
}

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
  // Every STORAGE.* key above is read/written scoped to this id (see
  // `scopedKey`) — `null` while the query is still loading, which is
  // fine, since nothing that reads it renders until `playthrough.data`
  // exists (the early return below). A plain const, not state: it
  // only has to be current at the moment each callback runs, and
  // recomputing it every render keeps every inline reader (event
  // handlers, the persist-on-change effects below) trivially fresh
  // without a stale-closure risk.
  const playthroughId = playthrough.data?.id ?? null;
  // Effects that persist-on-change (as opposed to callbacks that write
  // inline) can't depend on `playthroughId` directly — if they did,
  // switching playthroughs would fire them with the *previous*
  // playthrough's still-in-state value, writing it into the *new*
  // playthrough's key before the reset effect below gets a chance to
  // load the new key's own value. This ref lets them read the current
  // id without depending on it.
  const playthroughIdRef = useRef(playthroughId);
  playthroughIdRef.current = playthroughId;
  const factories = useFactoryList();
  const nodes = useResourceNodes();
  const links = useLogisticsLinks();
  const items = useItems();
  const powerGens = useAllPowerGens();
  const unsourcedInputs = useUnsourcedInputs();
  const waterGroups = useWaterExtractorGroups();
  const setClaim = useSetNodeClaim();
  const clearClaim = useClearNodeClaim();
  const setWaterGroup = useSetWaterGroup();
  const deleteWaterGroup = useDeleteWaterGroup();
  const createFactory = useCreateFactory();
  const queryClient = useQueryClient();
  const wrapRef = useRef<ReactZoomPanPinchRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Saved pan/zoom — read once on mount; every transform change
  // (throttled) writes it back so returning to the tab restores the
  // exact view. `playthroughId` is usually still null on the very
  // first render (the query hasn't resolved), which is harmless: the
  // "no playthrough" early return means nothing reads this value
  // until the playthrough-switch effect below has already corrected
  // it for the real id.
  const [initialTransform] = useState(() =>
    readTransform(scopedKey(STORAGE.transform, playthroughId)),
  );
  const saveTransformTimer = useRef<number | null>(null);
  const persistTransform = (state: { scale: number; positionX: number; positionY: number }) => {
    if (saveTransformTimer.current) window.clearTimeout(saveTransformTimer.current);
    saveTransformTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(
          scopedKey(STORAGE.transform, playthroughIdRef.current),
          JSON.stringify({ scale: state.scale, x: state.positionX, y: state.positionY }),
        );
      } catch {}
    }, 150);
  };
  // Live zoom scale, tracked so node markers can counter-scale
  // themselves — see markerScreenScale below. Rounded to 2 decimals
  // so a continuous wheel/pinch gesture doesn't force a re-render of
  // every marker on every sub-pixel tick; the resulting steps are
  // imperceptible.
  const [zoomScale, setZoomScale] = useState(initialTransform?.scale ?? DEFAULT_SCALE);

  // A fresh map (no saved pan/zoom for this playthrough) opened at the
  // fixed DEFAULT_SCALE regardless of window size — on a typical
  // widescreen window the 2048px map rendered at 0.6x (~1229px) didn't
  // reach the canvas's right edge, leaving several hundred px of bare
  // canvas visible. Covering the container (rather than fitting inside
  // it, the way `PlanGraphCanvas`'s `fitView` does) is the right model
  // here — unlike a plan graph, the map is meant to be panned, so it's
  // fine for the map to run past the container in one axis as long as
  // neither axis leaves canvas showing. A ResizeObserver rather than a
  // plain effect: the container can still be 0×0 on this component's
  // first render (e.g. the playthrough query hasn't resolved yet, which
  // renders the empty-state Card below instead of this one), the same
  // measurement problem `useNodesInitialized` exists for over there.
  useEffect(() => {
    if (initialTransform) return; // a saved view always wins
    const el = containerRef.current;
    if (!el) return;
    let applied = false;
    const observer = new ResizeObserver(([entry]) => {
      if (applied) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      applied = true;
      const cover = Math.max(width / MAP_W, height / MAP_H);
      const scale = Math.min(Math.max(cover, 0.4), 6); // matches TransformWrapper's own min/maxScale
      wrapRef.current?.setTransform(0, 0, scale, 0);
      observer.disconnect();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [initialTransform]);

  // Filter state survives reloads via localStorage, scoped per
  // playthrough (see the STORAGE comment above) — this is what's on
  // screen for *this* factory network, not a personal tool
  // preference, so a fresh playthrough must not inherit it.
  //
  // Claimed nodes default to visible: hiding them by default made a
  // claim disappear from the map — and therefore unreachable to view,
  // edit or unclaim — the moment it was made, with no cue that a
  // "Show claimed nodes too" toggle exists to bring it back. The
  // toggle survives as an opt-out for players who want to declutter
  // while hunting fresh nodes.
  const [showClaimedToo, setShowClaimedToo] = useState(() =>
    readBool(scopedKey(STORAGE.showClaimed, playthroughId), true),
  );
  const [hiddenResources, setHiddenResourcesState] = useState<Set<string>>(() =>
    new Set(readStringArray(scopedKey(STORAGE.hiddenResources, playthroughId))),
  );
  const [hiddenPurities, setHiddenPuritiesState] = useState<Set<string>>(() =>
    new Set(readStringArray(scopedKey(STORAGE.hiddenPurities, playthroughId))),
  );
  const setHiddenResources: typeof setHiddenResourcesState = (action) => {
    setHiddenResourcesState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      writeStringArray(scopedKey(STORAGE.hiddenResources, playthroughId), Array.from(next));
      return next;
    });
  };
  const setHiddenPurities: typeof setHiddenPuritiesState = (action) => {
    setHiddenPuritiesState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      writeStringArray(scopedKey(STORAGE.hiddenPurities, playthroughId), Array.from(next));
      return next;
    });
  };
  useEffect(() => {
    // Nothing interactive renders before a playthrough is open (see
    // the early return below), so the only way this fires with a null
    // id is the initial mount's default value, before the switch
    // effect has had a chance to load the real one — skip it rather
    // than stamping the default onto the unscoped legacy key.
    if (playthroughIdRef.current === null) return;
    try {
      localStorage.setItem(
        scopedKey(STORAGE.showClaimed, playthroughIdRef.current),
        showClaimedToo ? "1" : "0",
      );
    } catch {}
  }, [showClaimedToo]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);
  const [selectedWaterGroupId, setSelectedWaterGroupId] = useState<string | null>(null);
  // "What I'm currently placing": miner mark + clock for claims, count
  // + clock defaults for water groups. Scoped per playthrough — the
  // bug this fixes (#64/#57) was a higher-tier run's mark bleeding
  // into a fresh Tier 0 one through this exact key.
  const [loadout, setLoadoutState] = useState<MapLoadout>(() => readLoadout(playthroughId));
  const setLoadout = (next: MapLoadout) => {
    setLoadoutState(next);
    writeLoadout(next, playthroughId);
  };
  // Tier-eligible miner marks for the placement loadout, sourced from
  // any real miner-ore row's (already tier-filtered server-side)
  // allowedExtractors — every such row shares the same list, so one
  // sample is the whole map's answer. Oil seeps carry a single
  // Oil-Extractor option instead of miner marks, hence the id check.
  const minerMarkOptions = useMemo(() => {
    const sample = (nodes.data ?? []).find((n) =>
      n.allowedExtractors.some((e) => e.id.startsWith("Build_MinerMk")),
    );
    return sample?.allowedExtractors ?? [];
  }, [nodes.data]);
  // The loadout as it should actually be used: the persisted preference
  // when it's still tier-eligible, otherwise the best mark the
  // playthrough has actually reached. Corrects a stale `localStorage`
  // mark (e.g. carried over from a higher-tier playthrough, or from
  // before this gate existed) without an effect + re-render round trip.
  const effectiveLoadout = useMemo(
    () => clampLoadoutMinerId(loadout, minerMarkOptions),
    [loadout, minerMarkOptions],
  );
  // Armed water placement: the next map click drops a group there.
  // The cursor itself becomes a droplet so the mode is unmissable.
  const [placingWater, setPlacingWater] = useState(false);
  // Armed factory placement: the next map click opens the name
  // popover at that spot — place first, name second.
  const [placingFactory, setPlacingFactory] = useState(false);
  useEffect(() => {
    if (!placingWater && !placingFactory) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlacingWater(false);
        setPlacingFactory(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placingWater, placingFactory]);
  const [showAllLinks, setShowAllLinks] = useState(() =>
    readBool(scopedKey(STORAGE.showAllLinks, playthroughId), true),
  );
  // Bound water groups hide unless their factory is selected — same
  // rule as claimed nodes. This toggle force-shows them all.
  const [showWaterExtractors, setShowWaterExtractors] = useState(() =>
    readBool(scopedKey(STORAGE.showWater, playthroughId), false),
  );
  useEffect(() => {
    if (playthroughIdRef.current === null) return;
    try {
      localStorage.setItem(
        scopedKey(STORAGE.showWater, playthroughIdRef.current),
        showWaterExtractors ? "1" : "0",
      );
    } catch {}
  }, [showWaterExtractors]);
  useEffect(() => {
    if (playthroughIdRef.current === null) return;
    try {
      localStorage.setItem(
        scopedKey(STORAGE.showAllLinks, playthroughIdRef.current),
        showAllLinks ? "1" : "0",
      );
    } catch {}
  }, [showAllLinks]);
  // Re-reads every playthrough-scoped piece of state above (plus the
  // live pan/zoom, applied imperatively since it isn't React state)
  // whenever the active playthrough actually changes — including the
  // very first time `playthroughId` resolves from `null`. The
  // `useState(fn)` initializers above only ever run once, at mount,
  // so without this a playthrough switch (no remount — see
  // AppShell's single `<MapView />`) would leave every filter and the
  // camera showing the *previous* playthrough's view.
  const prevPlaythroughIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (playthroughId === prevPlaythroughIdRef.current) return;
    prevPlaythroughIdRef.current = playthroughId;
    setShowClaimedToo(readBool(scopedKey(STORAGE.showClaimed, playthroughId), true));
    setHiddenResourcesState(new Set(readStringArray(scopedKey(STORAGE.hiddenResources, playthroughId))));
    setHiddenPuritiesState(new Set(readStringArray(scopedKey(STORAGE.hiddenPurities, playthroughId))));
    setShowAllLinks(readBool(scopedKey(STORAGE.showAllLinks, playthroughId), true));
    setShowWaterExtractors(readBool(scopedKey(STORAGE.showWater, playthroughId), false));
    setLoadoutState(readLoadout(playthroughId));
    const t = readTransform(scopedKey(STORAGE.transform, playthroughId));
    setZoomScale(t?.scale ?? DEFAULT_SCALE);
    wrapRef.current?.setTransform(t?.x ?? 0, t?.y ?? 0, t?.scale ?? DEFAULT_SCALE, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playthroughId]);
  // Right-click quick-create: where the popover renders (container-
  // relative screen px) and where the factory lands (map px).
  const [quickCreate, setQuickCreate] = useState<{
    screenX: number;
    screenY: number;
    mapX: number;
    mapY: number;
  } | null>(null);
  // Locked water group being dragged onto a factory (node-like bind).
  const [linkingWater, setLinkingWater] = useState<{
    groupId: string;
    fromX: number;
    fromY: number;
  } | null>(null);
  // Drag-to-source: an unsourced input being dragged from the factory
  // popover towards its future source factory. Ghost line anchors at
  // the OWNING factory's pin.
  const [linkingImport, setLinkingImport] = useState<{
    importId: string;
    itemName: string;
    fromX: number;
    fromY: number;
    ownerFactoryId: string;
  } | null>(null);
  // Active drag-to-link state: the node being dragged + the current
  // cursor position (in MAP_W/MAP_H pixel space) so we can draw a
  // ghost line. `linkHoverFactoryId` is set by FactoryPin mouseenter
  // while linking so dropping over a pin commits the bind.
  const [linkingNode, setLinkingNode] = useState<{
    nodeId: string;
    fromX: number;
    fromY: number;
  } | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [linkHoverFactoryId, setLinkHoverFactoryId] = useState<string | null>(
    null,
  );
  // The mouseup handler reads the latest hover target *imperatively*
  // — by the time it fires React's state hasn't necessarily flushed
  // through, so a ref shadows the state for the read path while the
  // state still drives the highlight render.
  const linkHoverFactoryIdRef = useRef<string | null>(null);
  useEffect(() => {
    linkHoverFactoryIdRef.current = linkHoverFactoryId;
  }, [linkHoverFactoryId]);
  // Power-gen selection — the popover that consumes it lands in a
  // follow-up commit; for now setting it just clears the other
  // selection types so click handlers behave predictably.
  const [_selectedPowerGenId, setSelectedPowerGenId] = useState<string | null>(null);
  void _selectedPowerGenId;
  const [dragging, setDragging] = useState<string | null>(null);

  // Bound inputs (claimed nodes + upstream factories) for the
  // currently-selected factory. Drives the SVG line overlay and the
  // "always-show this node even if its filter is off" override.
  const boundNodes = useMemo(() => {
    if (!selectedFactoryId) return [];
    return (nodes.data ?? []).filter((n) => n.claim?.factoryId === selectedFactoryId);
  }, [nodes.data, selectedFactoryId]);

  const boundNodeIds = useMemo(() => new Set(boundNodes.map((n) => n.id)), [boundNodes]);

  const selectedWaterGroup = useMemo(
    () => (waterGroups.data ?? []).find((g) => g.id === selectedWaterGroupId) ?? null,
    [waterGroups.data, selectedWaterGroupId],
  );
  const boundWaterGroups = useMemo(() => {
    if (!selectedFactoryId) return [];
    return (waterGroups.data ?? []).filter((g) => g.factoryId === selectedFactoryId);
  }, [waterGroups.data, selectedFactoryId]);

  // Same visibility rule as nodes: unbound groups always show; bound
  // groups only for their selected factory (or with the toggle on).
  const visibleWaterGroups = useMemo(() => {
    return (waterGroups.data ?? []).filter(
      (g) =>
        showWaterExtractors ||
        !g.factoryId ||
        g.factoryId === selectedFactoryId ||
        g.id === selectedWaterGroupId,
    );
  }, [waterGroups.data, showWaterExtractors, selectedFactoryId, selectedWaterGroupId]);

  // Unsourced inputs per factory → pin badge counts + popover rows.
  const unsourcedByFactory = useMemo(() => {
    const map = new Map<string, UnsourcedInput[]>();
    for (const u of unsourcedInputs.data ?? []) {
      const arr = map.get(u.factoryId) ?? [];
      arr.push(u);
      map.set(u.factoryId, arr);
    }
    return map;
  }, [unsourcedInputs.data]);

  const itemNames = useMemo(
    () => new Map(items.data?.map((i) => [i.id, i.name]) ?? []),
    [items.data],
  );

  const factoryNameById = useMemo(
    () => new Map((factories.data ?? []).map((f) => [f.id, f.name])),
    [factories.data],
  );

  // Same port-capacity sweep the Resources row and Validate panel read
  // from — reused here (never re-derived) so a claim edited on the map
  // can flag "over port cap" too, instead of only being caught once the
  // user leaves the map. `enabled` skips the sweep entirely until
  // there's an active playthrough to check.
  const validation = useValidation(!!playthrough.data);
  const portWarningsByNode = useMemo(() => {
    const map = new Map<string, PortCapacityFinding>();
    for (const f of validation.data?.findings ?? []) {
      if (f.kind === "claimOverPortCapacity") map.set(f.nodeId, f);
    }
    return map;
  }, [validation.data]);

  // Screen → map-pixel conversion for events that don't originate on a
  // map-anchored element (right-click anywhere, popover drag handles).
  const clientToMap = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const state = wrapRef.current?.state;
    if (!rect || !state) return null;
    return {
      x: (clientX - rect.left - state.positionX) / state.scale,
      y: (clientY - rect.top - state.positionY) / state.scale,
    };
  };

  const commitImportSource = (importId: string, sourceFactoryId: string) => {
    void plannerApi
      .assignImportSource(importId, sourceFactoryId)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["factory"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.logistics.list });
      })
      .catch((err: unknown) => {
        console.error("assigning input source failed:", err);
      });
  };

  const resourceTypes = useMemo(() => {
    const m = new Map<string, { id: string; name: string; total: number }>();
    for (const n of nodes.data ?? []) {
      const entry = m.get(n.resourceItemId);
      if (entry) entry.total++;
      else m.set(n.resourceItemId, { id: n.resourceItemId, name: n.resourceItemName, total: 1 });
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes.data]);

  // Drives "Jump to my claims" (#50): four claims among hundreds of
  // nodes means panning by hand to find your own network otherwise.
  const claimedNodes = useMemo(
    () => (nodes.data ?? []).filter((n) => n.claim),
    [nodes.data],
  );
  const jumpToClaims = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || claimedNodes.length === 0) return;
    // Frame every claim's bounding box, not just the first one — a
    // network usually spans more than one node by the time this
    // button matters.
    const xs = claimedNodes.map((n) => n.x);
    const ys = claimedNodes.map((n) => n.y);
    const center = worldToPct((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
    // Same centering the library's own recenter would do — solved
    // from `clientToMap`'s inverse: pick positionX/Y so the target
    // map-pixel lands in the middle of the visible container at the
    // current zoom, rather than resetting zoom (which would also
    // fight a player who's mid-zoom on their own network already).
    const scale = wrapRef.current?.state.scale ?? DEFAULT_SCALE;
    wrapRef.current?.setTransform(
      rect.width / 2 - center.xPct * MAP_W * scale,
      rect.height / 2 - center.yPct * MAP_H * scale,
      scale,
      300,
    );
  };

  const visibleNodes = useMemo(() => {
    const data = nodes.data ?? [];
    return data.filter((n) => {
      // Always show a node if it's an input of the currently-
      // selected factory, regardless of filter state. The user
      // clicked a factory to see its inputs; hiding them because
      // a filter is on would defeat the point.
      if (boundNodeIds.has(n.id)) return true;
      if (!showClaimedToo && n.claim) return false;
      if (hiddenResources.has(n.resourceItemId)) return false;
      if (hiddenPurities.has(n.purity)) return false;
      return true;
    });
  }, [nodes.data, showClaimedToo, hiddenResources, hiddenPurities, boundNodeIds]);

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
    <div className="flex h-full min-h-[600px] flex-col gap-3">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
              <MapPin className="h-4 w-4" />
              Map
            </h1>
            <p className="text-xs text-fg-muted">
              Scroll to zoom, drag to pan. Click a node to claim it; drag a
              factory pin to place it.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={showClaimedToo}
                onChange={(e) => setShowClaimedToo(e.target.checked)}
              />
              Show claimed nodes too
            </label>
            <label
              className="flex items-center gap-2 text-xs text-fg-muted"
              title="Item flows between factories via logistics links — not the lines from claimed nodes to the factory they feed, which are always shown"
            >
              <input
                type="checkbox"
                checked={showAllLinks}
                onChange={(e) => setShowAllLinks(e.target.checked)}
              />
              Show factory→factory links
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={showWaterExtractors}
                onChange={(e) => setShowWaterExtractors(e.target.checked)}
              />
              Show water extractors
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="mr-1 text-fg-muted">Resources:</span>
          {/* Isolating one resource used to cost a click per *other*
              resource (#59) — with 15+ resource types that's over a
              dozen clicks for what should be a two-click "just show me
              iron" gesture. */}
          <button
            type="button"
            onClick={() => setHiddenResources(new Set())}
            className="rounded-full border border-border px-2 py-0.5 text-fg-muted hover:border-primary hover:text-fg"
          >
            Show all
          </button>
          <button
            type="button"
            onClick={() => setHiddenResources(new Set(resourceTypes.map((r) => r.id)))}
            className="rounded-full border border-border px-2 py-0.5 text-fg-muted hover:border-primary hover:text-fg"
          >
            Hide all
          </button>
          {resourceTypes.map((r) => {
            const hidden = hiddenResources.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                onClick={(e) => {
                  // Plain click toggles this one resource. Alt/Option-
                  // click "solos" it — hide every other resource in one
                  // gesture, the fast path the issue asked for. A second
                  // Alt-click on an already-soloed resource undoes it
                  // (shows every resource again) rather than hiding the
                  // last one and leaving the map blank.
                  if (e.altKey) {
                    const isSoloed =
                      !hidden && resourceTypes.every((o) => o.id === r.id || hiddenResources.has(o.id));
                    setHiddenResources(
                      isSoloed
                        ? new Set()
                        : new Set(resourceTypes.filter((o) => o.id !== r.id).map((o) => o.id)),
                    );
                    return;
                  }
                  setHiddenResources((s) => toggleSet(s, r.id));
                }}
                aria-pressed={!hidden}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                  hidden
                    ? "border-border bg-bg text-fg-muted line-through"
                    : "border-primary/50 bg-primary/10 text-fg"
                }`}
                title={`${hidden ? `Show ${r.name}` : `Hide ${r.name}`} · Alt/Option-click to show only ${r.name}`}
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
                aria-pressed={!hidden}
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

      <Card className="flex min-h-0 flex-1 flex-col p-0 overflow-hidden">
        <div className="relative flex-1 min-h-0">
          {/* Zoom controls — overlaid on the map so they stay reachable
              regardless of pan state. react-zoom-pan-pinch's built-in
              controls are minimal, so we render our own to keep the
              brand styling consistent. */}
          <div className="absolute right-14 top-3 z-20">
            <PlacementLoadout
              loadout={effectiveLoadout}
              onChange={setLoadout}
              markOptions={minerMarkOptions}
            />
          </div>

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
              onClick={() => wrapRef.current?.setTransform(0, 0, DEFAULT_SCALE)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-raised/90 text-fg hover:bg-bg-raised"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Jump to my claims"
              disabled={claimedNodes.length === 0}
              onClick={jumpToClaims}
              title={
                claimedNodes.length === 0
                  ? "No claimed nodes yet"
                  : `Jump to your ${claimedNodes.length} claimed node${claimedNodes.length === 1 ? "" : "s"}`
              }
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-raised/90 text-fg hover:bg-bg-raised disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bg-raised/90"
            >
              <LocateFixed className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={placingFactory ? "Cancel factory placement" : "Place a factory"}
              aria-pressed={placingFactory}
              title={
                placingFactory
                  ? "Click the map to place · Esc to cancel"
                  : "Place a factory — click, then click the map"
              }
              onClick={() => setPlacingFactory((v) => !v)}
              className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md border ${
                placingFactory
                  ? "border-primary bg-primary/25 text-fg"
                  : "border-border bg-bg-raised/90 text-fg hover:bg-bg-raised"
              }`}
            >
              <FactoryGlyph className="h-4 w-4 text-primary" />
              <Plus className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-bg-raised text-fg" />
            </button>
            <button
              type="button"
              aria-label={placingWater ? "Cancel water placement" : "Place water extractors"}
              aria-pressed={placingWater}
              title={
                placingWater
                  ? "Click the map to place · Esc to cancel"
                  : `Place water extractors (${loadout.waterCount}× @ ${loadout.waterClockPct}%)`
              }
              onClick={() => setPlacingWater((v) => !v)}
              className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md border ${
                placingWater
                  ? "border-accent bg-accent/25 text-fg"
                  : "border-border bg-bg-raised/90 text-fg hover:bg-bg-raised"
              }`}
            >
              <Droplets className="h-4 w-4 text-accent" />
              <Plus className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-bg-raised text-fg" />
            </button>
          </div>

          {/* The armed toolbar button's own colour change is easy to
              miss — it's a small border/background tint on a button
              that's already one of several in the same corner. This
              banner is the state's unmissable record: present exactly
              while a click will place something, gone the instant it
              won't (Esc, a second click on the tool, or a completed
              placement), so losing the mode is never silent. Factory
              placement got the same cursor change water placement
              always had (#59) but no banner of its own — folded in
              here rather than duplicating the mechanism. */}
          {(placingWater || placingFactory) && (
            <div
              role="status"
              className={`pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium text-white shadow-lg ${
                placingWater ? "border-accent bg-accent" : "border-primary bg-primary"
              }`}
            >
              {placingWater
                ? "Placing water extractors — click the map · Esc to cancel"
                : "Placing a factory — click the map · Esc to cancel"}
            </div>
          )}

          <div ref={containerRef} className="absolute inset-0 bg-black/40">
            <TransformWrapper
              ref={wrapRef}
              minScale={0.4}
              maxScale={6}
              initialScale={initialTransform?.scale ?? DEFAULT_SCALE}
              initialPositionX={initialTransform?.x ?? 0}
              initialPositionY={initialTransform?.y ?? 0}
              onTransform={(ref: ReactZoomPanPinchRef) => {
                persistTransform(ref.state);
                const rounded = Math.round(ref.state.scale * 100) / 100;
                setZoomScale((prev) => (prev === rounded ? prev : rounded));
              }}
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
                  style={{
                    width: MAP_W,
                    height: MAP_H,
                    cursor: placingWater ? WATER_CURSOR : placingFactory ? "crosshair" : undefined,
                  }}
                  onClick={(e) => {
                    if (placingFactory) {
                      const map = clientToMap(e.clientX, e.clientY);
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (!map || !rect) return;
                      setPlacingFactory(false);
                      setSelectedNodeId(null);
                      setSelectedFactoryId(null);
                      setQuickCreate({
                        screenX: e.clientX - rect.left,
                        screenY: e.clientY - rect.top,
                        mapX: map.x,
                        mapY: map.y,
                      });
                      return;
                    }
                    if (placingWater) {
                      const map = clientToMap(e.clientX, e.clientY);
                      if (!map) return;
                      const { worldX, worldY } = pctToWorld(map.x / MAP_W, map.y / MAP_H);
                      setPlacingWater(false);
                      setWaterGroup.mutate(
                        {
                          worldX,
                          worldY,
                          count: loadout.waterCount,
                          clockPct: loadout.waterClockPct,
                        },
                        { onSuccess: (g) => setSelectedWaterGroupId(g.id) },
                      );
                      return;
                    }
                    setSelectedNodeId(null);
                    setSelectedWaterGroupId(null);
                  }}
                  onContextMenu={(e) => {
                    // Right-click drops a factory right where the
                    // cursor is — the fast path for sketching a whole
                    // playthrough's worth of pins.
                    e.preventDefault();
                    const map = clientToMap(e.clientX, e.clientY);
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (!map || !rect) return;
                    setSelectedNodeId(null);
                    setSelectedFactoryId(null);
                    setQuickCreate({
                      screenX: e.clientX - rect.left,
                      screenY: e.clientY - rect.top,
                      mapX: map.x,
                      mapY: map.y,
                    });
                  }}
                >
                  <img
                    src={mapAsset}
                    alt="Satisfactory map"
                    className="absolute inset-0 h-full w-full"
                    draggable={false}
                  />

                  {/* All factory→factory flows, faint until a factory
                      is selected. Above the map image, under the
                      markers/pins, and pointer-events-none so it never
                      steals clicks. */}
                  {showAllLinks && (
                    <MapLinksLayer
                      links={links.data ?? []}
                      factories={factories.data ?? []}
                      itemNames={itemNames}
                      selectedFactoryId={selectedFactoryId}
                      mapW={MAP_W}
                      mapH={MAP_H}
                    />
                  )}

                  {/* Every claimed node/water group's own line to the
                      factory it feeds — the map's other spatial fact,
                      always on (unlike the flows above) so it's readable
                      without clicking into each factory first. The
                      selected factory's own bindings render emphasized,
                      with detach buttons, via InputLinesLayer below. */}
                  <NodeBindingLinesLayer
                    nodes={nodes.data ?? []}
                    waterGroups={waterGroups.data ?? []}
                    factories={factories.data ?? []}
                    selectedFactoryId={selectedFactoryId}
                    mapW={MAP_W}
                    mapH={MAP_H}
                  />

                  {visibleNodes.map((node) => {
                    const { xPct, yPct } = worldToPct(node.x, node.y);
                    const selected = selectedNodeId === node.id;
                    const size = 24;
                    const tooltip = nodeTooltip(node, factoryNameById);
                    return (
                      <div
                        key={node.id}
                        className="specs-map-marker absolute"
                        style={{
                          left: `${xPct * MAP_W}px`,
                          top: `${yPct * MAP_H}px`,
                          // Counters the map's own CSS zoom transform
                          // so the marker's on-screen footprint holds
                          // at the size it renders today at the
                          // default view, instead of scaling in
                          // lockstep with the coordinate spread. That
                          // lockstep is what made tight clusters (a
                          // resource well's satellites) impossible to
                          // separate by zooming — the ratio between
                          // marker size and gap never changed. The
                          // gap between markers still grows normally
                          // with zoom (it's just distance in world
                          // pixels), so past some zoom level a fixed-
                          // size marker no longer covers its
                          // neighbour.
                          transform: `translate(-50%, -50%) scale(${DEFAULT_SCALE / zoomScale})`,
                          // A factory pin's rendered footprint (icon +
                          // name label) is routinely several times a
                          // node's 24×24 box, and factories are meant
                          // to sit right on the cluster they claim
                          // from — so without an explicit stacking
                          // order, a pin fully swallows every click on
                          // the nodes underneath it. Nodes need to win
                          // that contest: claiming/inspecting a node is
                          // the finer-grained, more frequent action,
                          // and the factory pin stays reachable from
                          // whatever part of its box isn't covered by a
                          // node. Factory/water pins are left at the
                          // default stacking level, so this only
                          // changes node-vs-pin priority, not their
                          // order relative to each other.
                          //
                          // This has to live here, on the wrapper — the
                          // `transform` above already starts a new
                          // stacking context for this marker, so a
                          // z-index on the *button* inside it only ever
                          // competes against its own (nonexistent)
                          // siblings and never reaches the pin's
                          // separate stacking context to outrank it.
                          // `elementFromPoint` at a covered node's
                          // center kept resolving to the pin with the
                          // z-index down on the button; moving it here,
                          // onto the element actually siblinged against
                          // the pin's own wrapper, is what makes it win.
                          zIndex: 2,
                        }}
                      >
                        <button
                          type="button"
                          aria-label={tooltip}
                          title={tooltip}
                          className="relative inline-flex items-center justify-center rounded-full bg-bg-raised transition-transform hover:scale-125"
                          onClick={(e) => {
                            // mousedown→up already toggles the popover
                            // — stop the synthetic click bubbling so the
                            // map wrapper's onClick={setSelectedNodeId(null)}
                            // doesn't immediately clear what we just set.
                            e.stopPropagation();
                          }}
                          style={{
                            width: size,
                            height: size,
                            boxShadow:
                              PURITY_GLOW[node.purity as keyof typeof PURITY_GLOW],
                            opacity: node.claim ? 1 : 0.78,
                            outline: selected
                              ? "2px solid var(--color-primary)"
                              : undefined,
                            outlineOffset: 3,
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Water placement is armed and wins over
                            // whatever's under the cursor — without this,
                            // a node sitting where the player meant to
                            // place water swallows the click (the node's
                            // own handlers stop it reaching the map
                            // wrapper's onClick, where placement normally
                            // happens) and opens the node card instead,
                            // with the tool silently still armed or not
                            // depending on what the player does next.
                            // Placing here, the same as an empty-map
                            // click, means a click while armed always
                            // does the thing the banner says it will.
                            if (placingWater) {
                              const map = clientToMap(e.clientX, e.clientY);
                              if (!map) return;
                              const { worldX, worldY } = pctToWorld(map.x / MAP_W, map.y / MAP_H);
                              setPlacingWater(false);
                              setWaterGroup.mutate(
                                {
                                  worldX,
                                  worldY,
                                  count: loadout.waterCount,
                                  clockPct: loadout.waterClockPct,
                                },
                                { onSuccess: (g) => setSelectedWaterGroupId(g.id) },
                              );
                              return;
                            }
                            // Anchor in map-pixel space so the ghost line
                            // starts exactly at the node centre.
                            const fromX = xPct * MAP_W;
                            const fromY = yPct * MAP_H;
                            const startClientX = e.clientX;
                            const startClientY = e.clientY;
                            let armed = false;
                            const onMove = (ev: MouseEvent) => {
                              if (
                                !armed &&
                                Math.hypot(
                                  ev.clientX - startClientX,
                                  ev.clientY - startClientY,
                                ) >= CLICK_THRESHOLD_PX
                              ) {
                                armed = true;
                                setLinkingNode({ nodeId: node.id, fromX, fromY });
                              }
                              if (!armed) return;
                              // Convert screen delta back to map-pixel
                              // space via the current zoom scale.
                              const scale = wrapRef.current?.state.scale ?? 1;
                              setLinkCursor({
                                x: fromX + (ev.clientX - startClientX) / scale,
                                y: fromY + (ev.clientY - startClientY) / scale,
                              });
                            };
                            const onUp = () => {
                              window.removeEventListener("mousemove", onMove);
                              window.removeEventListener("mouseup", onUp);
                              if (!armed) {
                                // Plain click — fall through to existing
                                // popover behaviour.
                                setSelectedNodeId(
                                  node.id === selectedNodeId ? null : node.id,
                                );
                                return;
                              }
                              const targetFactoryId = linkHoverFactoryIdRef.current;
                              setLinkingNode(null);
                              setLinkCursor(null);
                              setLinkHoverFactoryId(null);
                              if (targetFactoryId) {
                                // Bind the node to that factory. Unclaimed
                                // miner nodes take the placement loadout
                                // (current mark + clock); existing claims
                                // keep their own miner/clock — coerced
                                // through the node's allowed list, so a
                                // stale extractor (Mk2 on an oil node)
                                // repairs on bind instead of failing the
                                // server's validation.
                                const existing = node.claim;
                                void setClaim.mutateAsync({
                                  nodeId: node.id,
                                  minerId: claimDefaultExtractor(
                                    node,
                                    existing?.minerId ?? effectiveLoadout.minerId,
                                  ),
                                  clockPct: existing?.clockPct ?? effectiveLoadout.minerClockPct,
                                  factoryId: targetFactoryId,
                                  notes: existing?.notes ?? null,
                                });
                              }
                            };
                            window.addEventListener("mousemove", onMove);
                            window.addEventListener("mouseup", onUp);
                          }}
                        >
                          <Icon
                            itemId={markerIconId(node.resourceItemId)}
                            alt=""
                            className="h-4 w-4"
                          />
                          {node.claim && (
                            // Claim state used to be opacity 1 vs 0.78 —
                            // the only difference between claimed and
                            // unclaimed markers, and too subtle on a 14px
                            // dot to read at a glance (#59). A shape-based
                            // cue (badge present or absent) reads reliably
                            // regardless of screen brightness/contrast;
                            // the opacity dip stays as a secondary hint.
                            <span
                              aria-hidden="true"
                              className="absolute -bottom-0.5 -right-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full bg-success ring-1 ring-bg-raised"
                            >
                              <Check className="h-2 w-2 text-white" strokeWidth={3} />
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}

                  {/* Input-flow lines for the currently-selected
                      factory. Drawn under the markers so clicks
                      still hit the icon buttons; SVG is fixed at
                      MAP_W × MAP_H and lives inside the transform
                      so it scales with pan/zoom for free. */}
                  {selectedFactoryId && (
                    <InputLinesLayer
                      selectedFactoryId={selectedFactoryId}
                      boundNodes={boundNodes}
                      boundWaterGroups={boundWaterGroups}
                      allFactories={factories.data ?? []}
                      onDetachWaterGroup={(group) => {
                        // Back to unbound — the marker survives, just
                        // not wired into this factory anymore.
                        setWaterGroup.mutate({
                          id: group.id,
                          worldX: group.worldX,
                          worldY: group.worldY,
                          count: group.count,
                          clockPct: group.clockPct,
                          count2: group.count2 ?? null,
                          clock2Pct: group.clock2Pct ?? null,
                          factoryId: null,
                          notes: group.notes ?? null,
                          locked: group.locked,
                        });
                      }}
                      onDetachNode={(nodeId) => {
                        // Full release: the node goes back to
                        // "unclaimed" state so it reappears in the
                        // default map view (which hides claimed
                        // nodes). Otherwise the marker would just
                        // disappear after detach — confusing when
                        // the user expects the node to be ready
                        // for a new binding.
                        void clearClaim.mutateAsync(nodeId);
                      }}
                    />
                  )}

                  {(factories.data ?? []).map((f) => {
                    const hasPower = (powerGens.data ?? []).some(
                      (g) => g.factoryId === f.id,
                    );
                    return (
                      <FactoryPin
                        key={f.id}
                        factory={f}
                        onOpenPlan={() => openPlanDesigner(f.id)}
                        hasPower={hasPower}
                        unsourcedCount={unsourcedByFactory.get(f.id)?.length ?? 0}
                        dragging={dragging === f.id}
                        linkHover={linkHoverFactoryId === f.id}
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
                          setSelectedPowerGenId(null);
                          setSelectedFactoryId(f.id);
                        }}
                        onLinkHoverEnter={() => {
                          if (linkingNode || linkingImport || linkingWater)
                            setLinkHoverFactoryId(f.id);
                        }}
                        onLinkHoverLeave={() => {
                          if (linkHoverFactoryId === f.id)
                            setLinkHoverFactoryId(null);
                        }}
                        currentScale={() => wrapRef.current?.state.scale ?? 1}
                        zoomScale={zoomScale}
                        onPanBy={(dxScreen, dyScreen) => {
                          const state = wrapRef.current?.state;
                          if (!state) return;
                          // animationTime 0 — the whole point is 1:1
                          // tracking with the cursor, an eased catch-up
                          // would fight the drag instead of following it.
                          wrapRef.current?.setTransform(
                            state.positionX + dxScreen,
                            state.positionY + dyScreen,
                            state.scale,
                            0,
                          );
                        }}
                      />
                    );
                  })}

                  {visibleWaterGroups.map((g) => {
                    const { xPct, yPct } = worldToPct(g.worldX, g.worldY);
                    const pinX = xPct * MAP_W;
                    const pinY = yPct * MAP_H;
                    const toggleLock = () => {
                      setWaterGroup.mutate({
                        id: g.id,
                        worldX: g.worldX,
                        worldY: g.worldY,
                        count: g.count,
                        clockPct: g.clockPct,
                        count2: g.count2 ?? null,
                        clock2Pct: g.clock2Pct ?? null,
                        factoryId: g.factoryId ?? null,
                        notes: g.notes ?? null,
                        locked: !g.locked,
                      });
                    };
                    return (
                      <WaterExtractorPin
                        key={g.id}
                        group={g}
                        x={pinX}
                        y={pinY}
                        selected={selectedWaterGroupId === g.id}
                        onToggleLock={toggleLock}
                        onOpenEditor={() => {
                          setSelectedNodeId(null);
                          setSelectedFactoryId(null);
                          setSelectedWaterGroupId(g.id);
                        }}
                        onStartBindDrag={(e) => {
                          // Same gesture as node→factory binding: under
                          // the click threshold it's a click (open the
                          // popover); past it, a ghost line follows the
                          // cursor and dropping on a pin binds.
                          const startX = e.clientX;
                          const startY = e.clientY;
                          let armed = false;
                          const onMove = (ev: MouseEvent) => {
                            if (
                              !armed &&
                              Math.hypot(ev.clientX - startX, ev.clientY - startY) >=
                                CLICK_THRESHOLD_PX
                            ) {
                              armed = true;
                              setLinkingWater({ groupId: g.id, fromX: pinX, fromY: pinY });
                            }
                            if (!armed) return;
                            const map = clientToMap(ev.clientX, ev.clientY);
                            if (map) setLinkCursor(map);
                          };
                          const onUp = () => {
                            window.removeEventListener("mousemove", onMove);
                            window.removeEventListener("mouseup", onUp);
                            if (!armed) {
                              // Plain click on a locked pin — handled by
                              // the pin's debounced toggle (so a double-
                              // click can cancel it); nothing to do here.
                              return;
                            }
                            const target = linkHoverFactoryIdRef.current;
                            setLinkingWater(null);
                            setLinkCursor(null);
                            setLinkHoverFactoryId(null);
                            if (target) {
                              setWaterGroup.mutate({
                                id: g.id,
                                worldX: g.worldX,
                                worldY: g.worldY,
                                count: g.count,
                                clockPct: g.clockPct,
                                count2: g.count2 ?? null,
                                clock2Pct: g.clock2Pct ?? null,
                                factoryId: target,
                                notes: g.notes ?? null,
                                locked: g.locked,
                              });
                            }
                          };
                          window.addEventListener("mousemove", onMove);
                          window.addEventListener("mouseup", onUp);
                        }}
                        onDragEnd={(pt) => {
                          const { worldX, worldY } = pctToWorld(pt.x / MAP_W, pt.y / MAP_H);
                          setWaterGroup.mutate({
                            id: g.id,
                            worldX,
                            worldY,
                            count: g.count,
                            clockPct: g.clockPct,
                            count2: g.count2 ?? null,
                            clock2Pct: g.clock2Pct ?? null,
                            factoryId: g.factoryId ?? null,
                            notes: g.notes ?? null,
                            locked: g.locked,
                          });
                        }}
                        currentScale={() => wrapRef.current?.state.scale ?? 1}
                        pinScale={DEFAULT_SCALE / zoomScale}
                      />
                    );
                  })}

                  {/* No per-generator pins: the factory IS the
                      grouping. A FactoryPin renders a ⚡ badge when
                      it owns any power_gen rows so the player can
                      tell which factories include power gear at a
                      glance. */}

                  {/* Ghost line while drag-to-linking (a node onto a
                      factory, or an unsourced input onto its future
                      source). Pointer-events disabled so it doesn't
                      intercept the drop hit-test. */}
                  {(linkingNode || linkingImport || linkingWater) && linkCursor && (
                    <svg
                      className="pointer-events-none absolute inset-0"
                      width={MAP_W}
                      height={MAP_H}
                      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
                    >
                      <line
                        x1={(linkingNode ?? linkingImport ?? linkingWater)!.fromX}
                        y1={(linkingNode ?? linkingImport ?? linkingWater)!.fromY}
                        x2={linkCursor.x}
                        y2={linkCursor.y}
                        stroke={linkHoverFactoryId ? "var(--color-success)" : "var(--color-primary)"}
                        strokeWidth={3}
                        strokeOpacity={0.85}
                        strokeDasharray="8 4"
                      />
                    </svg>
                  )}
                </div>
              </TransformComponent>
            </TransformWrapper>
          </div>

          {/* Right-click quick-create. Anchored at the cursor in
              container space so it doesn't scale with zoom. */}
          {quickCreate && (() => {
            // Computed once and reused for both the popover's coordinate
            // readout and the actual placement — siting is the entire
            // point of placing from the map, so the popover has to say
            // where "here" is before the player commits.
            const { worldX, worldY } = pctToWorld(
              quickCreate.mapX / MAP_W,
              quickCreate.mapY / MAP_H,
            );
            return (
              <div
                className="absolute z-30"
                style={{
                  left: Math.min(quickCreate.screenX, (containerRef.current?.clientWidth ?? 600) - 280),
                  top: Math.min(quickCreate.screenY, (containerRef.current?.clientHeight ?? 400) - 140),
                }}
              >
                <QuickCreateFactoryPopover
                  pending={createFactory.isPending}
                  coordLabel={coordChip(worldX, worldY)}
                  onCreate={(name) => {
                    createFactory.mutate(
                      { name },
                      {
                        onSuccess: (factory) => {
                          void factoryApi
                            .setPosition({ id: factory.id, worldX, worldY })
                            .finally(() => factories.refetch());
                          setQuickCreate(null);
                          // Straight into planning: the designer opens
                          // with the product picker ready and a
                          // "Cancel & delete" escape hatch.
                          openPlanDesigner(factory.id, true);
                        },
                      },
                    );
                  }}
                  onClose={() => setQuickCreate(null)}
                />
              </div>
            );
          })()}

          {/* Whole-map resource budget dock. Shares the bottom-left
              corner with the node popover — the popover wins while a
              node is selected so claiming never fights the budget. */}
          {!selectedNode && !selectedWaterGroup && (
            <div className="absolute bottom-3 left-3 z-20">
              <ResourceBudgetPanel variant="compact" />
            </div>
          )}

          {/* Water extractor group editor — same dock as the node
              popover; key forces a remount per group so form state
              never bleeds between markers. */}
          {selectedWaterGroup && !selectedNode && (
            <div className="absolute bottom-3 left-3 z-20">
              <WaterExtractorPopover
                key={selectedWaterGroup.id}
                group={selectedWaterGroup}
                factories={factories.data ?? []}
                pending={setWaterGroup.isPending || deleteWaterGroup.isPending}
                onSave={(patch) => {
                  setWaterGroup.mutate(
                    {
                      id: selectedWaterGroup.id,
                      worldX: selectedWaterGroup.worldX,
                      worldY: selectedWaterGroup.worldY,
                      locked: selectedWaterGroup.locked,
                      ...patch,
                    },
                    { onSuccess: () => setSelectedWaterGroupId(null) },
                  );
                }}
                onToggleLock={() => {
                  setWaterGroup.mutate({
                    id: selectedWaterGroup.id,
                    worldX: selectedWaterGroup.worldX,
                    worldY: selectedWaterGroup.worldY,
                    count: selectedWaterGroup.count,
                    clockPct: selectedWaterGroup.clockPct,
                    count2: selectedWaterGroup.count2 ?? null,
                    clock2Pct: selectedWaterGroup.clock2Pct ?? null,
                    factoryId: selectedWaterGroup.factoryId ?? null,
                    notes: selectedWaterGroup.notes ?? null,
                    locked: !selectedWaterGroup.locked,
                  });
                }}
                onDelete={() => {
                  deleteWaterGroup.mutate(selectedWaterGroup.id, {
                    onSuccess: () => setSelectedWaterGroupId(null),
                  });
                }}
                onClose={() => setSelectedWaterGroupId(null)}
              />
            </div>
          )}

          {/* Selected-node popover. Floats over the map so the user
              doesn't lose their pan/zoom state when claiming. */}
          {selectedNode && (
            <div className="absolute bottom-3 left-3 z-20">
              <NodePopover
                // key={selectedNode.id} forces a remount when the
                // selection changes — without it the previous node's
                // minerId / clockPct / factoryId stay in form state
                // and would be saved onto the freshly-picked node.
                key={selectedNode.id}
                node={selectedNode}
                loadout={effectiveLoadout}
                factories={factories.data ?? []}
                portWarning={portWarningsByNode.get(selectedNode.id)}
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
            <div className="absolute bottom-3 right-3 z-20">
              <FactoryPopover
                factoryId={selectedFactoryId}
                hasPower={(powerGens.data ?? []).some(
                  (g) => g.factoryId === selectedFactoryId,
                )}
                unsourcedInputs={unsourcedByFactory.get(selectedFactoryId) ?? []}
                onStartImportDrag={(input, e) => {
                  // Ghost line anchors at the owning factory's pin —
                  // the demand originates there.
                  const owner = (factories.data ?? []).find(
                    (f) => f.id === input.factoryId,
                  );
                  if (!owner) return;
                  const o = worldToPct(owner.worldX, owner.worldY);
                  const fromX = o.xPct * MAP_W;
                  const fromY = o.yPct * MAP_H;
                  setLinkingImport({
                    importId: input.importId,
                    itemName: input.itemName,
                    fromX,
                    fromY,
                    ownerFactoryId: input.factoryId,
                  });
                  const onMove = (ev: MouseEvent) => {
                    const map = clientToMap(ev.clientX, ev.clientY);
                    if (map) setLinkCursor(map);
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    const target = linkHoverFactoryIdRef.current;
                    setLinkingImport(null);
                    setLinkCursor(null);
                    setLinkHoverFactoryId(null);
                    if (target && target !== input.factoryId) {
                      commitImportSource(input.importId, target);
                    }
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                  e.preventDefault();
                }}
                onOpenPlan={() => {
                  openPlanDesigner(selectedFactoryId);
                  setSelectedFactoryId(null);
                }}
                onEditPower={() => {
                  useNavStore.getState().selectFactory(selectedFactoryId);
                  useNavStore.getState().goTo("power");
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
  /** Double-click — jump straight into the production plan. */
  onOpenPlan: () => void;
  /** True if this factory has any power_gen rows — surfaces a ⚡ corner badge so power-bearing factories read distinctly. */
  hasPower?: boolean;
  /** Inputs still waiting on a source factory — danger corner badge with the count. */
  unsourcedCount?: number;
  /** True while the user is dragging a node-link towards this pin so we can highlight it as the drop target. */
  linkHover?: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: (pt: { x: number; y: number }) => void;
  /** Fires when the mouseup happens within `CLICK_THRESHOLD_PX` of mousedown — treat as a click, not a drag. */
  onClick: () => void;
  onLinkHoverEnter?: () => void;
  onLinkHoverLeave?: () => void;
  /** Reads the current zoom scale from the wrapper so pixel deltas
      from drag events translate into world deltas correctly. */
  currentScale: () => number;
  /** Live zoom scale, rounded — unlike `currentScale()` (an imperative
      getter for drag math) this is React state, so the pin's own
      counter-scale (see the render below) actually re-renders as the
      map zooms, the same mechanism #96 gave node markers. */
  zoomScale: number;
  /** Pans the map by a raw screen-pixel delta. The pin sits on the
   * wrapper's `panning.excluded` list (a pin has to win clicks over
   * the pan gesture), so a plain drag starting here would otherwise
   * be swallowed with no effect at all — this re-implements panning
   * by hand for exactly that case, so "drag to pan" still works
   * everywhere the map's own instructions say it does. */
  onPanBy: (dxScreen: number, dyScreen: number) => void;
}

// Mousedown→up movement under this distance (in screen pixels) counts
// as a click instead of a drag. Trackpads register tiny jitter even on
// a real "click", so 4 px is safer than 0.
const CLICK_THRESHOLD_PX = 4;

interface InputLinesLayerProps {
  selectedFactoryId: string;
  boundNodes: ResourceNodeRow[];
  boundWaterGroups: WaterExtractorGroup[];
  allFactories: Array<{ id: string; name: string; worldX: number; worldY: number }>;
  onDetachNode: (nodeId: string, prev: ResourceNodeRow) => void;
  onDetachWaterGroup: (group: WaterExtractorGroup) => void;
}

/**
 * SVG layer that draws a line from each bound resource node to the
 * currently-selected factory, with a small detach-button on each
 * line's source endpoint. Factory→factory flows render in
 * `MapLinksLayer` instead. Mounted inside the pan/zoom transform so
 * the lines stay glued to their endpoints at every zoom level.
 */
function InputLinesLayer({
  selectedFactoryId,
  boundNodes,
  boundWaterGroups,
  allFactories,
  onDetachNode,
  onDetachWaterGroup,
}: InputLinesLayerProps) {
  const target = allFactories.find((f) => f.id === selectedFactoryId);
  if (!target) return null;
  const t = worldToPct(target.worldX, target.worldY);
  const tx = t.xPct * MAP_W;
  const ty = t.yPct * MAP_H;

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0"
        width={MAP_W}
        height={MAP_H}
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      >
        <defs>
          <marker
            id="specs-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerUnits="userSpaceOnUse"
            markerWidth="14"
            markerHeight="14"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {boundWaterGroups.map((g) => {
          const p = worldToPct(g.worldX, g.worldY);
          return (
            <line
              key={`w-${g.id}`}
              x1={p.xPct * MAP_W}
              y1={p.yPct * MAP_H}
              x2={tx}
              y2={ty}
              stroke="var(--color-accent, var(--color-primary))"
              strokeWidth={3}
              strokeOpacity={0.6}
              strokeDasharray="6 6"
              markerEnd="url(#specs-arrow)"
              style={{ color: "var(--color-accent, var(--color-primary))" }}
            />
          );
        })}
        {boundNodes.map((n) => {
          const p = worldToPct(n.x, n.y);
          return (
            <line
              key={`n-${n.id}`}
              x1={p.xPct * MAP_W}
              y1={p.yPct * MAP_H}
              x2={tx}
              y2={ty}
              stroke="var(--color-primary)"
              strokeWidth={3}
              strokeOpacity={0.6}
              strokeDasharray="6 6"
              markerEnd="url(#specs-arrow)"
              style={{ color: "var(--color-primary)" }}
            />
          );
        })}
      </svg>
      {/* Detach buttons sit on top of the SVG (which is
          pointer-events-none) so each one is independently clickable
          without blocking node/factory hits underneath. */}
      {boundWaterGroups.map((g) => {
        const p = worldToPct(g.worldX, g.worldY);
        return (
          <button
            key={`detach-w-${g.id}`}
            type="button"
            className="specs-map-pin absolute -translate-x-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg-raised text-fg-muted shadow-sm hover:bg-danger/20 hover:text-danger"
            style={{
              left: `${p.xPct * MAP_W + 16}px`,
              top: `${p.yPct * MAP_H - 16}px`,
            }}
            title="Detach these water extractors from this factory"
            onClick={(e) => {
              e.stopPropagation();
              onDetachWaterGroup(g);
            }}
          >
            <Unlink className="h-3 w-3" />
          </button>
        );
      })}
      {boundNodes.map((n) => {
        const p = worldToPct(n.x, n.y);
        return (
          <button
            key={`detach-${n.id}`}
            type="button"
            className="specs-map-pin absolute -translate-x-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg-raised text-fg-muted shadow-sm hover:bg-danger/20 hover:text-danger"
            style={{
              left: `${p.xPct * MAP_W + 16}px`,
              top: `${p.yPct * MAP_H - 16}px`,
            }}
            title={`Detach ${n.resourceItemName} from this factory`}
            onClick={(e) => {
              e.stopPropagation();
              onDetachNode(n.id, n);
            }}
          >
            <Unlink className="h-3 w-3" />
          </button>
        );
      })}
    </>
  );
}

function FactoryPin({
  factory,
  onOpenPlan,
  hasPower,
  unsourcedCount = 0,
  linkHover,
  onDragStart,
  onDragEnd,
  onClick,
  onLinkHoverEnter,
  onLinkHoverLeave,
  currentScale,
  zoomScale,
  onPanBy,
}: FactoryPinProps) {
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
    <div
      className="absolute"
      style={{
        left: `${px}px`,
        top: `${py}px`,
        // Same counter-scale node markers got from #96: cancels the
        // map's own zoom transform so a factory pin's on-screen size
        // holds constant instead of growing with it. Placement puts
        // factories right on the resource clusters feeding them, so
        // without this a dense playthrough's pins outgrow the nodes
        // underneath them at every zoom level except the default one.
        transform: `translate(-50%, -50%) scale(${DEFAULT_SCALE / zoomScale})`,
      }}
    >
    <button
      type="button"
      className={`specs-map-pin relative cursor-grab rounded-md border-2 px-2 py-1 text-[11px] font-medium text-fg shadow-sm active:cursor-grabbing ${
        linkHover
          ? "border-success bg-success/30 scale-110"
          : "border-primary bg-bg-raised/95 hover:bg-bg-raised"
      }`}
      title={`${factory.name} — click for details, double-click to open the plan, drag to pan the map, Alt/Option-drag to move`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenPlan();
      }}
      onMouseEnter={onLinkHoverEnter}
      onMouseLeave={onLinkHoverLeave}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // A pin's hit area is the whole label pill, and the map's own
        // instruction line puts "drag to pan" everywhere — a plain
        // drag that happens to start on a pin has to keep panning,
        // not silently relocate the factory. Moving needs a deliberate
        // Alt/Option hold, captured once at mousedown so releasing the
        // key mid-drag can't flip which gesture is in progress.
        const movesFactory = e.altKey;
        startRef.current = {
          x: baseX,
          y: baseY,
          clientX: e.clientX,
          clientY: e.clientY,
          moved: false,
        };
        let lastClientX = e.clientX;
        let lastClientY = e.clientY;
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
            if (movesFactory) onDragStart();
          }
          if (s.moved) {
            if (movesFactory) {
              const scale = currentScale();
              setHoverPos({ x: s.x + dxScreen / scale, y: s.y + dyScreen / scale });
            } else {
              // Same wrapper the map's own panning would use — this is
              // panning by hand for the one surface (a pin) the library
              // excludes from its own drag-to-pan handling.
              onPanBy(ev.clientX - lastClientX, ev.clientY - lastClientY);
            }
          }
          lastClientX = ev.clientX;
          lastClientY = ev.clientY;
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
          if (!movesFactory) {
            // Panned the map; the factory itself never moved.
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
          {/* Light halo behind the icon — dark item renders (Modular
              Engine, coal…) vanish straight onto the dark pin card. */}
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fg/20 ring-1 ring-fg/10">
            <Icon itemId={factory.iconId} alt={factory.name} className="h-4 w-4" />
          </span>
          {factory.name}
        </span>
      ) : (
        factory.name
      )}
      {hasPower && (
        <span
          aria-label="Has power generators"
          title="Has power generators"
          className="absolute -right-1.5 -top-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warning text-bg-raised"
        >
          <Zap className="h-2.5 w-2.5" />
        </span>
      )}
      {unsourcedCount > 0 && (
        <span
          aria-label={`${unsourcedCount} unsourced input${unsourcedCount === 1 ? "" : "s"}`}
          title={`${unsourcedCount} input${unsourcedCount === 1 ? "" : "s"} still need a source factory — click the pin to assign`}
          className="absolute -left-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center gap-0.5 rounded-full bg-danger px-0.5 text-[9px] font-bold text-white"
        >
          <CircleAlert className="h-2.5 w-2.5" />
          {unsourcedCount}
        </span>
      )}
    </button>
    </div>
  );
}

interface QuickCreateFactoryPopoverProps {
  pending: boolean;
  /** Where "here" is, formatted the same way every other coordinate
   * readout on the map is (`coordChip`) — siting is the whole point of
   * placing from the map, so this has to be checkable before Create. */
  coordLabel: string;
  onCreate: (name: string) => void;
  onClose: () => void;
}

/** Right-click → name → pin. The fastest path from "a factory goes
 * here" to a pin on the map; planning what it makes can come later.
 * Exported so a regression test can pin the coordinate readout
 * without having to drive a real right-click through the pan/zoom
 * wrapper. */
export function QuickCreateFactoryPopover({ pending, coordLabel, onCreate, onClose }: QuickCreateFactoryPopoverProps) {
  const [name, setName] = useState("");
  const valid = name.trim().length > 0;
  return (
    <Card className="w-[260px] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-fg">New factory here</span>
          <div className="text-[11px] tabular-nums text-fg-muted">{coordLabel}</div>
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
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid && !pending) onCreate(name.trim());
          if (e.key === "Escape") onClose();
        }}
        placeholder="Factory name…"
        aria-label="Factory name"
        className="mt-2 h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
      />
      <div className="mt-2 flex items-center justify-end">
        <Button
          disabled={!valid || pending}
          onClick={() => onCreate(name.trim())}
          className="px-2.5 py-1 text-xs"
        >
          <Workflow className="h-3 w-3" />
          {pending ? "Creating…" : "Create & plan"}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Machine count comes from the factory record's `machineCount` (the sum of
 * every recipe node's own `count`), not the number of recipe-node rows —
 * a factory can have four recipe nodes that add up to eleven machines.
 * Exported so a regression test can pin a factory where those two numbers
 * differ.
 */
export function formatFactoryPopoverSummary(
  machineCount: number,
  powerMw: number,
): string {
  return `${machineCount} machine${machineCount === 1 ? "" : "s"} · ${powerMw.toFixed(1)} MW`;
}

interface FactoryPopoverProps {
  factoryId: string;
  hasPower?: boolean;
  /** This factory's inputs still waiting on a source — rendered with
      drag handles so the user can drop them on the supplying pin. */
  unsourcedInputs?: UnsourcedInput[];
  onStartImportDrag?: (input: UnsourcedInput, e: React.MouseEvent) => void;
  onOpenPlan?: () => void;
  onEditPower?: () => void;
  onClose: () => void;
}

const POPOVER_SIZE_STORAGE = "specs:map:factoryPopoverLarge";

function FactoryPopover({
  factoryId,
  hasPower,
  unsourcedInputs = [],
  onStartImportDrag,
  onOpenPlan,
  onEditPower,
  onClose,
}: FactoryPopoverProps) {
  const detail = useFactoryDetail(factoryId);
  const recipes = useRecipes();
  const items = useItems();
  const itemNames = useMemo(
    () => new Map(items.data?.map((i) => [i.id, i.name]) ?? []),
    [items.data],
  );
  // Small by default; the expand toggle is remembered so planning
  // sessions that live in this card keep it big.
  const [large, setLarge] = useState(
    () => localStorage.getItem(POPOVER_SIZE_STORAGE) === "1",
  );
  const toggleSize = () => {
    setLarge((v) => {
      try {
        localStorage.setItem(POPOVER_SIZE_STORAGE, v ? "0" : "1");
      } catch {}
      return !v;
    });
  };
  const f = detail.data?.factory;
  const ledger = detail.data?.ledger;

  // Roll every deficit input back through the recipe graph so the
  // popover can show 'this factory ultimately needs X Iron Ore /
  // min' — burning down as bound nodes contribute. We trace GROSS
  // demand (pre-subtracting fromNodes) so the UI can render the
  // burn-down as "180 of 675 bound · 495 missing"; subtracting too
  // early collapses that into a single 'missing' number and loses
  // the telemetry. Intermediates (Iron Rod, Screw, …) never bind
  // from nodes so the rollup is the only useful demand view.
  const requires = useMemo(() => {
    if (!ledger || !recipes.data) return [] as Array<{
      itemId: string;
      required: number;
      bound: number;
      missing: number;
    }>;
    // A deficit covered by an incoming logistics link is supplied,
    // not missing — test 45 importing its Copper Ingot from another
    // factory must not roll that demand back to "ore missing".
    const grossDeficits = ledger.flows
      .filter((flow) => flow.netPerMinute < -0.001)
      .map((flow) => ({
        itemId: flow.itemId,
        ratePerMin: Math.max(
          0,
          -flow.netPerMinute - (flow.fromLinksPerMinute ?? 0),
        ),
      }))
      .filter((d) => d.ratePerMin > 0.001);
    const raw = grossDeficits.length === 0
      ? {}
      : traceRawDemand(grossDeficits, recipes.data);
    // Map raw item id → bound supply from the factory's flow rows.
    const boundFor = (itemId: string): number => {
      const flow = ledger.flows.find((f) => f.itemId === itemId);
      return flow?.fromNodesPerMinute ?? 0;
    };
    return Object.entries(raw)
      .map(([itemId, required]) => {
        const bound = boundFor(itemId);
        return {
          itemId,
          required,
          bound: Math.min(bound, required),
          missing: Math.max(0, required - bound),
        };
      })
      .sort((a, b) => b.required - a.required);
  }, [ledger, recipes.data]);
  // Bound supply for items the factory doesn't actually need (so a
  // wired-up node never silently disappears from the UI).
  const unusedBindings = useMemo(() => {
    if (!ledger) return [] as Array<{ itemId: string; itemName: string; bound: number }>;
    const requiredIds = new Set(requires.map((r) => r.itemId));
    return ledger.flows
      .filter(
        (f) =>
          (f.fromNodesPerMinute ?? 0) > 0.001 &&
          !requiredIds.has(f.itemId) &&
          // ignore items the factory is producing — they're shown as outputs already
          f.netPerMinute <= 0.001,
      )
      .map((f) => ({ itemId: f.itemId, itemName: f.itemName, bound: f.fromNodesPerMinute ?? 0 }));
  }, [ledger, requires]);
  return (
    <Card className={`${large ? "w-[460px] max-h-[70vh] overflow-y-auto" : "w-[320px]"} p-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {f?.iconId ? (
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fg/20 ring-1 ring-fg/10">
              <Icon itemId={f.iconId} alt="" className="h-6 w-6" />
            </span>
          ) : (
            <FactoryGlyph className="h-5 w-5 text-fg-muted" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">
              {f?.name ?? "Loading…"}
            </div>
            <div className="text-[11px] text-fg-muted tabular-nums">
              {detail.data && ledger
                ? formatFactoryPopoverSummary(detail.data.factory.machineCount, ledger.powerMw)
                : ""}
            </div>
            {/* Same coordinate chip "New factory here" (#97) and node
                cards already carry — without it there's no way to check
                where a factory actually is, or confirm a drag landed
                (or was undone) where intended. */}
            {f && <div className="text-[11px] tabular-nums text-fg-muted">{coordChip(f.worldX, f.worldY)}</div>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleSize}
            aria-pressed={large}
            aria-label={large ? "Shrink details" : "Expand details"}
            title={large ? "Back to the compact card" : "Bigger card — easier to scan exports and inputs"}
            className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            {large ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            ×
          </button>
        </div>
      </div>

      {(() => {
        if (!detail.data || !ledger) return null;
        const outputs = ledger.flows.filter((f) => f.netPerMinute > 0.001);
        if (outputs.length === 0 && requires.length === 0 && unusedBindings.length === 0)
          return null;
        return (
          <>
            {outputs.length > 0 && (
              <ul className="mt-3 space-y-1 text-[11px]">
                {outputs.map((flow) => (
                  <li
                    key={`out-${flow.itemId}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Icon itemId={flow.itemId} alt="" className="h-3.5 w-3.5" />
                      <span className="truncate">{flow.itemName}</span>
                    </span>
                    <span className="tabular-nums text-success">
                      +{flow.netPerMinute.toFixed(1)}/min
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {requires.length > 0 && (
              <div className="mt-3 border-t border-border/40 pt-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  Requires
                </div>
                <ul className="mt-1 space-y-1 text-[11px]">
                  {requires.map((r) => {
                    const fullyCovered = r.missing <= 0.001;
                    return (
                      <li
                        key={r.itemId}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Icon
                            itemId={markerIconId(r.itemId)}
                            alt=""
                            className="h-3.5 w-3.5"
                          />
                          <span className="truncate">
                            {itemNames.get(r.itemId) ?? r.itemId}
                          </span>
                        </span>
                        <span className="flex items-center gap-1 tabular-nums">
                          {fullyCovered ? (
                            <span
                              className="text-success"
                              title={`Bound: ${r.bound.toFixed(1)}/min covers required ${r.required.toFixed(1)}/min`}
                            >
                              {r.required.toFixed(0)}/min ✓
                            </span>
                          ) : (
                            <>
                              <span className="text-danger">
                                {r.missing.toFixed(0)}/min missing
                              </span>
                              <span
                                className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary"
                                title={`Bound nodes provide ${r.bound.toFixed(1)}/min of ${r.required.toFixed(1)}/min required`}
                              >
                                {r.bound.toFixed(0)}/{r.required.toFixed(0)}
                              </span>
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {unusedBindings.length > 0 && (
              <div className="mt-3 border-t border-border/40 pt-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  Bound · unused
                </div>
                <ul className="mt-1 space-y-1 text-[11px]">
                  {unusedBindings.map((u) => (
                    <li
                      key={`unused-${u.itemId}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Icon itemId={u.itemId} alt="" className="h-3.5 w-3.5" />
                        <span className="truncate">{u.itemName}</span>
                      </span>
                      <span
                        className="tabular-nums text-fg-muted"
                        title="No machine in this factory consumes (or traces back to) this resource"
                      >
                        {u.bound.toFixed(1)}/min
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        );
      })()}

      {unsourcedInputs.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-warning">
            Unsourced inputs · drag onto the supplying factory
          </div>
          <ul className="mt-1 space-y-1 text-[11px]">
            {unsourcedInputs.map((u) => (
              <li
                key={u.importId}
                className="flex cursor-grab items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-border/40 active:cursor-grabbing"
                title={`Drag onto the factory that will supply ${u.itemName}`}
                onMouseDown={(e) => onStartImportDrag?.(u, e)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <GripVertical className="h-3 w-3 shrink-0 text-fg-muted" />
                  <Icon itemId={u.itemId} alt="" className="h-3.5 w-3.5" />
                  <span className="truncate">{u.itemName}</span>
                </span>
                <span className="tabular-nums text-warning">unsourced</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        {hasPower && onEditPower && (
          <Button
            variant="ghost"
            onClick={onEditPower}
            className="px-3 py-1 text-xs"
          >
            <Zap className="h-3 w-3 text-warning" />
            Edit power
          </Button>
        )}
        {onOpenPlan && (
          <Button onClick={onOpenPlan} className="px-3 py-1 text-xs">
            <Workflow className="h-3 w-3" />
            Open plan
          </Button>
        )}
      </div>
    </Card>
  );
}

interface NodePopoverProps {
  node: ResourceNodeRow;
  /** Placement loadout — initial miner/clock for unclaimed miner nodes. */
  loadout: MapLoadout;
  factories: FactoryPickerCandidate[];
  onClaim: (input: {
    minerId: string | null;
    clockPct: number;
    factoryId: string | null;
    notes: string | null;
  }) => void;
  onRelease: () => void;
  onClose: () => void;
  /** Validate's port-capacity finding for this node, if any — same
   * check as the Resources row's inline flag, read from the one sweep
   * both surfaces share instead of a second copy of the belt/pipe
   * capacity lookup. Only meaningful once the node actually has a
   * committed claim — the finding is derived from persisted state,
   * not from whatever's still being typed into this card. */
  portWarning?: PortCapacityFinding;
}

function NodePopover({ node, loadout, factories, onClaim, onRelease, onClose, portWarning }: NodePopoverProps) {
  // claimDefaultExtractor coerces stale claims (e.g. a Mk2 saved on an
  // oil node) to the node's valid building, so Update repairs them.
  const [minerId, setMinerId] = useState<string>(
    claimDefaultExtractor(node, node.claim?.minerId ?? loadout.minerId) ?? "",
  );
  const [clockPct, setClockPct] = useState(
    node.claim?.clockPct ?? (node.kind === "miner_node" ? loadout.minerClockPct : 100),
  );
  const [factoryId, setFactoryId] = useState<string | null>(node.claim?.factoryId ?? null);
  const kindLabel = nodeKindLabel(node);

  return (
    <Card className="w-[300px] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Icon itemId={markerIconId(node.resourceItemId)} className="h-4 w-4" />
            {node.resourceItemName} · {node.purity}
            {kindLabel && (
              <span className="rounded-full border border-border bg-bg px-1.5 py-0.5 text-[10px] font-normal text-fg-muted">
                {kindLabel}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-muted">
            <span>{coordChip(node.x, node.y)}</span>
            {/* Same rate readout the Resources row editor's claim chip
                carries (`ipmLabel`) — this card is meant to be the
                secondary surface for the same decision, not a worse-
                supported one. */}
            {node.itemsPerMinute > 0 && (
              <span className="font-medium text-fg">{Math.round(node.itemsPerMinute)} ipm</span>
            )}
          </div>
          {/* Only a committed claim can have a finding — the sweep
              this reads runs against persisted claims, not whatever
              clock is still being typed into the form below. Same
              wording as the Resources row's pill so the same problem
              reads identically wherever it's seen. */}
          {node.claim && portWarning && (
            <div
              className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] text-warning"
              title={`Outputs ${portWarning.outputIpm.toFixed(1)}${portWarning.isFluid ? " m³/min" : "/min"} — its port caps at ${portWarning.capacityIpm.toFixed(1)}${portWarning.isFluid ? " m³/min" : "/min"} (Mk.${portWarning.capacityMark} ${portWarning.isFluid ? "pipe" : "belt"}), clock to ${floorClockPct(portWarning.maxFittingClockPct)}% to fit`}
            >
              over port cap
            </div>
          )}
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
            <div className="mt-1">
              <FilterSelect
                compact
                ariaLabel="Extractor"
                clearable={false}
                placeholder="Select extractor…"
                options={node.allowedExtractors.map((e) => ({
                  value: e.id,
                  label: e.name,
                  badge: <TierBadge unlockTier={e.unlockTier} />,
                }))}
                value={minerId === "" ? null : minerId}
                onChange={(next) => setMinerId(next ?? "")}
              />
            </div>
          </label>
          <label className="block">
            <span className="text-fg-muted">Clock</span>
            <div className="mt-1.5">
              {/* No slider here — the popover column is too narrow for
                  it to be anything but decoration. */}
              <ClockInput
                value={clockPct}
                onChange={setClockPct}
                slider={false}
                // Matches the identical control in the Resources list
                // (NodeRow's ClaimEditor) — same action, same label, so
                // an accessibility audit doesn't read them as two
                // different controls.
                ariaLabel="Claim clock percent"
              />
            </div>
          </label>
        </div>
      )}

      <label className="mt-2 block text-xs">
        <span className="text-fg-muted">Factory</span>
        <div className="mt-1">
          <FilterSelect
            compact
            ariaLabel="Factory"
            placeholder="— none —"
            options={factoryPickerOptions(node, factories)}
            value={factoryId}
            onChange={setFactoryId}
          />
        </div>
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
              minerId: minerId === "" ? null : minerId,
              clockPct,
              factoryId,
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
