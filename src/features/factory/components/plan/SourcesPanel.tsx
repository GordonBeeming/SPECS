import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Factory as FactoryGlyph,
  Hammer,
  Loader2,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";

import { factoryDistanceMeters } from "@/features/map/transform";
import { plannerApi } from "@/features/planner/api";
import type {
  ExportOfferProduct,
  ImportAllocation,
  PlanImportSpec,
  RaiseExportTargetResult,
} from "@/features/planner/types";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { invoke } from "@/shared/tauri/invoke";
import { Icon } from "@/shared/ui/Icon";
import { warningLine } from "./PlanWarningsBanner";
import { RaiseTally } from "./RaiseTally";
import { isReportable, rate } from "./rates";

export interface SourcesPanelProps {
  factoryId: string;
  itemId: string;
  itemName: string;
  /** This item's source rows from the working plan, in order. */
  sources: PlanImportSpec[];
  /** What the graph says each share covers right now. */
  localIpm: number;
  totalIpm: number;
  /** What the last solve actually pulled from each sourced row. */
  allocations: ImportAllocation[];
  /** Demand no current source covers — the number a top-up has to close. */
  unassignedIpm: number;
  factoryNames: Map<string, string>;
  allFactories: Array<{ id: string; name: string; iconId: string | null; worldX: number; worldY: number }>;
  /** Every raise made from this designer, oldest first. */
  raiseLog: RaiseExportTargetResult[];
  onRaised: (result: RaiseExportTargetResult) => void;
  onClearRaiseLog: () => void;
  onAddExternal: (itemId: string, sourceFactoryId: string | null, cap: number | null) => void;
  onRemoveSource: (itemId: string, index: number) => void;
  onAddLocal: (itemId: string) => void;
  onRemoveLocal: (itemId: string) => void;
  onSetCap: (itemId: string, index: number, cap: number | null) => void;
  onSetSource: (itemId: string, index: number, factoryId: string | null) => void;
  onClose: () => void;
}

function distanceLabel(m: number): string {
  return `${Math.round(m).toLocaleString()} m away`;
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
 * remainder unless capped) plus any external factories.
 *
 * The add-list is grouped by what it would take to use each factory —
 * ones whose spare already covers the whole need, ones that make it and
 * just haven't opened an export slice, then ones that would need to
 * build more — because "who can actually feed this?" is the question
 * being answered, and at hundreds of factories the flat list stops
 * working. Everything else follows for the plan-backwards case.
 *
 * Every group carries the way through with it, so a factory that makes
 * the item is never a dead end here whatever state its export slice is
 * in. A producer with no slice open is the case that most looks like
 * one: picking it adds a row supplying 0/min until somebody opens the
 * slice, so the row has to either open it or say what it's waiting on.
 */
export function SourcesPanel({
  factoryId,
  itemId,
  itemName,
  sources,
  localIpm,
  totalIpm,
  allocations,
  unassignedIpm,
  factoryNames,
  allFactories,
  raiseLog,
  onRaised,
  onClearRaiseLog,
  onAddExternal,
  onRemoveSource,
  onAddLocal,
  onRemoveLocal,
  onSetCap,
  onSetSource,
  onClose,
}: SourcesPanelProps) {
  const playthrough = useCurrentPlaythrough();
  const queryClient = useQueryClient();
  const offers = useQuery({
    queryKey: [...queryKeys.factory.exportOffers, playthrough.data?.id ?? null] as const,
    queryFn: plannerApi.listExportOffers,
    enabled: !!playthrough.data,
  });
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  // The last raise's outcome, held until dismissed. Whatever the raise
  // cost the exporter has to stay readable while the user decides what
  // to do about it — a toast that fades is the wrong shape for a
  // consequence nobody has acted on yet.
  const [raised, setRaised] = useState<RaiseExportTargetResult | null>(null);

  const raiseTarget = useMutation({
    mutationFn: (input: {
      exporterFactoryId: string;
      neededIpm: number;
      /** Add the exporter as a source once it can actually supply. */
      thenAdd?: boolean;
    }) =>
      plannerApi.raiseExportTarget(input.exporterFactoryId, itemId, input.neededIpm, factoryId),
    onSuccess: (result, input) => {
      setRaised(result);
      onRaised(result);
      if (input.thenAdd) {
        // Only now: adding first would re-solve this plan against an
        // export slice that didn't exist yet and resolve to 0/min.
        onAddExternal(itemId, input.exporterFactoryId, null);
        setAdding(false);
      }
      // The exporter's plan, machines and links all moved, and the
      // offer list this panel reads is derived from them.
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.exportOffers });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.plan(result.factoryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.detail(result.factoryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.ledger(result.factoryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.list });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.unsourcedInputs });
      queryClient.invalidateQueries({ queryKey: queryKeys.logistics.list });
    },
  });
  const raiseError = raiseTarget.error;

  // The report is about one raise of one item. Switching the panel to
  // another item used to leave it pinned at the top, reading as though
  // it described the item just opened.
  const { reset: resetRaise } = raiseTarget;
  useEffect(() => {
    setRaised(null);
    resetRaise();
  }, [itemId, resetRaise]);

  const iconById = useMemo(
    () => new Map(allFactories.map((f) => [f.id, f.iconId])),
    [allFactories],
  );

  // This factory's own map position, for measuring how far each
  // candidate/current source sits — `null` when either side hasn't been
  // placed on the map yet (see `factoryDistanceMeters`'s (0,0) guard).
  const selfFactory = useMemo(
    () => allFactories.find((f) => f.id === factoryId) ?? null,
    [allFactories, factoryId],
  );
  const distanceById = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!selfFactory) return m;
    for (const f of allFactories) {
      if (f.id === factoryId) continue;
      m.set(f.id, factoryDistanceMeters(selfFactory, f));
    }
    return m;
  }, [allFactories, selfFactory, factoryId]);

  const indexed = sources.map((s, index) => ({ ...s, index }));
  const externals = indexed.filter((s) => s.sourceFactoryId !== factoryId);
  const selfRow = indexed.find((s) => s.sourceFactoryId === factoryId) ?? null;
  // No rows at all = implicit local production (the default state);
  // explicit local = a self row alongside externals.
  const hasLocal = sources.length === 0 || selfRow !== null;

  // Factories already sourcing this item — re-clicking one of these in the
  // add-list used to push a second identical import row (and, on save, a
  // second logistics link for the same pair). Filtering them out of the
  // add-list is the belt-and-suspenders half of that fix: the state-level
  // dedup in `addExternalSource` is the one that actually can't be bypassed,
  // this just stops the accidental click from being offered in the first
  // place. Unsourced "future factory" placeholders have no factory id to
  // exclude by, so they don't shrink this list.
  const alreadySourcedIds = new Set(
    externals
      .map((s) => s.sourceFactoryId)
      .filter((id): id is string => id !== null),
  );

  // What each factory makes of this item, current sources included —
  // a row already in the list still needs its producer's numbers to
  // explain why it's supplying what it's supplying.
  const productByFactory = useMemo(() => {
    const m = new Map<string, ExportOfferProduct>();
    for (const o of offers.data ?? []) {
      const product = o.products.find((p) => p.itemId === itemId);
      if (product) m.set(o.factoryId, product);
    }
    return m;
  }, [offers.data, itemId]);

  const resolvedBySource = useMemo(
    () => new Map(allocations.map((a) => [a.sourceFactoryId, a.resolvedIpm])),
    [allocations],
  );

  const itemOffers = (offers.data ?? [])
    .map((o) => ({ ...o, product: productByFactory.get(o.factoryId) ?? null }))
    .filter(
      (o) => o.product !== null && o.factoryId !== factoryId && !alreadySourcedIds.has(o.factoryId),
    );

  const matches = (name: string) =>
    search.trim() === "" || name.toLowerCase().includes(search.trim().toLowerCase());

  const visibleOffers = itemOffers.filter((o) => matches(o.factoryName));
  // Grouped add-list: spare already covers the need / makes enough but
  // exports none of it / would have to build more.
  const coverers = visibleOffers.filter(
    (o) => (o.product?.remainingIpm ?? 0) >= totalIpm - 1e-3,
  );
  const exportables = visibleOffers.filter(
    (o) =>
      (o.product?.remainingIpm ?? 0) < totalIpm - 1e-3 &&
      (o.product?.spareIpm ?? 0) >= totalIpm - 1e-3,
  );
  const shortExporters = visibleOffers.filter(
    (o) =>
      (o.product?.remainingIpm ?? 0) < totalIpm - 1e-3 &&
      (o.product?.spareIpm ?? 0) < totalIpm - 1e-3,
  );
  const exporterIds = new Set(itemOffers.map((o) => o.factoryId));
  const otherFactories = allFactories.filter(
    (f) =>
      f.id !== factoryId &&
      !exporterIds.has(f.id) &&
      !alreadySourcedIds.has(f.id) &&
      matches(f.name),
  );
  // "Nobody makes this yet" is false when the only factory that makes it
  // is sitting in Current sources — which is exactly when the user is
  // looking for a way to get more out of it.
  const sourcedProducers = externals.filter(
    (s) => s.sourceFactoryId !== null && productByFactory.has(s.sourceFactoryId),
  );

  const raising = (exporterFactoryId: string) =>
    raiseTarget.isPending && raiseTarget.variables?.exporterFactoryId === exporterFactoryId;

  /**
   * A candidate exporter. Whatever stands between the factory and the
   * need comes with the row: the panel already knows the factory, the
   * item and the shortfall, and making the user leave the plan to sort
   * it out by hand is how importing a shared intermediate stops being
   * worth doing at all.
   */
  const offerButton = (o: (typeof itemOffers)[number]) => {
    const distanceM = distanceById.get(o.factoryId) ?? null;
    const remaining = o.product?.remainingIpm ?? 0;
    const spare = o.product?.spareIpm ?? 0;
    const produced = o.product?.producedIpm ?? 0;
    const exportsNone = (o.product?.exportIpm ?? 0) <= 0;
    const covers = remaining >= totalIpm - 1e-3;
    // Its machines already make enough; only the export slice is shut.
    const justNeedsExporting = !covers && spare >= totalIpm - 1e-3;
    const isPending = raising(o.factoryId);
    return (
      <li key={o.factoryId}>
        <div
          className={`rounded-md border ${
            covers
              ? "border-border hover:border-accent"
              : justNeedsExporting
                ? "border-primary/40"
                : "border-warning/40"
          }`}
        >
          <button
            type="button"
            disabled={raiseTarget.isPending}
            onClick={() => {
              if (justNeedsExporting) {
                // One gesture: open the slice, then take the source.
                raiseTarget.mutate({
                  exporterFactoryId: o.factoryId,
                  neededIpm: totalIpm,
                  thenAdd: true,
                });
                return;
              }
              onAddExternal(itemId, o.factoryId, null);
              setAdding(false);
            }}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left disabled:opacity-50"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <FactoryFace iconId={iconById.get(o.factoryId)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">{o.factoryName}</span>
                {distanceM != null && (
                  <span className="block text-[10px] text-fg-muted">{distanceLabel(distanceM)}</span>
                )}
              </span>
            </span>
            {exportsNone ? (
              <span
                className="shrink-0 tabular-nums text-fg-muted"
                title={`Makes ${rate(produced)} · none of it offered for export yet`}
              >
                {rate(spare)} spare
              </span>
            ) : (
              <span
                className={`shrink-0 tabular-nums ${remaining > 0 ? "text-success" : "text-warning"}`}
                title={`Exports ${rate(o.product?.exportIpm ?? 0)} · ${rate(
                  o.product?.drawnIpm ?? 0,
                )} already drawn by others`}
              >
                {rate(remaining)} left
              </span>
            )}
          </button>
          {justNeedsExporting && (
            <div className="flex items-center gap-1.5 border-t border-primary/30 px-2 py-1 text-[10px] text-fg-muted">
              {isPending ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              ) : (
                <Upload className="h-3 w-3 shrink-0 text-primary" />
              )}
              <span className="min-w-0">
                Makes {rate(produced)} and exports none — picking it opens a {rate(totalIpm)} export
                slice. No extra machines.
              </span>
            </div>
          )}
          {!covers && !justNeedsExporting && (
            <div className="flex items-center justify-between gap-2 border-t border-warning/30 px-2 py-1">
              <span className="min-w-0 truncate text-[10px] text-fg-muted">
                Needs {rate(totalIpm - spare)} more
              </span>
              <button
                type="button"
                disabled={raiseTarget.isPending}
                onClick={() =>
                  raiseTarget.mutate({ exporterFactoryId: o.factoryId, neededIpm: totalIpm })
                }
                title={`Raise ${o.factoryName}'s ${itemName} target so it can spare your ${rate(totalIpm)}`}
                className="flex shrink-0 items-center gap-1 rounded border border-warning/50 px-1.5 py-0.5 text-[11px] font-medium text-warning hover:bg-warning/10 disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <TrendingUp className="h-3 w-3" />
                )}
                Raise target
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

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
        {raiseError && (
          <div
            role="alert"
            className="mb-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-danger"
          >
            Couldn't raise that target:{" "}
            {raiseError instanceof Error ? raiseError.message : String(raiseError)}
          </div>
        )}

        {raised && (
          <div
            role="status"
            className="mb-2 rounded-md border border-border bg-bg px-2 py-1.5 text-fg-muted"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-fg">
                <span className="font-semibold">{raised.factoryName}</span> now makes{" "}
                {rate(raised.newTargetIpm)} {raised.itemName} — {rate(raised.remainingIpm)} spare
                for you.
              </span>
              <button
                type="button"
                onClick={() => {
                  setRaised(null);
                  raiseTarget.reset();
                }}
                aria-label="Dismiss"
                className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-border hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {raised.introducedWarnings.length > 0 && (
              <>
                <div className="mt-1.5 flex items-center gap-1.5 font-semibold text-warning">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  That left {raised.factoryName} short
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 pl-5">
                  {raised.introducedWarnings.map((w, i) => (
                    <li key={`${w.kind}-${"itemId" in w ? w.itemId : "general"}-${i}`} className="list-disc">
                      {warningLine(w)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {/* A gap that was already open is a different sentence from
                one this click opened, and the difference decides whether
                you go looking for what you just broke. */}
            {raised.worsenedWarnings.length > 0 && (
              <>
                <div className="mt-1.5 flex items-center gap-1.5 font-semibold text-warning">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  That widened a shortfall {raised.factoryName} already had
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 pl-5">
                  {raised.worsenedWarnings.map((w, i) => (
                    <li key={`${w.kind}-${"itemId" in w ? w.itemId : "general"}-${i}`} className="list-disc">
                      {warningLine(w)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {raised.introducedWarnings.length > 0 || raised.worsenedWarnings.length > 0 ? (
              <p className="mt-1">
                Nothing further upstream was changed — which gap to close, and how, is yours to
                pick.
              </p>
            ) : (
              <p className="mt-1">Its own plan still balances.</p>
            )}
            <button
              type="button"
              onClick={() => void invoke("pop_out_factory", { factoryId: raised.factoryId })}
              className="mt-1.5 flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open {raised.factoryName}
            </button>
          </div>
        )}

        <RaiseTally log={raiseLog} onClear={onClearRaiseLog} />

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
                  // Rates in this game are routinely fractional (2.5,
                  // 37.5) — a whole-number step marks those invalid.
                  step="any"
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
          {externals.map((src) => {
            const sourceId = src.sourceFactoryId;
            const distanceM = sourceId ? distanceById.get(sourceId) ?? null : null;
            const supplying = sourceId ? resolvedBySource.get(sourceId) ?? 0 : 0;
            const product = sourceId ? productByFactory.get(sourceId) ?? null : null;
            // How much this source would have to send for nothing to be
            // left over: what it sends now plus everything nobody
            // covers. Which of several short sources gets raised is the
            // user's pick, and raising any one of them closes the gap,
            // so each row offers to close all of it rather than a share
            // that only helps if every other row is raised too.
            const needed = supplying + unassignedIpm;
            const shortHere = sourceId !== null && isReportable(unassignedIpm);
            // Its machines already make enough; the export slice is the
            // only thing in the way, so this costs the exporter nothing.
            // `spare` has this factory's own draw taken out of it, so it
            // goes back in before comparing against what we're asking
            // it to send us.
            const justNeedsExporting =
              product !== null && product.spareIpm + supplying >= needed - 1e-3;
            // An explicit cap the raise would otherwise be powerless
            // against — lifting the exporter's target does nothing while
            // this row refuses to take more than the old number.
            const bindingCap = src.ipmCap !== null && src.ipmCap < needed - 1e-3;
            const isPending = sourceId !== null && raising(sourceId);
            return (
              <li key={src.index} className="rounded-md border border-border">
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  {sourceId && <FactoryFace iconId={iconById.get(sourceId)} />}
                  <span
                    className="min-w-0 flex-1 truncate text-fg"
                    title={distanceM != null ? distanceLabel(distanceM) : undefined}
                  >
                    {sourceId ? factoryNames.get(sourceId) ?? sourceId : "A future factory"}
                  </span>
                  {sourceId !== null && (
                    <span
                      className={`shrink-0 tabular-nums ${supplying > 0 ? "text-fg-muted" : "text-warning"}`}
                      title="What the last solve actually pulled from this source"
                    >
                      {rate(supplying)}
                    </span>
                  )}
                  {sourceId === null && (
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
                    // Rates in this game are routinely fractional (2.5,
                    // 37.5) — a whole-number step marks those invalid.
                    step="any"
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
                </div>
                {/* A row that doesn't make the item can't be raised —
                    there's no target to raise. Saying so beats an
                    action that fails, and beats the silence that made a
                    0/min row look like a broken import. Held back until
                    the offers land, or every row claims it makes
                    nothing for as long as the query is in flight. */}
                {shortHere && sourceId !== null && product === null && !offers.isPending && (
                  <div className="flex items-center justify-between gap-2 border-t border-warning/30 px-2 py-1">
                    <span className="min-w-0 truncate text-[10px] text-fg-muted">
                      Doesn't make {itemName} yet — plan it there
                    </span>
                    <button
                      type="button"
                      onClick={() => void invoke("pop_out_factory", { factoryId: sourceId })}
                      className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Open it
                    </button>
                  </div>
                )}
                {shortHere && sourceId !== null && product !== null && (
                  <div className="flex items-center justify-between gap-2 border-t border-warning/30 px-2 py-1">
                    <span className="min-w-0 truncate text-[10px] text-fg-muted">
                      {product.exportIpm <= 0
                        ? `Makes ${rate(product.producedIpm)}, exports none of it`
                        : `Needs ${rate(unassignedIpm)} more`}
                    </span>
                    <button
                      type="button"
                      disabled={raiseTarget.isPending}
                      onClick={() => {
                        if (bindingCap) {
                          // Both halves, or the click does nothing: the
                          // cap is what the solver reads.
                          onSetCap(itemId, src.index, needed);
                        }
                        raiseTarget.mutate({ exporterFactoryId: sourceId, neededIpm: needed });
                      }}
                      title={`${
                        justNeedsExporting ? "Open" : "Raise"
                      } ${factoryNames.get(sourceId) ?? sourceId}'s ${itemName} export to ${rate(
                        needed,
                      )} — what it sends you now plus the ${rate(unassignedIpm)} nothing covers${
                        bindingCap ? ", and lift this row's cap to match" : ""
                      }`}
                      className="flex shrink-0 items-center gap-1 rounded border border-warning/50 px-1.5 py-0.5 text-[11px] font-medium text-warning hover:bg-warning/10 disabled:opacity-50"
                    >
                      {isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : justNeedsExporting ? (
                        <Upload className="h-3 w-3" />
                      ) : (
                        <TrendingUp className="h-3 w-3" />
                      )}
                      {justNeedsExporting ? "Export it" : "Raise target"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
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

            {exportables.length > 0 && (
              <>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Makes {itemName} — not exporting it yet
                </div>
                <ul className="mt-1 space-y-1">{exportables.map(offerButton)}</ul>
              </>
            )}

            {shortExporters.length > 0 && (
              <>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-warning">
                  Makes {itemName}, but not enough
                </div>
                <ul className="mt-1 space-y-1">{shortExporters.map(offerButton)}</ul>
              </>
            )}

            {!offers.isPending &&
              coverers.length === 0 &&
              exportables.length === 0 &&
              shortExporters.length === 0 && (
                <div className="mt-2 text-fg-muted">
                  {sourcedProducers.length > 0
                    ? `Every factory that makes this is already a source — get more out of one above.`
                    : "Nobody makes this yet — pick any factory below and plan it there later."}
                </div>
              )}

            {otherFactories.length > 0 && (
              <>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  Not making this (plan it there later)
                </div>
                <ul className="mt-1 space-y-1">
                  {otherFactories.map((f) => {
                    const distanceM = distanceById.get(f.id) ?? null;
                    return (
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
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{f.name}</span>
                            {distanceM != null && (
                              <span className="block text-[10px]">{distanceLabel(distanceM)}</span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
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
