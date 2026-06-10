import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Gauge, TriangleAlert } from "lucide-react";

import { Icon } from "@/shared/ui/Icon";
import type { BudgetAssumption, ResourceBudgetRow } from "../types";
import { useResourceBudget } from "../hooks/useResources";

const ASSUMPTION_STORAGE = "specs:budget:assumption";
const COLLAPSE_STORAGE = "specs:budget:collapsed";

const ASSUMPTIONS: Array<{ value: BudgetAssumption; label: string }> = [
  { value: "current_tier_best", label: "Current tier" },
  { value: "mk3_at_100", label: "Mk3 @ 100%" },
  { value: "mk3_at_250", label: "Mk3 @ 250%" },
];

// Same progression order the Resources page uses — game order beats
// alphabetical for "what do I unlock next" scanning.
const RESOURCE_ORDER: string[] = [
  "Desc_OreIron_C",
  "Desc_OreCopper_C",
  "Desc_Stone_C",
  "Desc_Coal_C",
  "Desc_OreGold_C",
  "Desc_RawQuartz_C",
  "Desc_Sulfur_C",
  "Desc_OreBauxite_C",
  "Desc_OreUranium_C",
  "Desc_SAM_C",
  "Desc_LiquidOil_C",
  "Desc_Water_C",
  "Desc_NitrogenGas_C",
];

function orderRows(rows: ResourceBudgetRow[]): ResourceBudgetRow[] {
  return [...rows]
    .filter((r) => r.kind !== "geyser")
    .sort((a, b) => {
      const ai = RESOURCE_ORDER.indexOf(a.resourceItemId);
      const bi = RESOURCE_ORDER.indexOf(b.resourceItemId);
      if (ai === -1 && bi === -1) return a.resourceItemId.localeCompare(b.resourceItemId);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
}

function fmtIpm(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

function loadAssumption(): BudgetAssumption {
  const v = localStorage.getItem(ASSUMPTION_STORAGE);
  return v === "mk3_at_100" || v === "mk3_at_250" || v === "current_tier_best"
    ? v
    : "current_tier_best";
}

export interface ResourceBudgetPanelProps {
  /** `full` = Resources page strip; `compact` = collapsible map dock. */
  variant: "full" | "compact";
}

export function ResourceBudgetPanel({ variant }: ResourceBudgetPanelProps) {
  const [assumption, setAssumption] = useState<BudgetAssumption>(loadAssumption);
  const [collapsed, setCollapsed] = useState(
    () => variant === "compact" && localStorage.getItem(COLLAPSE_STORAGE) !== "open",
  );
  const budget = useResourceBudget(assumption);

  const rows = useMemo(
    () => (budget.data ? orderRows(budget.data.rows) : []),
    [budget.data],
  );

  const pickAssumption = (next: BudgetAssumption) => {
    setAssumption(next);
    localStorage.setItem(ASSUMPTION_STORAGE, next);
  };
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_STORAGE, c ? "open" : "closed");
      return !c;
    });
  };

  if (variant === "compact" && collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        className="flex items-center gap-2 rounded-full border border-border bg-bg-raised/95 px-3 py-1.5 text-xs font-medium text-fg shadow-lg backdrop-blur hover:border-primary"
      >
        <Gauge className="h-3.5 w-3.5" />
        Resource budget
        <ChevronUp className="h-3 w-3 text-fg-muted" />
      </button>
    );
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Gauge className="h-4 w-4 text-primary" />
        Resource budget
        <span className="text-xs font-normal text-fg-muted">
          remaining at {budget.data?.assumptionLabel ?? "…"}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {ASSUMPTIONS.map((a) => (
          <button
            key={a.value}
            type="button"
            onClick={() => pickAssumption(a.value)}
            aria-pressed={assumption === a.value}
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              assumption === a.value
                ? "bg-primary text-white"
                : "text-fg-muted hover:bg-border hover:text-fg"
            }`}
          >
            {a.label}
          </button>
        ))}
        {variant === "compact" && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse resource budget"
            className="ml-1 rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={
        variant === "compact"
          ? "w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg-raised/95 p-3 shadow-lg backdrop-blur"
          : "rounded-lg border border-border bg-bg-raised p-4"
      }
    >
      {header}
      {budget.isError ? (
        <div className="mt-2 text-xs text-danger">Couldn't load the budget.</div>
      ) : (
        <div
          className={`mt-2 grid gap-x-4 gap-y-1.5 ${
            variant === "full" ? "grid-cols-[repeat(auto-fit,minmax(240px,1fr))]" : "grid-cols-1"
          }`}
        >
          {rows.map((r) => (
            <BudgetRow key={r.resourceItemId} row={r} compact={variant === "compact"} />
          ))}
        </div>
      )}
    </div>
  );
}

function BudgetRow({ row, compact }: { row: ResourceBudgetRow; compact: boolean }) {
  const exhausted = row.remainingIpm <= 0;
  const unclaimed = {
    pure: row.pure.total - row.pure.claimed,
    normal: row.normal.total - row.normal.claimed,
    impure: row.impure.total - row.impure.claimed,
  };
  const boundPct = row.worldMaxIpm > 0 ? (row.boundIpm / row.worldMaxIpm) * 100 : 0;
  const claimedPct =
    row.worldMaxIpm > 0 ? (row.claimedMaxIpm / row.worldMaxIpm) * 100 : 0;
  const isWell = row.kind === "fracking_well";
  const headroom = row.claimedMaxIpm - row.claimedIpm;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 text-fg">
          <Icon itemId={row.resourceItemId} alt="" className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {row.resourceItemName}
            {isWell && <span className="text-fg-muted"> (wells)</span>}
          </span>
          {(exhausted || row.overcommitted) && (
            <TriangleAlert className="h-3 w-3 shrink-0 text-danger" aria-label="Exhausted" />
          )}
        </span>
        <span
          className={`tabular-nums font-semibold ${exhausted ? "text-danger" : "text-fg"}`}
          title={`claimed ${fmtIpm(row.claimedIpm)} of ${fmtIpm(row.worldMaxIpm)} max${
            headroom > 0.5 ? ` · +${fmtIpm(headroom)} upgrade headroom on claims` : ""
          }`}
        >
          {fmtIpm(row.remainingIpm)}/min left
        </span>
      </div>
      {/* Stacked usage bar: bound → claimed (unbound) → remaining. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
        <div className="flex h-full">
          <div className="h-full bg-primary" style={{ width: `${Math.min(boundPct, 100)}%` }} />
          <div
            className="h-full bg-warning/70"
            style={{ width: `${Math.min(Math.max(claimedPct - boundPct, 0), 100)}%` }}
          />
        </div>
      </div>
      {!compact && (
        <div className="text-[10px] tabular-nums text-fg-muted">
          unclaimed {unclaimed.pure}P · {unclaimed.normal}N · {unclaimed.impure}I
          {row.overcommitted && (
            <span className="ml-2 text-danger">claims exceed this assumption</span>
          )}
        </div>
      )}
    </div>
  );
}
