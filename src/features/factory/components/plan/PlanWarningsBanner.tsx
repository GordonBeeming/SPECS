import { FlaskConical, TriangleAlert } from "lucide-react";

import type { PlanWarning, PlannerError } from "@/features/planner/types";
import { rate } from "@/shared/format/rates";

export function warningLine(w: PlanWarning): string {
  switch (w.kind) {
    case "rawShort":
      return `${w.itemName} — needs ${rate(w.demandIpm)}, claimed nodes supply ${rate(w.claimedIpm)} (claim more nodes)`;
    case "importUnsourced":
      return `${w.itemName} — ${rate(w.ipm)} unsourced (a future factory will supply this)`;
    case "importShort":
      return `${w.itemName} — sources are ${rate(w.gapIpm)} short of demand (raise a cap or add a source)`;
    case "fluidSurplus":
      return `${w.itemName} — ${rate(w.ipm)} of liquid has no consumer and will stall the line (use it in a recipe or export it)`;
    case "optimizerFellBack":
      return `Showing the standard-recipe chain — the optimizer couldn't finish (${w.reason})`;
    case "aboveTier": {
      // Naming every step is the point — "something is above tier" sends
      // you hunting the graph for which node it was.
      const shown = w.itemNames.slice(0, 4).join(", ");
      const rest = w.itemNames.length - 4;
      const steps = rest > 0 ? `${shown} and ${rest} more` : shown;
      return `Needs Tier ${w.requiredTier} — you're on Tier ${w.currentTier}. Out of reach: ${steps} (plan it now, build it once you get there)`;
    }
    case "targetUnplannable":
      return `${w.itemName} can't be planned — ${w.reason} (remove it or pick a different product)`;
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
        {warnings.every((w) => w.kind === "rawShort" || w.kind === "importUnsourced" || w.kind === "importShort")
          ? "Heads up — this plan isn't fully supplied yet"
          : "Heads up — this plan needs a look"}
      </div>
      <ul className="mt-1 flex flex-col gap-0.5 pl-5 text-fg-muted">
        {warnings.map((w, i) => (
          <li
            key={`${w.kind}-${"itemId" in w ? w.itemId : "general"}-${i}`}
            className="list-disc"
          >
            {warningLine(w)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Alt recipes this solve leans on that the playthrough hasn't scanned
 * yet. Deliberately not a `PlanWarning`: the chain is sound and
 * buildable in principle — "unlocked at its tier" and "collected" are
 * different questions, and this only answers the second. A hard drive
 * closes it, not a plan edit, which is why it reads calmer than the
 * amber warning block above rather than sharing it.
 */
export function UncollectedAltsBanner({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg"
    >
      <div className="flex items-center gap-1.5 font-semibold text-accent">
        <FlaskConical className="h-3.5 w-3.5" />
        Leans on {names.length} uncollected {names.length === 1 ? "alt" : "alts"}
      </div>
      <p className="mt-1 text-fg-muted">
        {names.join(", ")} — unlocked at their tier, not scanned into your Alts list yet.
      </p>
    </div>
  );
}
