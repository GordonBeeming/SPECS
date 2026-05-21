import { Icon } from "@/shared/ui/Icon";

import type { ChainPlan } from "../types";

interface ChainPreviewProps {
  plan: ChainPlan;
  /**
   * Optional — when provided, raw-demand chips colour green/red against
   * actually-claimed node supply. Omit (or pass `[]`) on surfaces that
   * don't have the node list handy.
   */
  nodes?: import("@/features/resources/types").ResourceNodeRow[];
  /**
   * Optional — surface a header above the stages with the target +
   * totals. The cross-factory PlannerView prints its own headers
   * outside the preview; the in-factory panel uses `showHeader` to get
   * one for free.
   */
  showHeader?: boolean;
  /**
   * Optional resolver for factory ids → display names. Falls back to
   * "Factory <short id>" when omitted.
   */
  factoryName?: (id: string) => string | undefined;
}

export function ChainPreview({
  plan,
  nodes,
  showHeader,
  factoryName,
}: ChainPreviewProps) {
  const supplyByItem = new Map<string, number>();
  for (const n of nodes ?? []) {
    if (!n.claim) continue;
    supplyByItem.set(
      n.resourceItemId,
      (supplyByItem.get(n.resourceItemId) ?? 0) + n.itemsPerMinute,
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {showHeader && (
        <div>
          <h3 className="text-sm font-semibold text-fg">
            {plan.targetIpm}/min {plan.targetItemName}
          </h3>
          <p className="text-xs text-fg-muted">
            {plan.stages.length}{" "}
            {plan.stages.length === 1 ? "stage" : "stages"} ·{" "}
            {plan.totalMachines} machines · {Math.round(plan.totalPowerMw)} MW
          </p>
        </div>
      )}

      {plan.imports.length > 0 && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">
            Imports
          </div>
          <ul className="mt-1 space-y-1 text-xs">
            {plan.imports.map((imp) => {
              const label =
                factoryName?.(imp.sourceFactoryId) ??
                `Factory ${imp.sourceFactoryId.slice(0, 8)}`;
              return (
                <li
                  key={`${imp.itemId}-${imp.sourceFactoryId}`}
                  className="flex items-center gap-2 tabular-nums"
                >
                  <Icon itemId={imp.itemId} className="h-3.5 w-3.5" />
                  <span className="font-medium text-fg">{imp.itemName}</span>
                  <span className="text-fg-muted">←</span>
                  <span className="text-fg">{label}</span>
                  <span className="ml-auto text-fg-muted">
                    {imp.resolvedIpm.toFixed(1)}/min
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ol className="flex flex-col gap-2">
        {plan.stages.map((s, i) => (
          <li
            key={`${s.recipeId}-${i}`}
            className="rounded-md border border-border bg-bg/50 p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {i + 1}
                </span>
                <Icon itemId={s.outputItemId} className="h-5 w-5" />
                <span className="font-medium">{s.recipeName}</span>
                {s.isAlt && (
                  <span className="rounded-full bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-500">
                    alt
                  </span>
                )}
              </div>
              <div className="text-xs text-fg-muted tabular-nums">
                {s.machineCount}× {s.buildingName} @ {s.clockPct.toFixed(0)}%
                · {Math.round(s.powerMw)} MW
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-fg-muted">in</div>
                <ul className="mt-1 space-y-1">
                  {s.inputs.map((io) => (
                    <li key={io.itemId} className="flex items-center gap-1">
                      <Icon itemId={io.itemId} className="h-3.5 w-3.5" />
                      {io.itemName}
                      <span className="tabular-nums text-fg-muted">
                        × {io.perMinute.toFixed(1)}/min
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-fg-muted">out</div>
                <ul className="mt-1 space-y-1">
                  {s.outputs.map((io) => (
                    <li key={io.itemId} className="flex items-center gap-1">
                      <Icon itemId={io.itemId} className="h-3.5 w-3.5" />
                      {io.itemName}
                      <span className="tabular-nums text-fg-muted">
                        × {io.perMinute.toFixed(1)}/min
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {Object.keys(plan.rawDemand).length > 0 && (
        <div className="rounded-md border border-dashed border-border p-3 text-xs">
          <div className="font-semibold uppercase tracking-wide text-fg-muted">
            Raw demand at the leaves
          </div>
          <ul className="mt-1 grid grid-cols-2 gap-1 md:grid-cols-3">
            {Object.entries(plan.rawDemand).map(([id, ipm]) => {
              const supplied = supplyByItem.get(id) ?? 0;
              const ok = !nodes || supplied >= ipm - 0.5;
              return (
                <li
                  key={id}
                  className="flex items-center gap-1 tabular-nums"
                  title={`Need ${Math.ceil(ipm)} ipm — claimed supply: ${Math.round(supplied)}`}
                >
                  <Icon itemId={id} className="h-3.5 w-3.5" />
                  <span className="truncate">
                    {id.replace(/^Desc_/, "").replace(/_C$/, "")}
                  </span>
                  <span className={ok ? "text-success" : "text-danger"}>
                    {Math.ceil(ipm)}
                    {nodes ? `/${Math.round(supplied)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
