import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Factory as FactoryGlyph, Hammer, Plus, Trash2, X } from "lucide-react";

import { plannerApi } from "@/features/planner/api";
import type { PlanImportSpec } from "@/features/planner/types";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { Icon } from "@/shared/ui/Icon";

export interface SourcesPanelProps {
  factoryId: string;
  itemId: string;
  itemName: string;
  /** This item's source rows from the working plan, in order. */
  sources: PlanImportSpec[];
  /** What the graph says each share covers right now. */
  localIpm: number;
  totalIpm: number;
  factoryNames: Map<string, string>;
  allFactories: Array<{ id: string; name: string }>;
  onAddExternal: (itemId: string, sourceFactoryId: string | null, cap: number | null) => void;
  onRemoveSource: (itemId: string, index: number) => void;
  onAddLocal: (itemId: string) => void;
  onRemoveLocal: (itemId: string) => void;
  onSetCap: (itemId: string, index: number, cap: number | null) => void;
  onSetSource: (itemId: string, index: number, factoryId: string | null) => void;
  onClose: () => void;
}

function rate(n: number): string {
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}/min`;
}

/**
 * Where an item comes from: the local line ("build it here", elastic
 * remainder) plus any external factories. The add-list leads with
 * factories that EXPORT this item — name, what they offer, what's
 * still uncommitted — because that's the planning question being
 * answered; everything else sits behind a divider for the
 * plan-backwards case where the supplier isn't planned yet.
 */
export function SourcesPanel({
  factoryId,
  itemId,
  itemName,
  sources,
  localIpm,
  totalIpm,
  factoryNames,
  allFactories,
  onAddExternal,
  onRemoveSource,
  onAddLocal,
  onRemoveLocal,
  onSetCap,
  onSetSource,
  onClose,
}: SourcesPanelProps) {
  const playthrough = useCurrentPlaythrough();
  const offers = useQuery({
    queryKey: [...queryKeys.factory.exportOffers, playthrough.data?.id ?? null] as const,
    queryFn: plannerApi.listExportOffers,
    enabled: !!playthrough.data,
  });
  const [adding, setAdding] = useState(false);

  const externals = sources
    .map((s, index) => ({ ...s, index }))
    .filter((s) => s.sourceFactoryId !== factoryId);
  // No rows at all = implicit local production (the default state);
  // explicit local = a self row alongside externals.
  const hasLocal =
    sources.length === 0 || sources.some((s) => s.sourceFactoryId === factoryId);

  const itemOffers = useMemo(
    () =>
      (offers.data ?? [])
        .map((o) => ({
          ...o,
          product: o.products.find((p) => p.itemId === itemId) ?? null,
        }))
        .filter((o) => o.product !== null && o.factoryId !== factoryId),
    [offers.data, itemId, factoryId],
  );
  const otherFactories = useMemo(() => {
    const exporterIds = new Set(itemOffers.map((o) => o.factoryId));
    return allFactories.filter((f) => f.id !== factoryId && !exporterIds.has(f.id));
  }, [allFactories, itemOffers, factoryId]);

  return (
    <div className="flex max-h-full w-[340px] flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
          <Icon itemId={itemId} alt="" className="h-5 w-5 shrink-0" />
          <span className="truncate">Sources · {itemName}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sources"
          className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
          Current sources · {rate(totalIpm)} needed
        </div>
        <ul className="mt-1.5 space-y-1.5">
          {hasLocal && (
            <li className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
              <span className="flex items-center gap-1.5 text-fg">
                <Hammer className="h-3.5 w-3.5 text-primary" />
                Build it here
                <span className="tabular-nums text-fg-muted">{rate(localIpm)}</span>
              </span>
              <button
                type="button"
                aria-label="Remove local production"
                title={
                  externals.length === 0
                    ? "Add an external source first — something has to supply this"
                    : "Stop building this here; imports cover everything"
                }
                disabled={externals.length === 0}
                onClick={() => onRemoveLocal(itemId)}
                className="rounded p-1 text-fg-muted hover:bg-border hover:text-danger disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          )}
          {!hasLocal && (
            <li>
              <button
                type="button"
                onClick={() => onAddLocal(itemId)}
                className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-fg-muted hover:border-primary hover:text-fg"
              >
                <Hammer className="h-3.5 w-3.5" />
                Build it here too
              </button>
            </li>
          )}
          {externals.map((src) => (
            <li
              key={src.index}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-fg">
                {src.sourceFactoryId
                  ? factoryNames.get(src.sourceFactoryId) ?? src.sourceFactoryId
                  : "A future factory"}
              </span>
              {src.sourceFactoryId === null && (
                <select
                  aria-label="Assign source factory"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) onSetSource(itemId, src.index, e.target.value);
                  }}
                  className="h-6 w-24 rounded-md border border-border bg-bg px-1 text-[11px] text-fg outline-none focus:border-primary"
                >
                  <option value="">assign…</option>
                  {allFactories
                    .filter((f) => f.id !== factoryId)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              )}
              <input
                type="number"
                min={0}
                step={1}
                value={src.ipmCap ?? ""}
                placeholder="cap"
                aria-label="Source cap per minute"
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  onSetCap(itemId, src.index, v !== null && Number.isFinite(v) && v > 0 ? v : null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="h-6 w-16 shrink-0 rounded-md border border-border bg-bg px-1.5 tabular-nums text-fg outline-none focus:border-primary"
              />
              <button
                type="button"
                aria-label="Remove source"
                onClick={() => onRemoveSource(itemId, src.index)}
                className="rounded p-1 text-fg-muted hover:bg-border hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>

        {adding ? (
          <div className="mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
              Factories exporting {itemName}
            </div>
            {offers.isPending && <div className="mt-1 text-fg-muted">Loading offers…</div>}
            {!offers.isPending && itemOffers.length === 0 && (
              <div className="mt-1 text-fg-muted">
                Nobody exports this yet — pick any factory below and plan it there later.
              </div>
            )}
            <ul className="mt-1 space-y-1">
              {itemOffers.map((o) => (
                <li key={o.factoryId}>
                  <button
                    type="button"
                    onClick={() => {
                      onAddExternal(itemId, o.factoryId, null);
                      setAdding(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-left hover:border-accent"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <FactoryGlyph className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                      <span className="truncate text-fg">{o.factoryName}</span>
                    </span>
                    <span
                      className={`tabular-nums ${
                        (o.product?.remainingIpm ?? 0) > 0 ? "text-success" : "text-warning"
                      }`}
                      title={`Exports ${rate(o.product?.exportIpm ?? 0)} · ${rate(
                        o.product?.drawnIpm ?? 0,
                      )} already drawn by others`}
                    >
                      {rate(o.product?.remainingIpm ?? 0)} left
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {otherFactories.length > 0 && (
              <>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  Not exporting this (plan it there later)
                </div>
                <ul className="mt-1 space-y-1">
                  {otherFactories.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onAddExternal(itemId, f.id, null);
                          setAdding(false);
                        }}
                        className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-left text-fg-muted hover:border-accent hover:text-fg"
                      >
                        <FactoryGlyph className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                onAddExternal(itemId, null, null);
                setAdding(false);
              }}
              className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-dashed border-warning/60 px-2 py-1.5 text-warning hover:bg-warning/10"
            >
              <Plus className="h-3.5 w-3.5" />A future factory (unsourced)
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1.5 text-fg-muted hover:border-accent hover:text-fg"
          >
            <Plus className="h-3.5 w-3.5" />
            Add source
          </button>
        )}
      </div>
    </div>
  );
}
