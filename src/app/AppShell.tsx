import { useEffect, useState } from "react";
import {
  BookOpen,
  Compass,
  Factory as FactoryIcon,
  FlaskConical,
  Info,
  LayoutDashboard,
  MapPin,
  Moon,
  Network,
  Rocket,
  Share2,
  ShieldCheck,
  Sun,
  TrainTrack,
  Zap,
} from "lucide-react";
import { AboutModal } from "@/features/about/components/AboutModal";
import { Button } from "@/shared/ui/Button";
import { useThemeMode } from "@/shared/theme/useThemeMode";
import { HealthBadge } from "@/features/health/components/HealthBadge";
import { HomeView } from "@/features/home/components/HomeView";
import { LibraryView } from "@/features/library/components/LibraryView";
import { FactoryListView } from "@/features/factory/components/FactoryListView";
import { LogisticsListView } from "@/features/logistics/components/LogisticsListView";
import { TrainRoutesView } from "@/features/trains/components/TrainRoutesView";
import { NetworkView } from "@/features/network/components/NetworkView";
import { AltsView } from "@/features/alts/components/AltsView";
import { SpaceElevatorView } from "@/features/elevator/components/SpaceElevatorView";
import { PlaythroughSwitcher } from "@/features/playthrough/components/PlaythroughSwitcher";
import {
  useCurrentPlaythrough,
  useOpenPlaythrough,
  usePlaythroughList,
} from "@/features/playthrough/hooks/usePlaythroughs";
import { PowerView } from "@/features/power/components/PowerView";
import { ResourcesView } from "@/features/resources/components/ResourcesView";
import { MapView } from "@/features/map/components/MapView";
import { PlanDesignerView } from "@/features/factory/components/plan/PlanDesignerView";
import { ValidationPanel } from "@/features/validation/components/ValidationPanel";
import { takePlanFirstRunFlag, useNavStore } from "@/shared/nav-store";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { useUndoStore } from "@/shared/undo/store";

type Route =
  | "home"
  | "factories"
  | "logistics"
  | "trains"
  | "power"
  | "network"
  | "library"
  | "alts"
  | "resources"
  | "map"
  | "elevator"
  // Full-screen production-plan designer — reached via nav-store deep
  // link (openPlanDesigner), never from the sidebar.
  | "plan";

// The Map is the canvas now — Planner folded into a "New factory"
// overlay on the map, and the per-resource list still has its own
// tab for bulk-editing claims. Factory/Power tabs remain so the
// graph editor and per-machine forms have room to breathe; they
// can route in from map popovers via the nav store.
const NAV: ReadonlyArray<{ id: Route; label: string; Icon: typeof BookOpen }> = [
  { id: "home", label: "Home", Icon: LayoutDashboard },
  { id: "map", label: "Map", Icon: Compass },
  { id: "network", label: "Network", Icon: Share2 },
  { id: "resources", label: "Resources", Icon: MapPin },
  { id: "factories", label: "Factories", Icon: FactoryIcon },
  { id: "logistics", label: "Logistics", Icon: Network },
  { id: "elevator", label: "Space Elevator", Icon: Rocket },
  { id: "trains", label: "Trains", Icon: TrainTrack },
  { id: "power", label: "Power", Icon: Zap },
  { id: "alts", label: "Alts", Icon: FlaskConical },
  { id: "library", label: "Library", Icon: BookOpen },
];

const ROUTE_IDS = new Set<string>([...NAV.map((n) => n.id), "plan"]);
function isRoute(s: string): s is Route {
  return ROUTE_IDS.has(s);
}

export function AppShell() {
  const { mode, toggle } = useThemeMode();
  const [route, setRoute] = useState<Route>("home");
  const [showAbout, setShowAbout] = useState(false);
  const [showValidate, setShowValidate] = useState(false);
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const reset = useUndoStore((s) => s.reset);
  const toast = useUndoStore((s) => s.toast);
  const clearToast = useUndoStore((s) => s.clearToast);
  const current = useCurrentPlaythrough();
  const playthroughId = current.data?.id ?? null;
  const list = usePlaythroughList();
  const openMut = useOpenPlaythrough();
  const [autoOpenAttempted, setAutoOpenAttempted] = useState(false);
  const takePendingRoute = useNavStore((s) => s.takePendingRoute);
  const pendingRoute = useNavStore((s) => s.pendingRoute);
  // Which factory the full-screen plan designer is editing, and where
  // its back button returns to.
  const [planFactoryId, setPlanFactoryId] = useState<string | null>(null);
  const [planFirstRun, setPlanFirstRun] = useState(false);
  const [planReturnRoute, setPlanReturnRoute] = useState<Route>("factories");

  // Cross-slice deep linking: the Network view's "open in graph" button
  // pushes "factories" through the nav store. AppShell owns route
  // state, so we read + clear here whenever a new pendingRoute lands.
  useEffect(() => {
    if (!pendingRoute) return;
    const next = takePendingRoute();
    if (!next || !isRoute(next)) return;
    if (next === "plan") {
      // openPlanDesigner pairs the route with a pending factory id;
      // without one there's nothing to design — ignore the request.
      const factoryId = useNavStore.getState().takePendingFactoryId();
      if (!factoryId) return;
      setPlanFactoryId(factoryId);
      setPlanFirstRun(takePlanFirstRunFlag());
      setPlanReturnRoute((prev) => (route === "plan" ? prev : route));
    }
    setRoute(next);
  }, [pendingRoute, takePendingRoute, route]);

  // First-paint convenience: if nothing is open but a previous run
  // touched at least one playthrough, auto-select the most-recently-
  // opened one (the registry already sorts list by that). Avoids the
  // "Welcome to S.P.E.C.S" empty-state every single launch when the
  // user actually has a playthrough in flight.
  useEffect(() => {
    if (autoOpenAttempted) return;
    if (current.isPending || list.isPending) return;
    if (current.data) {
      setAutoOpenAttempted(true);
      return;
    }
    const first = list.data?.[0];
    if (!first) {
      setAutoOpenAttempted(true);
      return;
    }
    setAutoOpenAttempted(true);
    openMut.mutate(first.id);
  }, [
    autoOpenAttempted,
    current.isPending,
    current.data,
    list.isPending,
    list.data,
    openMut,
  ]);

  // ⌘Z / Ctrl+Z undoes, ⌘⇧Z / Ctrl+Shift+Z redoes. Suppress when the
  // user is mid-edit in a text field so single-char undo doesn't fight
  // the browser's native input history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) {
        void redo();
      } else {
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Clearing the undo stack when the active playthrough changes avoids
  // an undo against playthrough A landing reverse calls against
  // playthrough B's DB. The toast naturally falls away too.
  useEffect(() => {
    reset();
  }, [playthroughId, reset]);

  // Auto-dismiss the undo / redo toast after a short window.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(clearToast, 1800);
    return () => window.clearTimeout(t);
  }, [toast, clearToast]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div
          className="text-lg font-semibold tracking-tight"
          title="Satisfactory Production Efficiency & Control System"
        >
          S.P.E.C.S
        </div>
        <div className="flex items-center gap-3">
          {/* Health dot lives to the left of the switcher per the
              "loud green badge" feedback — it's now a tiny indicator
              you only notice when something's wrong. */}
          <HealthBadge />
          <PlaythroughSwitcher />
          <Button
            variant="ghost"
            onClick={() => setShowValidate(true)}
            aria-label="Validate playthrough"
            disabled={!current.data}
            title="Sweep every factory, plan, claim and link for inconsistencies"
          >
            <ShieldCheck className="h-4 w-4" />
            <span className="text-xs">Validate</span>
          </Button>
          <Button variant="ghost" onClick={() => setShowAbout(true)} aria-label="About">
            <Info className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={toggle} aria-label="Toggle theme">
            {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showValidate && <ValidationPanel onClose={() => setShowValidate(false)} />}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-bg-raised px-4 py-1.5 text-xs text-fg shadow-lg"
        >
          {toast.kind === "undo" ? "Undid" : "Redid"}: {toast.label}
        </div>
      )}

      {route === "plan" && planFactoryId ? (
        // The designer takes the whole window below the header — no
        // sidebar, maximum canvas. Back returns to the launching tab.
        <div className="flex-1 overflow-hidden">
          <ErrorBoundary key={`plan-${planFactoryId}`} label="The plan designer">
            <PlanDesignerView
              factoryId={planFactoryId}
              firstRun={planFirstRun}
              onBack={() => setRoute(planReturnRoute)}
              onDeleted={() => {
                setPlanFactoryId(null);
                setRoute(planReturnRoute);
              }}
            />
          </ErrorBoundary>
        </div>
      ) : (
      <div className="flex flex-1 overflow-hidden">
        <nav
          aria-label="Main"
          className="flex w-48 shrink-0 flex-col gap-1 border-r border-border p-3"
        >
          {NAV
            // Until the user opens a playthrough, the per-playthrough
            // tabs render as empty-state hints. Hide them so the empty
            // home page is the obvious next step — Library stays
            // visible because the dataset is global.
            .filter(
              ({ id }) =>
                playthroughId !== null || id === "home" || id === "library",
            )
            .map(({ id, label, Icon }) => {
              const active = route === id;
              return (
                <button
                  key={id}
                  onClick={() => setRoute(id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-white"
                      : "text-fg-muted hover:bg-border hover:text-fg"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
        </nav>

        <main className="flex-1 overflow-auto p-6">
          {/* Per-route boundary keyed on the route id so a re-mount on
              tab switch resets a previous crash, and a crash in one
              tab can't blank the shell. */}
          <ErrorBoundary key={route} label={`The ${route} tab`}>
            {route === "home" && <HomeView goTo={(r) => setRoute(r)} />}
            {route === "network" && <NetworkView />}
            {route === "factories" && <FactoryListView />}
            {route === "logistics" && <LogisticsListView />}
            {route === "elevator" && <SpaceElevatorView />}
            {route === "trains" && <TrainRoutesView />}
            {route === "power" && <PowerView />}
            {route === "alts" && <AltsView />}
            {route === "resources" && <ResourcesView />}
            {route === "map" && <MapView />}
            {route === "library" && <LibraryView />}
          </ErrorBoundary>
        </main>
      </div>
      )}
    </div>
  );
}
