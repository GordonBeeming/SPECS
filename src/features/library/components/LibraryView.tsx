import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { useLibrarySummary } from "../hooks/useLibrary";
import { ItemsTable } from "./ItemsTable";
import { BuildingsTable } from "./BuildingsTable";
import { RecipesTable } from "./RecipesTable";
import { MilestonesTable } from "./MilestonesTable";
import { TransportTable } from "./TransportTable";

type Tab = "items" | "buildings" | "recipes" | "milestones" | "transport";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "items", label: "Items" },
  { id: "buildings", label: "Buildings" },
  { id: "recipes", label: "Recipes" },
  { id: "milestones", label: "Milestones" },
  { id: "transport", label: "Belts & Pipes" },
];

const tabId = (t: Tab) => `library-tab-${t}`;
const panelId = (t: Tab) => `library-panel-${t}`;

export function LibraryView() {
  const [tab, setTab] = useState<Tab>("items");
  const summary = useLibrarySummary();

  return (
    <div className="flex h-full flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-primary">Library</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Read-only browser over the bundled Satisfactory game data.
              Milestone gating overlays land in Phase&nbsp;3.
            </p>
          </div>
          {summary.isError ? (
            <div role="alert" className="flex items-center gap-2 text-xs text-danger">
              <AlertTriangle className="h-3 w-3" />
              Couldn't load dataset summary
              {summary.error instanceof Error ? `: ${summary.error.message}` : null}
            </div>
          ) : summary.data ? (
            <div className="text-xs text-fg-muted tabular-nums">
              dataset <span className="font-mono">{summary.data.datasetVersion}</span> · game{" "}
              <span className="font-mono">{summary.data.gameVersion}</span> · {summary.data.itemCount} items ·{" "}
              {summary.data.recipeCount} recipes · {summary.data.buildingCount} buildings ·{" "}
              {summary.data.milestoneCount} milestones
            </div>
          ) : (
            <div className="text-xs text-fg-muted">
              <Loader2 className="inline h-3 w-3 animate-spin" /> Loading dataset…
            </div>
          )}
        </div>
      </Card>

      <Card className="flex flex-1 flex-col gap-4 overflow-hidden">
        <nav role="tablist" aria-label="Library category" className="flex flex-wrap gap-1 border-b border-border pb-2">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                id={tabId(t.id)}
                role="tab"
                aria-selected={active}
                aria-controls={panelId(t.id)}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-white"
                    : "text-fg-muted hover:bg-border hover:text-fg"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div
          id={panelId(tab)}
          role="tabpanel"
          aria-labelledby={tabId(tab)}
          className="flex-1 overflow-auto"
        >
          {tab === "items" && <ItemsTable />}
          {tab === "buildings" && <BuildingsTable />}
          {tab === "recipes" && <RecipesTable />}
          {tab === "milestones" && <MilestonesTable />}
          {tab === "transport" && <TransportTable />}
        </div>
      </Card>
    </div>
  );
}
