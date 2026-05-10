import { Moon, Sun } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { useThemeMode } from "@/shared/theme/useThemeMode";
import { HealthBadge } from "@/features/health/components/HealthBadge";

export function AppShell() {
  const { mode, toggle } = useThemeMode();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div
          className="text-lg font-semibold tracking-tight"
          title="Satisfactory Production Efficiency & Control System"
        >
          S.P.E.C.S
        </div>
        <div className="flex items-center gap-3">
          <HealthBadge />
          <Button variant="ghost" onClick={toggle} aria-label="Toggle theme">
            {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <Card className="mx-auto max-w-2xl">
          <h1 className="text-xl font-semibold text-[var(--color-primary)]">
            Phase 1 scaffolding
          </h1>
          <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
            Tauri + React + Vertical Slice Architecture is wired up. The status
            badge in the header proves the Rust core is reachable. Next phase
            adds the playthrough store and game-data library.
          </p>
          <ul className="mt-4 space-y-1 text-sm">
            <li>• Architecture &amp; slice rules: <code>docs/vsa/</code></li>
            <li>• Design system &amp; brand tokens: <code>DESIGN.md</code></li>
            <li>• Plan: <code>~/.claude/plans/i-m-building-a-satisfactpory-snoopy-pebble.md</code></li>
          </ul>
        </Card>
      </main>
    </div>
  );
}
