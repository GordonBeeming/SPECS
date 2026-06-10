import { TriangleAlert } from "lucide-react";

import type { PlanWarning, PlannerError } from "@/features/planner/types";

function rate(n: number): string {
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}/min`;
}

function warningLine(w: PlanWarning): string {
  switch (w.kind) {
    case "rawShort":
      return `${w.itemName} — needs ${rate(w.demandIpm)}, claimed nodes supply ${rate(w.claimedIpm)} (claim more nodes)`;
    case "importUnsourced":
      return `${w.itemName} — ${rate(w.ipm)} unsourced (a future factory will supply this)`;
    case "importShort":
      return `${w.itemName} — sources are ${rate(w.gapIpm)} short of demand (raise a cap or add a source)`;
  }
}

export function errorLine(e: PlannerError): string {
  switch (e.kind) {
    case "unknownTarget":
      return `Unknown item: ${e.itemId}`;
    case "noRecipeForTarget":
      return `No recipe produces ${e.itemId} — raw resources come from claimed nodes, not plans`;
    case "cycleDetected":
      return `Recipe cycle involving ${e.itemId} — please report this`;
  }
}

/** Amber, never red: these are gaps to close, not blockers. The plan
 * renders and saves regardless. */
export function PlanWarningsBanner({ warnings }: { warnings: PlanWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-fg"
    >
      <div className="flex items-center gap-1.5 font-semibold text-warning">
        <TriangleAlert className="h-3.5 w-3.5" />
        Heads up — this plan isn't fully supplied yet
      </div>
      <ul className="mt-1 flex flex-col gap-0.5 pl-5 text-fg-muted">
        {warnings.map((w, i) => (
          <li key={`${w.kind}-${w.itemId}-${i}`} className="list-disc">
            {warningLine(w)}
          </li>
        ))}
      </ul>
    </div>
  );
}
