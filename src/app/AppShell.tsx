import { useEffect, useState } from "react";
import {
  BookOpen,
  Factory as FactoryIcon,
  FlaskConical,
  Info,
  LayoutDashboard,
  Moon,
  Network,
  Share2,
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
import { PlaythroughSwitcher } from "@/features/playthrough/components/PlaythroughSwitcher";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { PowerView } from "@/features/power/components/PowerView";
import { useUndoStore } from "@/shared/undo/store";

type Route =
  | "home"
  | "factories"
  | "logistics"
  | "trains"
  | "power"
  | "network"
  | "library"
  | "alts";

const NAV: ReadonlyArray<{ id: Route; label: string; Icon: typeof BookOpen }> = [
  { id: "home", label: "Home", Icon: LayoutDashboard },
  { id: "network", label: "Network", Icon: Share2 },
  { id: "factories", label: "Factories", Icon: FactoryIcon },
  { id: "logistics", label: "Logistics", Icon: Network },
  { id: "trains", label: "Trains", Icon: TrainTrack },
  { id: "power", label: "Power", Icon: Zap },
  { id: "alts", label: "Alts", Icon: FlaskConical },
  { id: "library", label: "Library", Icon: BookOpen },
];

export function AppShell() {
  const { mode, toggle } = useThemeMode();
  const [route, setRoute] = useState<Route>("home");
  const [showAbout, setShowAbout] = useState(false);
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const reset = useUndoStore((s) => s.reset);
  const toast = useUndoStore((s) => s.toast);
  const clearToast = useUndoStore((s) => s.clearToast);
  const playthroughId = useCurrentPlaythrough().data?.id ?? null;

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
          <Button variant="ghost" onClick={() => setShowAbout(true)} aria-label="About">
            <Info className="h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={toggle} aria-label="Toggle theme">
            {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-bg-raised px-4 py-1.5 text-xs text-fg shadow-lg"
        >
          {toast.kind === "undo" ? "Undid" : "Redid"}: {toast.label}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <nav
          aria-label="Main"
          className="flex w-48 shrink-0 flex-col gap-1 border-r border-border p-3"
        >
          {NAV.map(({ id, label, Icon }) => {
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
          {route === "home" && <HomeView goTo={(r) => setRoute(r)} />}
          {route === "network" && <NetworkView />}
          {route === "factories" && <FactoryListView />}
          {route === "logistics" && <LogisticsListView />}
          {route === "trains" && <TrainRoutesView />}
          {route === "power" && <PowerView />}
          {route === "alts" && <AltsView />}
          {route === "library" && <LibraryView />}
        </main>
      </div>
    </div>
  );
}
