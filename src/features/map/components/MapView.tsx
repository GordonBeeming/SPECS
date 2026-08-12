import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
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
import {
  useExtractedResources,
  useItems,
  useRecipes,
} from "@/features/library/hooks/useLibrary";
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
  useWaterPumpIpm,
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
import { ClockInput, formatClockPct } from "@/shared/ui/ClockInput";

import mapAsset from "@/assets/map/satisfactory-map.webp";

import {
  factoryPickerOptions,
  hasWorldPosition,
  pctToWorld,
  worldDistance,
  worldToPct,
  type FactoryPickerCandidate,
} from "../transform";
import {
  claimDefaultExtractor,
  coordChip,
  nodeKindLabel,
  previewExtractorIpm,
} from "@/features/resources/display";
import { num } from "@/shared/format/rates";
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
 * The clock a *fresh* claim starts at. The placement loadout is a
 * miner mark and the clock that goes with it, so it only speaks for
 * miner nodes; a well satellite or a geyser has no mark to carry a
 * clock preference and starts neutral.
 *
 * The one definition for every path that opens or commits a fresh
 * claim — the card, drag-to-bind, and the marker tooltip that
 * advertises both. Three copies of this rule is three chances for the
 * tooltip to promise a rate that the gesture it names doesn't deliver.
 */
export function defaultClaimClockPct(
  node: Pick<ResourceNodeRow, "kind">,
  loadout: Pick<MapLoadout, "minerClockPct">,
): number {
  return node.kind === "miner_node" ? loadout.minerClockPct : 100;
}

/** The claim a node would get from a plain click or drag-bind right
 * now: the loadout's extractor when the node accepts it, at
 * `defaultClaimClockPct`. `null` for a node with no extractor at all,
 * i.e. a geyser. */
function pendingClaimShape(
  node: Pick<ResourceNodeRow, "allowedExtractors" | "kind" | "purity">,
  loadout: Pick<MapLoadout, "minerId" | "minerClockPct">,
): { extractorName: string; clockPct: number; ipm: number } | null {
  const extractorId = claimDefaultExtractor(node, loadout.minerId);
  const extractor = node.allowedExtractors?.find((e) => e.id === extractorId);
  if (!extractor) return null;
  const clockPct = defaultClaimClockPct(node, loadout);
  return {
    extractorName: extractor.name,
    clockPct,
    ipm: previewExtractorIpm(extractor.baseIpm, node.purity, clockPct),
  };
}

/**
 * The two strings a node marker needs, kept apart on purpose.
 *
 * `label` describes the node and nothing else — it's the accessible
 * name, re-announced on every focus pass, and a name that ends in
 * "click to bind or drag onto a factory" both repeats an instruction
 * endlessly and names two gestures a keyboard user doesn't have. The
 * mouse-only hint belongs in `title`, which is exactly where a hover
 * hint is expected to live.
 *
 * A claimed node's marker is the map's only record of which factory
 * that claim feeds — a bare "Iron Ore · Normal · 30 ipm" can't answer
 * "which factory?" without opening the card, so a claimed node names
 * the factory and repeats the coordinates.
 *
 * An unclaimed node carries the same coordinates plus the rate the
 * current loadout would actually extract, because siting and yield are
 * what the *choice between nodes* turns on — withholding them until
 * after the claim is committed is backwards. The rate names its own
 * assumptions (which extractor, which clock) so it can't be misread as
 * a property of the node.
 *
 * Both states advertise drag-to-bind: the drag handler rebinds a
 * claimed node just as happily as it binds a fresh one, and dropping
 * the hint once a claim exists hides the recovery path for a claim
 * bound to the wrong factory (or to none). Exported so a regression
 * test can pin the exact strings for a known node + claim.
 */
export function nodeMarkerText(
  node: Pick<
    ResourceNodeRow,
    | "resourceItemName"
    | "purity"
    | "x"
    | "y"
    | "itemsPerMinute"
    | "claim"
    | "kind"
    | "resourceItemId"
    | "allowedExtractors"
  >,
  factoryNameById: Map<string, string>,
  loadout: Pick<MapLoadout, "minerId" | "minerClockPct">,
): { label: string; title: string } {
  const kindLabel = nodeKindLabel(node);
  const base = kindLabel
    ? `${node.resourceItemName} · ${node.purity} · ${kindLabel}`
    : `${node.resourceItemName} · ${node.purity}`;
  const coords = coordChip(node.x, node.y);
  if (!node.claim) {
    const pending = pendingClaimShape(node, loadout);
    const yieldPart = pending
      ? ` · ${num(pending.ipm)} ipm with ${pending.extractorName} at ${formatClockPct(pending.clockPct)}%`
      : "";
    // "unclaimed" earns its place once the gesture hint moves out:
    // without it, claim state was only ever implied by *which*
    // instruction the name ended with.
    const label = `${base}${yieldPart} · ${coords} · unclaimed`;
    return { label, title: `${label} · click to bind or drag onto a factory` };
  }
  const factoryLabel = node.claim.factoryId
    ? factoryNameById.get(node.claim.factoryId) ?? "unknown factory"
    : "no factory yet";
  const label = `${base} · ${node.itemsPerMinute.toFixed(0)} ipm · ${coords} · feeds ${factoryLabel}`;
  return { label, title: `${label} · click to edit or drag onto a factory to rebind` };
}

/**
 * Which factory a fresh claim should point at before the player touches
 * the dropdown, in falling order of how much the pick is actually
 * *known*:
 *
 * 1. The factory whose card is open — a claim made while a factory's
 *    shortfall is on screen is overwhelmingly a claim for that factory.
 * 2. The only factory there is. Placed or not, there's nothing to be
 *    wrong about.
 * 3. The nearest factory that has a map position, ranked by the same
 *    distances the dropdown itself prints.
 *
 * Otherwise `null`. Two or more factories that have never been dragged
 * onto the map carry no distance to rank by, and `factoryPickerOptions`
 * falls back to sorting those alphabetically — pre-binding to whichever
 * name sorts first would present a coin toss in the same shape as a
 * real nearest-neighbour answer, and the player has no way to tell the
 * two apart. An empty picker at least reads as "you pick".
 *
 * A node that already carries a claim is not this function's business:
 * its saved factory (including a deliberate "none") is what the card
 * has to show, or Update would silently rewrite a binding the player
 * never edited.
 */
export function defaultClaimFactoryId(
  node: { x: number; y: number },
  factories: FactoryPickerCandidate[],
  selectedFactoryId: string | null,
): string | null {
  if (factories.length === 0) return null;
  if (selectedFactoryId && factories.some((f) => f.id === selectedFactoryId)) {
    return selectedFactoryId;
  }
  if (factories.length === 1) return factories[0].id;
  const placed = factories.filter(hasWorldPosition);
  if (placed.length === 0) return null;
  const [nearest] = factoryPickerOptions(node, placed);
  return nearest?.value ?? null;
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

/** Scale that covers a container of the given size with the map image,
 * rather than fitting inside it — the map is meant to be panned, so
 * it's fine to run past the container in one axis as long as neither
 * axis leaves bare canvas showing. Shared by the mount-time
 * ResizeObserver (below) and the playthrough-switch effect, which both
 * need it for a playthrough with no saved view of its own. */
function coverFitScale(width: number, height: number): number {
  const cover = Math.max(width / MAP_W, height / MAP_H);
  return Math.min(Math.max(cover, 0.4), 6); // matches TransformWrapper's own min/maxScale
}

/** Water is the one required resource with no nodes on the map at
 * all: extractors are free-placed on any lake or ocean tile, so a
 * water shortfall routes to the placement tool instead of a claim. */
const WATER_ITEM_ID = "Desc_Water_C";

/** A node marker's box in map pixels, before the counter-scale below
 * cancels the ambient zoom out of it. */
const MARKER_PX = 24;

/** As close as anything auto-framed gets to zoom in. Past this the map
 * image is running out of detail and the player loses the surroundings
 * they'd site a factory against. */
const MAX_FRAME_SCALE = 1.5;

/**
 * Every cluster of markers that overlap on screen at this zoom, as a
 * lookup from node id to the whole pile it belongs to (a lone marker
 * maps to a one-entry list containing itself).
 *
 * Membership is *transitive*, and that is the whole point. Asking
 * "which markers overlap this one" gives a different answer for every
 * node in a pile — A covers B and B covers C without A covering C —
 * so a pager built on it renumbers as you walk, wanders into markers
 * that were never in the pile you opened, and leaves the far members
 * unreachable. They aren't clickable either, since something is
 * covering them; that combination is a node with no route to it at
 * all. A cluster is a property of the *place*, so every member sees
 * the same list in the same order and paging is closed over it.
 *
 * A marker's on-screen footprint is constant (the wrapper's
 * counter-scale cancels the map's own zoom) while the gap between two
 * markers grows with zoom, so clusters dissolve as you zoom in —
 * around 3× the whole map is singletons.
 */
export function nodeClusters<T extends Pick<ResourceNodeRow, "id" | "x" | "y" | "resourceItemName">>(
  nodes: T[],
  zoomScale: number,
  /** Map-pixel position of a node. The default derives it; the map
   * passes a lookup into the positions it already computed for
   * rendering. */
  pointOf: (node: T) => { x: number; y: number } = (n) => {
    const p = worldToPct(n.x, n.y);
    return { x: p.xPct * MAP_W, y: p.yPct * MAP_H };
  },
): Map<string, T[]> {
  const radius = (MARKER_PX * DEFAULT_SCALE) / Math.max(zoomScale, 0.01);
  const points = nodes.map(pointOf);

  // Union-find over array indices rather than ids: no string hashing
  // in the hot loop, and no lookups that could come back undefined.
  const parent = points.map((_, i) => i);
  const find = (start: number): number => {
    let i = start;
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path halving
      i = parent[i];
    }
    return i;
  };

  // Buckets one radius wide, so any pair close enough to overlap
  // shares a cell or sits in one of the eight around it. Without this
  // the sweep is every node against every other one, on every zoom
  // change that happens while a card is open.
  const cells = new Map<string, number[]>();
  const cellKey = (x: number, y: number) =>
    `${Math.floor(x / radius)},${Math.floor(y / radius)}`;
  points.forEach((p, i) => {
    const key = cellKey(p.x, p.y);
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  });

  points.forEach((p, i) => {
    const cx = Math.floor(p.x / radius);
    const cy = Math.floor(p.y / radius);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j <= i) continue;
          if (Math.hypot(points[j].x - p.x, points[j].y - p.y) > radius) continue;
          const a = find(i);
          const b = find(j);
          if (a !== b) parent[a] = b;
        }
      }
    }
  });

  const grouped = new Map<number, T[]>();
  nodes.forEach((node, i) => {
    const root = find(i);
    const bucket = grouped.get(root);
    if (bucket) bucket.push(node);
    else grouped.set(root, [node]);
  });

  const byId = new Map<string, T[]>();
  for (const cluster of grouped.values()) {
    cluster.sort(
      (a, b) => a.resourceItemName.localeCompare(b.resourceItemName) || a.id.localeCompare(b.id),
    );
    for (const node of cluster) byId.set(node.id, cluster);
  }
  return byId;
}

/** Whether the OS asks for reduced motion. Guarded because jsdom (and
 * any non-browser host) has no `matchMedia`, the same guard
 * `useThemeMode` needs for `prefers-color-scheme`. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Zoom that frames a span of map pixels inside the container with room
 * to breathe, never so far out that bare canvas shows around the map
 * (the same floor `coverFitScale` enforces on load) and never past
 * `MAX_FRAME_SCALE`. A single point has no span at all, which is the
 * case that would otherwise divide by zero and ask for infinite zoom.
 */
export function frameScale(
  spanX: number,
  spanY: number,
  rect: { width: number; height: number },
): number {
  const padded = 1.5;
  const fit = Math.min(
    rect.width / Math.max(spanX * padded, 1),
    rect.height / Math.max(spanY * padded, 1),
  );
  return Math.max(Math.min(fit, MAX_FRAME_SCALE), coverFitScale(rect.width, rect.height));
}

/**
 * Pan that puts a map-pixel point in the middle of the container —
 * except where centring it would drag the map's own edge into view.
 * `limitToBounds` is off (the map is meant to be panned freely), so a
 * jump aimed near a corner of the world would otherwise land with a
 * third of the viewport showing black canvas and no way to tell what
 * it framed. Exported for the regression test: the clamp is the whole
 * behaviour and it isn't observable through jsdom layout.
 */
export function centerPan(
  cx: number,
  cy: number,
  scale: number,
  rect: { width: number; height: number },
): { x: number; y: number } {
  const axis = (center: number, viewport: number, content: number): number => {
    const centered = viewport / 2 - center * scale;
    // A map smaller than the viewport can't cover it at all — centring
    // the leftover margin is the least-bad framing.
    if (content < viewport) return (viewport - content) / 2;
    return Math.min(0, Math.max(viewport - content, centered));
  };
  return {
    x: axis(cx, rect.width, MAP_W * scale),
    y: axis(cy, rect.height, MAP_H * scale),
  };
}

/**
 * Where a popover anchored to a click should actually render, in
 * container-relative pixels: beside the thing that was clicked, and
 * flipped to the other side rather than clipped when it won't fit.
 * Card sizes are the caller's business — a node card and the
 * quick-create card are different shapes.
 */
export function popoverAnchor(
  anchor: { x: number; y: number },
  container: { width: number; height: number },
  card: { width: number; height: number },
): { left: number; top: number } {
  const gap = 14;
  const margin = 8;
  const clamp = (v: number, max: number) => Math.max(margin, Math.min(v, max - margin));
  const right = anchor.x + gap;
  const below = anchor.y + gap;
  return {
    left: clamp(
      right + card.width <= container.width - margin ? right : anchor.x - gap - card.width,
      container.width - card.width,
    ),
    top: clamp(
      below + card.height <= container.height - margin ? below : anchor.y - gap - card.height,
      container.height - card.height,
    ),
  };
}

/**
 * The node a "claim one of these for me" action should land on: the
 * closest one to the factory that wants the resource. A factory that
 * has never been dragged onto the map has no position to measure from
 * (see `hasWorldPosition`), so distance would rank against the world
 * origin — order the candidates arrived in is more honest than a
 * confident-looking wrong answer.
 */
export function nearestClaimableNode<T extends { x: number; y: number }>(
  candidates: T[],
  factory: { worldX: number; worldY: number } | undefined,
): T | null {
  if (candidates.length === 0) return null;
  if (!factory || !hasWorldPosition(factory)) return candidates[0];
  return candidates.reduce((best, n) =>
    worldDistance(n.x, n.y, factory.worldX, factory.worldY) <
    worldDistance(best.x, best.y, factory.worldX, factory.worldY)
      ? n
      : best,
  );
}

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
  const waterPumpIpm = useWaterPumpIpm();
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
      wrapRef.current?.setTransform(0, 0, coverFitScale(width, height), 0);
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
  // Where the node card renders, in container-relative screen px — the
  // spot the player clicked, not a fixed corner. Claiming is a
  // pointing action: a card that answers it from the far side of the
  // map makes the player check twice that it's describing the node
  // they meant.
  const [nodeAnchor, setNodeAnchor] = useState<{ x: number; y: number } | null>(null);
  const nodeCardRef = useRef<HTMLDivElement | null>(null);
  const [nodeCardPos, setNodeCardPos] = useState<{ left: number; top: number } | null>(null);
  // A pending "bind this node to that factory" the player asked for
  // explicitly, from a factory card's shortfall row. Only this counts
  // as permission to prefill a factory over an existing claim's own
  // saved binding — merely opening a claimed node's card must never
  // rewrite what it's bound to.
  // `seq` is what makes a *repeated* instruction land. The card is
  // keyed by node id, so when the target node's card is already open
  // (a factory card and a node card can both be up at once) selecting
  // it again changes nothing and the prefill never runs — `bindTo` is
  // read in a `useState` initialiser, which only fires on mount.
  // Folding the sequence into the key remounts the card for each
  // fresh instruction, including a second one naming the same pair.
  const [claimIntent, setClaimIntent] = useState<{
    nodeId: string;
    factoryId: string;
    seq: number;
  } | null>(null);
  // An instruction outlives its card by exactly nothing. Every way of
  // finishing with the card — committing, releasing, closing, paging to
  // a stacked neighbour, clicking another marker — moves the selection
  // off this node, so tying the intent's life to that covers all of
  // them at once. Left standing, it would outrank the *saved* binding
  // the next time the same node's card opened, and quietly rewrite it
  // on the next Update: the same silent overwrite the notes fix closed.
  useEffect(() => {
    if (claimIntent && selectedNodeId !== claimIntent.nodeId) setClaimIntent(null);
  }, [selectedNodeId, claimIntent]);
  // Nodes to ring briefly after the camera moves on its own. A jump
  // that lands without saying what it landed on leaves the player
  // hunting for a marker that looks like every other marker.
  const [flashNodeIds, setFlashNodeIds] = useState<Set<string>>(() => new Set());
  const flashTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);
  const flashNodes = (ids: string[]) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlashNodeIds(new Set(ids));
    flashTimer.current = window.setTimeout(() => setFlashNodeIds(new Set()), 2600);
  };
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
  // Escape closes whichever card is open. These float over the map,
  // anchored and dismissible-looking, which is a shape people press
  // Escape at; without it the only way out is finding the small ×.
  // Armed placement gets Escape first — that banner is the more urgent
  // mode to be able to cancel, and its own handler above already owns
  // the key while it's up.
  useEffect(() => {
    if (placingWater || placingFactory) return;
    if (!selectedNodeId && !selectedFactoryId && !selectedWaterGroupId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSelectedNodeId(null);
      setSelectedFactoryId(null);
      setSelectedWaterGroupId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placingWater, placingFactory, selectedNodeId, selectedFactoryId, selectedWaterGroupId]);
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
    if (t) {
      setZoomScale(t.scale);
      wrapRef.current?.setTransform(t.x, t.y, t.scale, 0);
    } else {
      // No saved view for the playthrough being switched to — the
      // mount-time ResizeObserver already disconnected by now, so
      // without this the map fell back to the fixed DEFAULT_SCALE
      // regardless of window size, reopening with the same bare-canvas
      // margins the mount-time cover fit exists to remove. The
      // container is already measurable here (the map has already
      // rendered once), so this can read it synchronously instead of
      // needing another observer.
      const rect = containerRef.current?.getBoundingClientRect();
      const scale =
        rect && rect.width > 0 && rect.height > 0 ? coverFitScale(rect.width, rect.height) : DEFAULT_SCALE;
      setZoomScale(scale);
      wrapRef.current?.setTransform(0, 0, scale, 0);
    }
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
  // Marker drags attach their move/up handlers to `window` and tear
  // them down in the up handler. Unmounting mid-drag never reaches
  // that, so the listeners outlive the tree and the surviving mouseup
  // fires openNodeCard/setClaim against a component that's gone.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

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
  /** Moves the camera so `points` (map pixels) are framed and centred,
   * at a zoom picked for the spread rather than whatever the player
   * happened to be at. Returns the pan and scale it applied, so a
   * caller can work out where a given map point ended up on screen —
   * which is *not* the middle of the view whenever `centerPan` clamped
   * to keep bare canvas out of frame, i.e. anywhere near the world's
   * edge. */
  const frameMapPoints = (
    points: Array<{ x: number; y: number }>,
  ): { rect: DOMRect; pan: { x: number; y: number }; scale: number } | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = frameScale(maxX - minX, maxY - minY, rect);
    const pan = centerPan((minX + maxX) / 2, (minY + maxY) / 2, scale, rect);
    // The wrapper's own onTransform lands this too, but not until the
    // animation's first frame — setting it here keeps every marker's
    // counter-scale in step with the zoom from the outset.
    setZoomScale(Math.round(scale * 100) / 100);
    // A camera that flies across the map is exactly the vestibular
    // trigger `prefers-reduced-motion` exists for — arrive instantly
    // instead, which loses nothing but the travel.
    wrapRef.current?.setTransform(pan.x, pan.y, scale, prefersReducedMotion() ? 0 : 300);
    return { rect, pan, scale };
  };

  const mapPoint = (node: { x: number; y: number }) => {
    const p = worldToPct(node.x, node.y);
    return { x: p.xPct * MAP_W, y: p.yPct * MAP_H };
  };

  const jumpToClaims = () => {
    if (claimedNodes.length === 0) return;
    // Frame every claim's bounding box, not just the first one — a
    // network usually spans more than one node by the time this
    // button matters.
    frameMapPoints(claimedNodes.map(mapPoint));
    flashNodes(claimedNodes.map((n) => n.id));
  };

  /**
   * Open a marker's card, or — when its card is already the one open —
   * page to the next marker stacked underneath it. A marker covering
   * another is unclickable by definition, so the top one has to be the
   * way in to its neighbours; a marker with nothing under it keeps
   * plain activate-to-close. Shared by the pointer and keyboard paths
   * so both do the same thing, `anchor` being the only difference
   * (where the pointer was, versus where the marker is).
   */
  const openNodeCard = (node: ResourceNodeRow, anchor: { x: number; y: number } | null) => {
    if (anchor) setNodeAnchor(anchor);
    setSelectedNodeId((prev) => {
      if (prev !== node.id) return node.id;
      const stack = nodeClusters(visibleNodes, zoomScale, pointOfNode).get(node.id) ?? [];
      if (stack.length < 2) return null;
      const at = stack.findIndex((n) => n.id === node.id);
      return stack[(at + 1) % stack.length].id;
    });
  };

  /** Centre a single node, ring it, and open its card — the landing
   * half of every "take me to this node" action on the map. */
  const focusNode = (node: ResourceNodeRow) => {
    const point = mapPoint(node);
    const framed = frameMapPoints([point]);
    // Where the marker actually is after the pan, not where we asked
    // for it to be: `centerPan` refuses to pull bare canvas into view,
    // so a node near the world's edge lands off-centre and a card
    // pinned to the middle would point at empty map.
    setNodeAnchor(
      framed
        ? {
            x: framed.pan.x + point.x * framed.scale,
            y: framed.pan.y + point.y * framed.scale,
          }
        : null,
    );
    setSelectedNodeId(node.id);
    flashNodes([node.id]);
  };

  const visibleNodes = useMemo(() => {
    const data = nodes.data ?? [];
    return data.filter((n) => {
      // Always show a node if it's an input of the currently-
      // selected factory, regardless of filter state. The user
      // clicked a factory to see its inputs; hiding them because
      // a filter is on would defeat the point.
      if (boundNodeIds.has(n.id)) return true;
      // Whatever is open stays on screen. Without this the card's own
      // node can be filtered out from under it — and the alternative,
      // switching filters off to make room, rewrites preferences the
      // player set deliberately and persists them.
      if (n.id === selectedNodeId) return true;
      if (!showClaimedToo && n.claim) return false;
      if (hiddenResources.has(n.resourceItemId)) return false;
      if (hiddenPurities.has(n.purity)) return false;
      return true;
    });
  }, [nodes.data, showClaimedToo, hiddenResources, hiddenPurities, boundNodeIds, selectedNodeId]);

  const selectedNode = useMemo(
    () => visibleNodes.find((n) => n.id === selectedNodeId) ?? null,
    [visibleNodes, selectedNodeId],
  );

  // Both of these hang off `nodes.data` rather than being derived in
  // the marker loop, because that loop re-runs on every `zoomScale`
  // change — which `onTransform` fires per wheel tick, so tens of times
  // a second during a trackpad zoom. Built per marker instead, the
  // label alone cost two scans of `allowedExtractors` and a handful of
  // string allocations, times the world's ~600 nodes, per tick.
  const nodePoints = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of nodes.data ?? []) {
      const p = worldToPct(n.x, n.y);
      map.set(n.id, { x: p.xPct * MAP_W, y: p.yPct * MAP_H });
    }
    return map;
  }, [nodes.data]);
  const markerText = useMemo(() => {
    const map = new Map<string, { label: string; title: string }>();
    for (const n of nodes.data ?? []) {
      map.set(n.id, nodeMarkerText(n, factoryNameById, effectiveLoadout));
    }
    return map;
  }, [nodes.data, factoryNameById, effectiveLoadout]);
  const pointOfNode = useMemo(
    () => (n: ResourceNodeRow) => {
      const known = nodePoints.get(n.id);
      if (known) return known;
      const p = worldToPct(n.x, n.y);
      return { x: p.xPct * MAP_W, y: p.yPct * MAP_H };
    },
    [nodePoints],
  );

  // The whole pile the selected marker belongs to — one entry (itself)
  // when nothing overlaps it. Only built while a card is actually
  // open: with nothing selected this returns immediately, so a zoom
  // gesture doesn't pay for a clustering pass nobody is reading.
  const selectedStack = useMemo(
    () =>
      selectedNode
        ? nodeClusters(visibleNodes, zoomScale, pointOfNode).get(selectedNode.id) ?? [selectedNode]
        : [],
    [selectedNode, visibleNodes, zoomScale, pointOfNode],
  );
  const stepStack = (delta: number) => {
    if (!selectedNode || selectedStack.length < 2) return;
    const at = selectedStack.findIndex((n) => n.id === selectedNode.id);
    setSelectedNodeId(
      selectedStack[(at + delta + selectedStack.length) % selectedStack.length].id,
    );
  };

  // Focus follows the card: into it on open (it renders after every
  // marker in the DOM, so Tab would otherwise walk hundreds of
  // controls to reach it), and back to the marker it describes on
  // close, so a keyboard user resumes where they left off instead of
  // at the top of the document.
  const lastFocusedNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastFocusedNodeIdRef.current;
    lastFocusedNodeIdRef.current = selectedNodeId;
    if (!selectedNodeId) setNodeAnchor(null);
    if (selectedNodeId) {
      // Only on the closed→open transition. Paging the stack keeps one
      // card open across a node change, and pulling focus back to the
      // dialog each time would take it off the pager button being
      // pressed — the same one-press-then-re-tab this move exists to
      // prevent.
      if (!previous) nodeCardRef.current?.focus();
      return;
    }
    if (!previous) return;
    // Node ids are catalog identifiers, but the escape keeps a quote
    // or backslash in one from silently breaking the selector.
    const id = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(previous) : previous;
    const marker = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    // The marker is routinely *gone* by the time the card closes —
    // claiming a node drops it out of the visible set whenever "show
    // claimed nodes too" is off, which is the main path through this
    // code, not an edge case. Falling back to the map region keeps
    // focus where the player was working; without it the common case
    // silently lands on `document.body` and the guarantee only holds
    // when you cancel.
    (marker ?? containerRef.current)?.focus();
  }, [selectedNodeId]);

  // Both boxes the anchored card has to fit — its own and the map
  // viewport's — are measured from the live DOM rather than assumed.
  // A hardcoded card size is a guess that goes stale the moment a
  // conditional row (the stack pager, the port-cap pill, the
  // no-factories warning) renders, and it's the Claim button at the
  // bottom that ends up off-screen. Re-measuring on resize matters for
  // the same reason: a window resized while the card is open would
  // otherwise clamp against a box that no longer exists, and strand the
  // card outside the viewport with no way back except closing it.
  // `useLayoutEffect` so the card is positioned in the same frame it
  // appears, never painted at a placeholder spot first.
  useLayoutEffect(() => {
    const card = nodeCardRef.current;
    const container = containerRef.current;
    if (!selectedNode || !nodeAnchor || !card || !container) {
      setNodeCardPos(null);
      return;
    }
    const place = () => {
      const box = container.getBoundingClientRect();
      setNodeCardPos(
        popoverAnchor(
          nodeAnchor,
          { width: box.width, height: box.height },
          { width: card.offsetWidth, height: card.offsetHeight },
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(card);
    observer.observe(container);
    return () => observer.disconnect();
  }, [selectedNode, nodeAnchor]);

  // Nodes that could still be pointed at a factory: unclaimed, or
  // claimed but never bound. A node already feeding some factory isn't
  // a candidate — taking it would just move the shortfall elsewhere.
  const claimableNodesByItem = useMemo(() => {
    const map = new Map<string, ResourceNodeRow[]>();
    for (const n of nodes.data ?? []) {
      if (n.claim?.factoryId) continue;
      const arr = map.get(n.resourceItemId) ?? [];
      arr.push(n);
      map.set(n.resourceItemId, arr);
    }
    return map;
  }, [nodes.data]);
  // Both halves matter to the factory card, and they mean different
  // things: `total` 0 says this resource has no map nodes at all (it
  // isn't claimed, it's placed or piped), while `claimable` 0 says
  // there were nodes and they're all spoken for.
  const nodeSupplyByItem = useMemo(() => {
    const map = new Map<string, { total: number; claimable: number }>();
    for (const n of nodes.data ?? []) {
      const entry = map.get(n.resourceItemId) ?? { total: 0, claimable: 0 };
      entry.total++;
      if (!n.claim?.factoryId) entry.claimable++;
      map.set(n.resourceItemId, entry);
    }
    return map;
  }, [nodes.data]);

  /**
   * "This factory is short on Iron Ore" → the nearest node that could
   * fix it, framed and open with the factory already selected in its
   * picker. The factory card names the gap; this is the map acting on
   * it without a detour through the plan and back.
   */
  const claimNodeForFactory = (factoryId: string, itemId: string) => {
    const factory = (factories.data ?? []).find((f) => f.id === factoryId);
    const target = nearestClaimableNode(claimableNodesByItem.get(itemId) ?? [], factory);
    if (!target) return;
    // Carried on the node id it was formed against, so a later
    // hand-picked node can't inherit an intent aimed at a different
    // one — there's no clearing step to forget.
    setClaimIntent((prev) => ({ nodeId: target.id, factoryId, seq: (prev?.seq ?? 0) + 1 }));
    // No filter is touched on the way: `visibleNodes` keeps whatever
    // is selected on screen regardless, and every filter here persists
    // to localStorage — a shortcut that quietly rewrites the player's
    // saved view to do its job is a worse trade than the one it makes.
    focusNode(target);
  };

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
              // `accent` is a dark blue in both themes, so white
              // stays its readable pairing; `primary` inverts (dark
              // blue on light, bright cyan on dark) and needs the
              // theme's own background colour to keep contrast on both
              // sides. One token for both fills fails one of them.
              className={`pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg ${
                placingWater
                  ? "border-accent bg-accent text-white"
                  : "border-primary bg-primary text-bg"
              }`}
            >
              {placingWater
                ? "Placing water extractors — click the map · Esc to cancel"
                : "Placing a factory — click the map · Esc to cancel"}
            </div>
          )}

          <div
            ref={containerRef}
            // Focusable only as a target, never as a tab stop: it's
            // where focus lands when a card closes and the marker it
            // came from is no longer rendered.
            tabIndex={-1}
            className="absolute inset-0 bg-black/40 outline-none"
          >
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
                    const size = MARKER_PX;
                    const flashing = flashNodeIds.has(node.id);
                    const text =
                      markerText.get(node.id) ??
                      nodeMarkerText(node, factoryNameById, effectiveLoadout);
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
                          data-node-id={node.id}
                          aria-label={text.label}
                          aria-expanded={selected}
                          title={text.title}
                          // The ring is a class, not an inline style,
                          // so the cue lives entirely in the stylesheet
                          // alongside the pulse it pairs with — a test
                          // that asserts it is then asserting the real
                          // styling rather than a string that could
                          // stay true after the styling is gone. Flash
                          // outranks selection: a jump that just moved
                          // the camera has to say which marker it moved
                          // to, and by then the node is selected
                          // anyway, so the two cues would land on the
                          // same marker and cancel out.
                          className={[
                            "relative inline-flex items-center justify-center rounded-full bg-bg-raised transition-transform hover:scale-125",
                            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary",
                            flashing
                              ? "outline outline-[3px] outline-offset-[5px] outline-warning motion-safe:animate-pulse"
                              : selected
                                ? "outline outline-2 outline-offset-[3px] outline-primary"
                                : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={(e) => {
                            // mousedown→up already toggles the popover
                            // — stop the synthetic click bubbling so the
                            // map wrapper's onClick={setSelectedNodeId(null)}
                            // doesn't immediately clear what we just set.
                            e.stopPropagation();
                          }}
                          onKeyDown={(e) => {
                            // The whole marker interaction is built on
                            // mousedown/mouseup, so without this a
                            // focused marker does nothing at all on
                            // Enter or Space — and a focusable control
                            // that can't be activated is worse than one
                            // that was never in the tab order.
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            e.stopPropagation();
                            const rect = containerRef.current?.getBoundingClientRect();
                            const box = e.currentTarget.getBoundingClientRect();
                            openNodeCard(
                              node,
                              rect
                                ? {
                                    x: box.left + box.width / 2 - rect.left,
                                    y: box.top + box.height / 2 - rect.top,
                                  }
                                : null,
                            );
                          }}
                          style={{
                            width: size,
                            height: size,
                            boxShadow:
                              PURITY_GLOW[node.purity as keyof typeof PURITY_GLOW],
                            opacity: node.claim ? 1 : 0.78,
                          }}
                          onMouseDown={(e) => {
                            // preventDefault stops the browser's own
                            // drag/selection, and with it the focus a
                            // mousedown would normally move — so the
                            // card's focus handling has a marker to
                            // return focus *to*, this puts it there
                            // explicitly.
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.focus();
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
                              detach();
                              if (!armed) {
                                // Plain click — fall through to existing
                                // popover behaviour.
                                const rect = containerRef.current?.getBoundingClientRect();
                                openNodeCard(
                                  node,
                                  rect
                                    ? {
                                        x: startClientX - rect.left,
                                        y: startClientY - rect.top,
                                      }
                                    : null,
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
                                  clockPct:
                                    existing?.clockPct ??
                                    defaultClaimClockPct(node, effectiveLoadout),
                                  factoryId: targetFactoryId,
                                  notes: existing?.notes ?? null,
                                });
                              }
                            };
                            const detach = () => {
                              window.removeEventListener("mousemove", onMove);
                              window.removeEventListener("mouseup", onUp);
                              dragCleanupRef.current = null;
                            };
                            dragCleanupRef.current = detach;
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
                              <Check className="h-2 w-2 text-bg" strokeWidth={3} />
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

          {/* Whole-map resource budget dock. The node popover follows
              the marker it describes, so it can land anywhere
              including on top of this — the dock steps aside while a
              node card is open rather than being half-covered by it. */}
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
                pumpIpm={waterPumpIpm.data ?? 0}
                pending={
                  setWaterGroup.isPending ||
                  deleteWaterGroup.isPending ||
                  waterPumpIpm.data === undefined
                }
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
              doesn't lose their pan/zoom state when claiming, and
              renders beside the marker it describes rather than in a
              corner — a claim is a pointing action, and a card a
              screen away from the thing pointed at has to be
              re-verified every time. */}
          {selectedNode && (
            <div
              ref={nodeCardRef}
              role="dialog"
              aria-label={`${selectedNode.resourceItemName} node`}
              tabIndex={-1}
              // Focused on open, because the popovers render after all
              // 600-odd markers in the DOM — reaching this card by Tab
              // otherwise means passing through every marker on the
              // map. Closing hands focus back to the marker it
              // describes (see the effect above).
              // No anchor means the selection didn't come from a
              // pointer at all — the dock is the safe place for it.
              className={`outline-none ${nodeAnchor ? "absolute z-30" : "absolute bottom-3 left-3 z-30"}`}
              style={nodeAnchor ? (nodeCardPos ?? undefined) : undefined}
            >
              {/* Outside `NodePopover`, and deliberately: the card is
                  keyed by node id, so paging would unmount the very
                  button being pressed and drop focus to the document
                  body — one press, then a re-tab from the top. The
                  stack belongs to the *place* anyway, not to whichever
                  of its nodes is currently showing. */}
              {selectedStack.length > 1 && (
                <div className="mb-1 flex items-center justify-between gap-2 rounded-md border border-border bg-bg-raised px-2 py-1 text-[11px] text-fg-muted shadow-sm">
                  <button
                    type="button"
                    onClick={() => stepStack(-1)}
                    aria-label="Previous node at this spot"
                    className="rounded p-0.5 hover:bg-border hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  {/* Live, because paging swaps the card's whole
                      contents with no other signal that the position
                      moved. */}
                  <span aria-live="polite" className="tabular-nums">
                    {selectedStack.findIndex((n) => n.id === selectedNode.id) + 1} of{" "}
                    {selectedStack.length} nodes stacked here
                  </span>
                  <button
                    type="button"
                    onClick={() => stepStack(1)}
                    aria-label="Next node at this spot"
                    className="rounded p-0.5 hover:bg-border hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <NodePopover
                // Remounts when the selection changes — without it the
                // previous node's minerId / clockPct / factoryId stay
                // in form state and would be saved onto the freshly-
                // picked node. The claim-intent sequence rides along so
                // an instruction aimed at the node already showing
                // still resets the form to carry it out.
                key={
                  claimIntent?.nodeId === selectedNode.id
                    ? `${selectedNode.id}:${claimIntent.seq}`
                    : selectedNode.id
                }
                node={selectedNode}
                loadout={effectiveLoadout}
                factories={factories.data ?? []}
                selectedFactoryId={selectedFactoryId}
                bindTo={
                  claimIntent?.nodeId === selectedNode.id ? claimIntent.factoryId : undefined
                }
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
                nodeSupplyByItem={nodeSupplyByItem}
                nodesPending={nodes.isPending}
                onClaimNodeFor={(itemId) => claimNodeForFactory(selectedFactoryId, itemId)}
                onPlaceWater={() => setPlacingWater(true)}
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
  /** Per resource: how many nodes exist at all, and how many are still
      free to point at this factory. */
  nodeSupplyByItem?: Map<string, { total: number; claimable: number }>;
  /** The node list hasn't loaded yet, so an empty map means "not known
      yet", not "this resource has no nodes". */
  nodesPending?: boolean;
  /** Take the map to the nearest claimable node of this resource. */
  onClaimNodeFor?: (itemId: string) => void;
  /** Arm water placement — water has no nodes to claim. */
  onPlaceWater?: () => void;
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
  nodeSupplyByItem,
  nodesPending,
  onClaimNodeFor,
  onPlaceWater,
  onOpenPlan,
  onEditPower,
  onClose,
}: FactoryPopoverProps) {
  const detail = useFactoryDetail(factoryId);
  const recipes = useRecipes();
  const items = useItems();
  const extracted = useExtractedResources();
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
    if (!ledger || !recipes.data || !extracted.data) return [] as Array<{
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
      : traceRawDemand(grossDeficits, recipes.data, new Set(extracted.data));
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
  }, [ledger, recipes.data, extracted.data]);
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
                    const itemName = itemNames.get(r.itemId) ?? r.itemId;
                    const supply = nodeSupplyByItem?.get(r.itemId);
                    const nodesInWorld = supply?.total ?? 0;
                    const claimable = supply?.claimable ?? 0;
                    return (
                      <li key={r.itemId}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Icon
                              itemId={markerIconId(r.itemId)}
                              alt=""
                              className="h-3.5 w-3.5"
                            />
                            <span className="truncate">{itemName}</span>
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
                        </div>
                        {/* The shortfall is only actionable from the
                            surface that can see both the gap and the
                            nodes that would close it — this card. Sent
                            to the plan instead, the player comes back
                            to the map anyway, hunting for a node by
                            eye.

                            When there's nothing to claim, the reason
                            is plain text rather than a disabled
                            button's tooltip: a disabled button is out
                            of the tab order and fires no hover for
                            most assistive tech, so the answer the
                            control exists to give would be reachable
                            by mouse only. */}
                        {/* Nodes and factories are independent queries
                            and the factory one can win the race, so an
                            empty node list here means "still loading"
                            as often as it means "none exist" —
                            asserting the second while the first is true
                            tells the player a resource isn't on the map
                            at all. */}
                        {!fullyCovered &&
                          !nodesPending &&
                          (nodesInWorld === 0 ? (
                            r.itemId === WATER_ITEM_ID && onPlaceWater ? (
                              <button
                                type="button"
                                onClick={onPlaceWater}
                                aria-label={`Place water extractors for ${itemName}`}
                                title="Water has no nodes to claim — extractors go anywhere on a lake or ocean"
                                className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                              >
                                <Droplets className="h-2.5 w-2.5" />
                                Place extractors
                              </button>
                            ) : (
                              <span className="mt-0.5 block text-[10px] text-fg-muted">
                                No map nodes for {itemName} — it comes from a plan or a link
                              </span>
                            )
                          ) : claimable === 0 ? (
                            <span className="mt-0.5 block text-[10px] text-fg-muted">
                              Every {itemName} node already feeds a factory
                            </span>
                          ) : (
                            onClaimNodeFor && (
                              <button
                                type="button"
                                onClick={() => onClaimNodeFor(r.itemId)}
                                aria-label={`Claim a node for ${itemName} — nearest of ${claimable} unbound`}
                                title={`Open the nearest of ${claimable} unbound ${itemName} node${claimable === 1 ? "" : "s"} and bind it to this factory`}
                                className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                              >
                                <MapPin className="h-2.5 w-2.5" />
                                Claim a node
                              </button>
                            )
                          ))}
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
  /** The factory whose card is open, if any — the first candidate for
   * a fresh claim's binding (see `defaultClaimFactoryId`). */
  selectedFactoryId: string | null;
  /** The factory the player explicitly sent this card here to bind to.
   * Outranks an existing claim's saved factory, and only this does:
   * the request was "point a node at this factory", so arriving with
   * "— none —" would drop the instruction on the floor. The claim's
   * own extractor and clock are untouched either way — a deliberate
   * underclock is not the binding's to overwrite. */
  bindTo?: string;
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

function NodePopover({
  node,
  loadout,
  factories,
  selectedFactoryId,
  bindTo,
  onClaim,
  onRelease,
  onClose,
  portWarning,
}: NodePopoverProps) {
  // claimDefaultExtractor coerces stale claims (e.g. a Mk2 saved on an
  // oil node) to the node's valid building, so Update repairs them.
  const [minerId, setMinerId] = useState<string>(
    claimDefaultExtractor(node, node.claim?.minerId ?? loadout.minerId) ?? "",
  );
  const [clockPct, setClockPct] = useState(
    node.claim?.clockPct ?? defaultClaimClockPct(node, loadout),
  );
  const [factoryId, setFactoryId] = useState<string | null>(
    bindTo ??
      (node.claim
        ? node.claim.factoryId ?? null
        : defaultClaimFactoryId(node, factories, selectedFactoryId)),
  );
  const kindLabel = nodeKindLabel(node);
  // What this claim would actually extract at the clock currently in
  // the box, matching the Resources row's own live preview — a bare
  // percentage asks the player to hold a purity multiplier and a
  // building's base rate in their head to hit a target rate.
  const selectedExtractor = node.allowedExtractors?.find((e) => e.id === minerId);
  const previewIpm = selectedExtractor
    ? previewExtractorIpm(selectedExtractor.baseIpm, node.purity, clockPct)
    : 0;

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
              {/* Same live readout the Resources row prints under its
                  own clock — without it, landing on a target rate from
                  the map is arithmetic against a purity multiplier the
                  player has to remember. */}
              <span className="mt-1 block text-[11px] font-medium text-fg">
                {num(previewIpm)} ipm at this clock
              </span>
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
        {/* A claim bound to nothing is still worth making — it reserves
            the node — but the picker offering only "— none —" reads as
            a broken control rather than an empty world, so say which
            it is. */}
        {factories.length === 0 && (
          <span className="mt-1 block text-[11px] text-warning">
            No factories yet — claim it now and bind it once one exists.
          </span>
        )}
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
              // This card has no notes field, so it has nothing to say
              // about them — sending `null` would delete a note the
              // player wrote elsewhere every time they nudged a clock.
              // Drag-to-bind already carries the existing note through.
              notes: node.claim?.notes ?? null,
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
