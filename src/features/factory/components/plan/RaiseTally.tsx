import { TrendingUp, TriangleAlert, X } from "lucide-react";

import type { PlanWarning, RaiseExportTargetResult } from "@/features/planner/types";

import { warningLine } from "./PlanWarningsBanner";
import { rate } from "@/shared/format/rates";

/** One gap left open somewhere upstream, with the factory it's in. */
export interface OpenGap {
  key: string;
  factoryId: string;
  factoryName: string;
  line: string;
}

/** What a finding is *about*, so the same gap reported by two raises
 * counts once. Mirrors `warning_subject` on the Rust side. */
function warningSubject(w: PlanWarning): string {
  return "itemId" in w ? `${w.kind}:${w.itemId}` : w.kind;
}

/**
 * Every gap the session's raises left open, latest reading per gap.
 *
 * Raising five exporters in a row gives you five reports, each replaced
 * by the next, so the running cost of the whole re-scale only exists on
 * the Validate screen — by which time you've left the plan you were
 * designing. This is that cost, kept where the decisions are being
 * made. It is deliberately accounting and not action: what closes one
 * of these could be claiming a node, raising a further exporter or
 * swapping a recipe, and one click must never rewrite an unbounded fan
 * of factories.
 */
export function openGaps(log: RaiseExportTargetResult[]): OpenGap[] {
  const byKey = new Map<string, OpenGap>();
  for (const entry of log) {
    for (const w of [...entry.introducedWarnings, ...entry.worsenedWarnings]) {
      const key = `${entry.factoryId}:${warningSubject(w)}`;
      byKey.set(key, {
        key,
        factoryId: entry.factoryId,
        factoryName: entry.factoryName,
        line: warningLine(w),
      });
    }
  }
  return [...byKey.values()];
}

/** One line per raise, latest first, deduped per (factory, item) so a
 * double raise of the same target reads as one move. */
function raiseLines(log: RaiseExportTargetResult[]): RaiseExportTargetResult[] {
  const byKey = new Map<string, RaiseExportTargetResult>();
  for (const entry of log) byKey.set(`${entry.factoryId}:${entry.itemId}`, entry);
  return [...byKey.values()].reverse();
}

export interface RaiseTallyProps {
  log: RaiseExportTargetResult[];
  onClear: () => void;
}

/** The running cost of this session's raises, collapsed by default. */
export function RaiseTally({ log, onClear }: RaiseTallyProps) {
  const raises = raiseLines(log);
  if (raises.length === 0) return null;
  const gaps = openGaps(log);

  return (
    <details className="mb-2 rounded-md border border-border bg-bg px-2 py-1.5">
      <summary className="flex cursor-pointer items-center gap-1.5 text-fg-muted marker:text-fg-muted">
        <TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-fg">
          {raises.length} {raises.length === 1 ? "raise" : "raises"} in this plan
          {gaps.length > 0 ? (
            <>
              {" · "}
              <span className="text-warning">
                {gaps.length} {gaps.length === 1 ? "gap" : "gaps"} left open
              </span>
            </>
          ) : (
            " · nothing left open"
          )}
        </span>
        <button
          type="button"
          onClick={(e) => {
            // Inside a <summary>, so the click would toggle the panel too.
            e.preventDefault();
            onClear();
          }}
          aria-label="Clear raise history"
          className="shrink-0 rounded p-0.5 hover:bg-border hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </summary>

      <ul className="mt-1.5 flex flex-col gap-0.5 pl-5 text-fg-muted">
        {raises.map((r) => (
          <li key={`${r.factoryId}:${r.itemId}`} className="list-disc">
            <span className="text-fg">{r.factoryName}</span> — {r.itemName}{" "}
            {rate(r.previousTargetIpm)} → {rate(r.newTargetIpm)}
          </li>
        ))}
      </ul>

      {gaps.length > 0 && (
        <>
          <div className="mt-1.5 flex items-center gap-1.5 font-semibold text-warning">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            Still open after all of that
          </div>
          <ul className="mt-1 flex flex-col gap-0.5 pl-5 text-fg-muted">
            {gaps.map((g) => (
              <li key={g.key} className="list-disc">
                <span className="text-fg">{g.factoryName}</span> — {g.line}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
