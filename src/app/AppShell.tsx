import { useState } from "react";
import {
  BookOpen,
  Factory as FactoryIcon,
  LayoutDashboard,
  Moon,
  Network,
  Sun,
} from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { useThemeMode } from "@/shared/theme/useThemeMode";
import { HealthBadge } from "@/features/health/components/HealthBadge";
import { LibraryView } from "@/features/library/components/LibraryView";
import { FactoryListView } from "@/features/factory/components/FactoryListView";
import { LogisticsListView } from "@/features/logistics/components/LogisticsListView";
import { PlaythroughSwitcher } from "@/features/playthrough/components/PlaythroughSwitcher";

type Route = "home" | "factories" | "logistics" | "library";

const NAV: ReadonlyArray<{ id: Route; label: string; Icon: typeof BookOpen }> = [
  { id: "home", label: "Home", Icon: LayoutDashboard },
  { id: "factories", label: "Factories", Icon: FactoryIcon },
  { id: "logistics", label: "Logistics", Icon: Network },
  { id: "library", label: "Library", Icon: BookOpen },
];

export function AppShell() {
  const { mode, toggle } = useThemeMode();
  const [route, setRoute] = useState<Route>("factories");

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
          <PlaythroughSwitcher />
          <HealthBadge />
          <Button variant="ghost" onClick={toggle} aria-label="Toggle theme">
            {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

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
          {route === "home" && <HomePanel />}
          {route === "factories" && <FactoryListView />}
          {route === "logistics" && <LogisticsListView />}
          {route === "library" && <LibraryView />}
        </main>
      </div>
    </div>
  );
}

function HomePanel() {
  return (
    <Card className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-primary">Welcome to S.P.E.C.S</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Satisfactory Production Efficiency &amp; Control System. Plan whole
        playthroughs: factories, cross-factory logistics, milestone-aware
        unlocks. Pick <strong>Library</strong> on the left to browse the
        bundled game data.
      </p>
      <ul className="mt-4 space-y-1 text-sm">
        <li>• Architecture &amp; slice rules: <code>docs/vsa/</code></li>
        <li>• Design system &amp; brand tokens: <code>DESIGN.md</code></li>
      </ul>
    </Card>
  );
}
