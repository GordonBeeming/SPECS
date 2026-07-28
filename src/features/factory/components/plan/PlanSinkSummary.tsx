import { Recycle } from "lucide-react";

import { Icon } from "@/shared/ui/Icon";
import type { PlanGraph } from "@/features/planner/types";
import { isReportable, rate } from "./rates";

/**
 * What this plan throws away, on the way in rather than buried on the
 * canvas.
 *
 * Byproduct routing is the good part — heavy oil residue gets consumed
 * rather than orphaned — but whatever's left goes to the sink, and how
 * much is being sunk is the number that separates a balanced refinery
 * from one burning a third of its throughput. Finding it meant finding
 * the sink node on the graph, which is exactly the sort of thing nobody
 * does until the ratios are already wrong.
 */
export function PlanSinkSummary({ graph }: { graph: PlanGraph }) {
  const sunk = graph.nodes
    // A surplus that prints as "0.0/min" is float dust off an otherwise
    // balanced line, not something anyone can act on.
    .filter((n) => n.kind === "byproduct" && !n.isFluid && isReportable(n.surplusIpm))
    .map((n) => (n.kind === "byproduct" ? n : null))
    .filter((n): n is Extract<PlanGraph["nodes"][number], { kind: "byproduct" }> => n !== null)
    .sort((a, b) => b.surplusIpm - a.surplusIpm);
  if (sunk.length === 0) return null;

  return (
    // Deliberately not the warnings banner's amber wash: sinking
    // surplus is a fact about the plan, not a gap to close, and two
    // identical amber strips stacked would flatten the difference.
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-bg-raised px-3 py-2 text-xs text-fg"
    >
      <span className="flex items-center gap-1.5 font-semibold text-warning">
        <Recycle className="h-3.5 w-3.5" />
        Sinking
      </span>
      {sunk.map((n) => (
        <span key={n.nodeKey} className="flex items-center gap-1.5">
          <Icon itemId={n.itemId} alt="" className="h-4 w-4 shrink-0" />
          <span className="tabular-nums font-medium">{rate(n.surplusIpm)}</span>
          <span className="text-fg-muted">{n.itemName}</span>
        </span>
      ))}
      <span className="text-fg-muted">— use it in a recipe or export it to stop paying for it</span>
    </div>
  );
}
