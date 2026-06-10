import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Factory as FactoryGlyph, Hammer, Plus, Search, Trash2, X } from "lucide-react";

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
  allFactories: Array<{ id: string; name: string; iconId: string | null }>;
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

/** A factory's face in the source lists — its item icon, or the
 * generic glyph when it has none. */
function FactoryFace({ iconId }: { iconId: string | null | undefined }) {
  return iconId ? (
    <Icon itemId={iconId} alt="" className="h-4 w-4 shrink-0" />
  ) : (
    <FactoryGlyph className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
  );
}

/**
 * Where an item comes from: the local line ("build it here", elastic
 * remainder unless capped) plus any external factories. The add-list
 * is grouped by usefulness — factories whose remaining export covers
 * the whole need, then exporters that fall short, then everyone else
 * for the plan-backwards case — because "who can actually feed this?"
 * is the question being answered, and at hundreds of factories the
 * flat list stops working.
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
  const [search, setSearch] = useState("");

  const iconById = useMemo(
    () => new Map(allFactories.map((f) => [f.id, f.iconId])),
    [allFactories],
  );

  const indexed = sources.map((s, index) => ({ ...s, index }));
  const externals = indexed.filter((s) => s.sourceFactoryId !== factoryId);
  const selfRow = indexed.find((s) => s.sourceFactoryId === factoryId) ?? null;
  // No rows at all = implicit local production (the default state);
  // explicit local = a self row alongside externals.
  const hasLocal = sources.length === 0 || selfRow !== null;

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

  const matches = (name: string) =>
    search.trim() === "" || name.toLowerCase().includes(search.trim().toLowerCase());

  // Grouped add-list: covers the whole need / exports but short / rest.
  const coverers = itemOffers.filter(
    (o) => (o.product?.remainingIpm ?? 0) >= totalIpm - 1e-3 && matches(o.factoryName),
  );
  const shortExporters = itemOffers.filter(
    (o) => (o.product?.remainingIpm ?? 0) < totalIpm - 1e-3 && matches(o.factoryName),
  );
  const exporterIds = new Set(itemOffers.map((o) => o.factoryId));
  const otherFactories = allFactories.filter(
    (f) => f.id !== factoryId && !exporterIds.has(f.id) && matches(f.name),
  );

  const offerButton = (o: (typeof itemOffers)[number]) => (
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
          <FactoryFace iconId={iconById.get(o.factoryId)} />
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
  );

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
              <span className="flex min-w-0 items-center gap-1.5 text-fg">
                <Hammer className="h-3.5 w-3.5 shrink-0 text-primary" />
                Build it here
                <span className="tabular-nums text-fg-muted">{rate(localIpm)}</span>
              </span>
              {selfRow && externals.length > 0 && (
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={selfRow.ipmCap ?? ""}
                  placeholder="auto"
                  aria-label="Local build rate per minute"
                  title="Pin how much to build here — empty builds whatever imports don't cover"
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    onSetCap(
                      itemId,
                      selfRow.index,
                      v !== null && Number.isFinite(v) && v >= 0 ? v : null,
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-6 w-16 shrink-0 rounded-md border border-border bg-bg px-1.5 tabular-nums text-fg outline-none focus:border-primary"
                />
              )}
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
              {src.sourceFactoryId && <FactoryFace iconId={iconById.get(src.sourceFactoryId)} />}
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
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search factories…"
                aria-label="Search factories"
                className="h-7 w-full rounded-md border border-border bg-bg pl-7 pr-2 text-xs text-fg outline-none focus:border-primary"
              />
            </div>

            {offers.isPending && <div className="mt-2 text-fg-muted">Loading offers…</div>}

            {coverers.length > 0 && (
              <>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-success">
                  Can cover your {rate(totalIpm)}
                </div>
                <ul className="mt-1 space-y-1">{coverers.map(offerButton)}</ul>
              </>
            )}

            {shortExporters.length > 0 && (
              <>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-warning">
                  Exporting {itemName}, but short
                </div>
                <ul className="mt-1 space-y-1">{shortExporters.map(offerButton)}</ul>
              </>
            )}

            {!offers.isPending && coverers.length === 0 && shortExporters.length === 0 && (
              <div className="mt-2 text-fg-muted">
                Nobody exports this yet — pick any factory below and plan it there later.
              </div>
            )}

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
                        <FactoryFace iconId={f.iconId} />
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
