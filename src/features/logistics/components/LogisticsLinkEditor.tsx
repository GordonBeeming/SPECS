import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";

import { useFactoryDetail, useFactoryList } from "@/features/factory/hooks/useFactories";
import { useItems } from "@/features/library/hooks/useLibrary";
import { factoryDistanceMeters } from "@/features/map/transform";
import { Button } from "@/shared/ui/Button";
import { FilterSelect } from "@/shared/ui/FilterSelect";

import {
  useCreateLogisticsLink,
  usePlanLogistics,
  useUpdateLogisticsLink,
} from "../hooks/useLogistics";
import type {
  LogisticsLink,
  PlanInput,
  TransportKind,
  TransportPlan,
} from "../types";
import { TransportPlanPicker, serialisePlan } from "./TransportPlanPicker";

interface LogisticsLinkEditorProps {
  /** When set, the modal opens in edit mode against this link. */
  link?: LogisticsLink;
  onClose: () => void;
  onSaved?: (link: LogisticsLink) => void;
}

/**
 * Modal that handles both create and edit. Endpoints + item are
 * immutable on a stored link (matches the Rust `UpdateLogisticsLinkInput`
 * surface — endpoints would change cascade semantics; if the user really
 * needs to redirect, deleting + recreating is cleaner) so those inputs
 * disable when `link` is set.
 *
 * The plan picker reads from `usePlanLogistics`, which re-runs whenever
 * ipm or distance changes. The selected plan persists as serialised
 * JSON via `transport_plan_json`, matching what the Rust side validates.
 */
export function LogisticsLinkEditor({ link, onClose, onSaved }: LogisticsLinkEditorProps) {
  const factories = useFactoryList();
  const items = useItems();
  const createMut = useCreateLogisticsLink();
  const updateMut = useUpdateLogisticsLink();

  const isEdit = !!link;
  const [fromFactoryId, setFromFactoryId] = useState<string | null>(link?.fromFactoryId ?? null);
  const [toFactoryId, setToFactoryId] = useState<string | null>(link?.toFactoryId ?? null);
  const [itemId, setItemId] = useState<string | null>(link?.itemId ?? null);
  const [ipmText, setIpmText] = useState<string>(link ? String(link.itemsPerMinute) : "");
  const [distanceText, setDistanceText] = useState<string>(link?.distanceM != null ? String(link.distanceM) : "");
  // A stored/typed distance is the user's word over the map's; only keep
  // auto-filling from the map while nobody has touched the field yet.
  // A freshly-persisted link's distance is itself often just the map's
  // own measurement at save time (this editor writes it that way by
  // default) — starting `touched` true for every stored value blocked
  // that link from ever re-deriving again, even after a factory moved.
  // The real signal (whether the player typed it) isn't persisted, so
  // this starts `false` and a one-time effect below decides once the
  // map's current measurement is known — see `distanceTouchedInitRef`.
  const [distanceTouched, setDistanceTouched] = useState<boolean>(false);
  // Narrows the item picker to what the source factory can actually ship
  // (#61) — the source is always picked before the item, so its ledger
  // is available by the time this matters.
  const sourceFactory = useFactoryDetail(fromFactoryId);
  const [notes, setNotes] = useState<string>(link?.notes ?? "");
  const [selectedJson, setSelectedJson] = useState<string | null>(link?.transportPlanJson ?? null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const ipm = Number(ipmText);
  const distanceM = distanceText.trim() === "" ? null : Number(distanceText);
  // The Rust side stores distance as `i64` and rejects negatives, so a
  // half-typed "12.5" or "-3" should not even reach the planner — strip
  // those before they hit the IPC.
  const distanceForPlanner =
    distanceM != null && Number.isInteger(distanceM) && distanceM >= 0 ? distanceM : undefined;

  const planInput = useMemo<PlanInput | null>(() => {
    if (!itemId || !Number.isFinite(ipm) || ipm <= 0) return null;
    return {
      itemId,
      itemsPerMinute: ipm,
      distanceM: distanceForPlanner,
    };
  }, [itemId, ipm, distanceForPlanner]);

  const planQuery = usePlanLogistics(planInput);
  const plans = planQuery.data ?? [];

  // Uniform with every other modal in the app — Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // When the planner output changes, drop a stale selection that's no
  // longer in the list — otherwise the radio shows nothing checked but
  // we'd happily submit the old JSON.
  useEffect(() => {
    if (selectedJson && !plans.some((p) => serialisePlan(p) === selectedJson)) {
      setSelectedJson(null);
    }
  }, [plans, selectedJson]);

  const factoryOptions = useMemo(
    () => (factories.data ?? []).map((f) => ({ value: f.id, label: f.name })),
    [factories.data],
  );
  const toFactoryOptions = useMemo(
    () => factoryOptions.filter((o) => o.value !== fromFactoryId),
    [factoryOptions, fromFactoryId],
  );

  // The map already knows where both endpoints are — measure it instead
  // of asking the player to. `null` covers "not both picked yet" and "one
  // endpoint has never been placed on the map" alike.
  const derivedDistanceM = useMemo(() => {
    const from = factories.data?.find((f) => f.id === fromFactoryId);
    const to = factories.data?.find((f) => f.id === toFactoryId);
    if (!from || !to) return null;
    const meters = factoryDistanceMeters(from, to);
    return meters != null ? Math.round(meters) : null;
  }, [factories.data, fromFactoryId, toFactoryId]);

  // One-time decision for an existing link's starting `distanceTouched`,
  // made once the map's current measurement is available (it isn't yet
  // on first render — `factories.data` loads async). A stored distance
  // that still matches what the map would derive today is exactly the
  // "we persisted a derived value" case and should keep tracking future
  // moves like a brand-new link; a stored value that disagrees really
  // was overridden (typed, or the map moved since it was saved) and
  // must stay locked. Runs once — after that, only the field's own
  // `onChange` below may set `distanceTouched`.
  const distanceTouchedInitRef = useRef(false);
  useEffect(() => {
    if (distanceTouchedInitRef.current) return;
    if (!link || link.distanceM == null) {
      distanceTouchedInitRef.current = true;
      return;
    }
    if (derivedDistanceM == null) return; // wait for factory positions to load
    setDistanceTouched(link.distanceM !== derivedDistanceM);
    distanceTouchedInitRef.current = true;
  }, [link, derivedDistanceM]);

  // Keep the field in sync with the map's measurement until the player
  // overrides it — matching or picking new endpoints should re-derive,
  // but a manual edit is the player's call from then on.
  useEffect(() => {
    if (distanceTouched || derivedDistanceM == null) return;
    setDistanceText(String(derivedDistanceM));
  }, [derivedDistanceM, distanceTouched]);
  // What the source factory could plausibly ship: it's made something
  // (a machine output) or a bound resource-node claim/water group feeds
  // it directly — either way there's real supply to draw the link from.
  const producibleItemIds = useMemo(() => {
    const flows = sourceFactory.data?.ledger.flows ?? [];
    const ids = new Set<string>();
    for (const flow of flows) {
      if (flow.producedPerMinute > 0 || (flow.fromNodesPerMinute ?? 0) > 0) {
        ids.add(flow.itemId);
      }
    }
    return ids;
  }, [sourceFactory.data]);

  const itemOptions = useMemo(() => {
    const all = (items.data ?? []).map((i) => ({
      value: i.id,
      label: i.name,
      hint: i.isFluid ? "fluid" : undefined,
    }));
    // Narrow to the source's own outputs once one's picked (#61 — the
    // picker used to offer the whole ~150-item catalogue regardless of
    // what the source factory actually made). Keep the already-selected
    // item visible even if it falls outside that set — in edit mode the
    // field is immutable and disabled, so filtering it out would blank
    // the label instead of just narrowing the choices. A factory with no
    // flows yet (nothing built, nothing claimed) falls back to the full
    // catalogue rather than presenting an empty picker.
    if (!fromFactoryId || producibleItemIds.size === 0) return all;
    return all.filter((o) => producibleItemIds.has(o.value) || o.value === itemId);
  }, [items.data, fromFactoryId, producibleItemIds, itemId]);

  const pickedPlan = useMemo<TransportPlan | null>(() => {
    if (!selectedJson) return null;
    return plans.find((p) => serialisePlan(p) === selectedJson) ?? null;
  }, [plans, selectedJson]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!fromFactoryId) return setValidationError("Pick a source factory.");
    if (!toFactoryId) return setValidationError("Pick a destination factory.");
    if (fromFactoryId === toFactoryId) return setValidationError("Source and destination must differ.");
    if (!itemId) return setValidationError("Pick an item.");
    if (!Number.isFinite(ipm) || ipm < 0.01)
      return setValidationError("Throughput must be at least 0.01 ipm.");
    if (distanceM != null && (!Number.isFinite(distanceM) || distanceM < 0))
      return setValidationError("Distance must be 0 or more (or blank).");
    if (!pickedPlan) return setValidationError("Pick a transport plan.");
    setValidationError(null);

    const transportKind: TransportKind = pickedPlan.kind;
    const transportPlanJson = serialisePlan(pickedPlan);
    const trimmedNotes = notes.trim();
    const distancePayload = distanceM != null ? distanceM : undefined;

    if (isEdit && link) {
      updateMut.mutate(
        {
          id: link.id,
          itemsPerMinute: ipm,
          transportKind,
          transportPlanJson,
          distanceM: distancePayload,
          notes: trimmedNotes || undefined,
        },
        {
          onSuccess: (saved) => {
            onSaved?.(saved);
            onClose();
          },
        },
      );
    } else {
      createMut.mutate(
        {
          fromFactoryId,
          toFactoryId,
          itemId,
          itemsPerMinute: ipm,
          transportKind,
          transportPlanJson,
          distanceM: distancePayload,
          notes: trimmedNotes || undefined,
        },
        {
          onSuccess: (saved) => {
            onSaved?.(saved);
            onClose();
          },
        },
      );
    }
  };

  const serverError =
    (createMut.error instanceof Error ? createMut.error.message : null) ??
    (updateMut.error instanceof Error ? updateMut.error.message : null);
  const planError = planQuery.error instanceof Error ? planQuery.error.message : null;
  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="logistics-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="logistics-editor-title" className="text-lg font-semibold text-fg">
            {isEdit ? "Edit logistics link" : "New logistics link"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/*
          `noValidate` hands every field to the manual checks below.
          Without it, the browser's own constraint validation (the
          `min` on throughput) intercepts the submit event before this
          handler ever runs — a "0" throughput fails silently with no
          message instead of surfacing "must be at least 0.01 ipm".
        */}
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-1 min-h-0 flex-col"
        >
          {/*
            The header and footer stay put; only this region scrolls.
            A flex child's default `min-height: auto` refuses to shrink
            below its content size, so without `min-h-0` here the eight
            transport options push the whole form past the modal's
            `max-h-[90vh]` and the parent's `overflow-hidden` just clips
            the excess — Save changes was rendered but unreachable.
          */}
          <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-6">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-fg">From factory</span>
                <div className="mt-1">
                  <FilterSelect
                    options={factoryOptions}
                    value={fromFactoryId}
                    onChange={setFromFactoryId}
                    placeholder="Source"
                    disabled={isEdit}
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-fg">To factory</span>
                <div className="mt-1">
                  <FilterSelect
                    options={toFactoryOptions}
                    value={toFactoryId}
                    onChange={setToFactoryId}
                    placeholder="Destination"
                    disabled={isEdit}
                  />
                </div>
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-fg">Item</span>
              <div className="mt-1">
                <FilterSelect
                  options={itemOptions}
                  value={itemId}
                  onChange={setItemId}
                  placeholder={
                    fromFactoryId && producibleItemIds.size > 0
                      ? "Pick from what the source factory makes"
                      : "Pick an item to ship"
                  }
                  disabled={isEdit}
                />
              </div>
            </label>
            {/* Outside the <label> on purpose — a <label>'s full text
                content becomes part of every field it wraps' accessible
                name, and this hint would otherwise glue itself onto
                "Item" for anyone using a screen reader or querying by
                role+name in a test. */}
            {!isEdit && fromFactoryId && producibleItemIds.size === 0 && (
              <p className="-mt-2 text-xs text-fg-muted">
                The source factory has no outputs yet, so this shows every item.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-fg">
                  Throughput (ipm or m³/min)
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step={0.01}
                  value={ipmText}
                  onChange={(e) => setIpmText(e.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
                  placeholder="e.g. 60"
                />
              </label>
              <div>
                {/* The hints below live outside this <label> on purpose —
                    same reasoning as the Item field's hint: a <label>'s
                    full text content becomes part of its control's
                    accessible name, which would otherwise turn "Distance"
                    into "Distance (m, optional) From the map — 500 m…"
                    for a screen reader (or `getByRole("combobox", {name:
                    /^distance$/i})` in a test). */}
                <label className="block">
                  <span className="text-sm font-medium text-fg">Distance (m, optional)</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={distanceText}
                    onChange={(e) => {
                      setDistanceTouched(true);
                      setDistanceText(e.target.value);
                    }}
                    className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
                    placeholder="for vehicle/train/drone plans (Phase 5b)"
                  />
                </label>
                {!distanceTouched && derivedDistanceM != null && (
                  <p className="mt-1 text-xs text-fg-muted">
                    From the map — {derivedDistanceM.toLocaleString()} m between the two factories.
                  </p>
                )}
                {fromFactoryId && toFactoryId && derivedDistanceM == null && (
                  <p className="mt-1 text-xs text-fg-muted">
                    Place both factories on the map to measure this automatically.
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium text-fg">Plan</div>
              {!planInput && (
                <p className="text-xs text-fg-muted">
                  Pick an item and enter a throughput to see ranked plans.
                </p>
              )}
              {planInput && planQuery.isPending && (
                <p className="text-xs text-fg-muted">Computing plans…</p>
              )}
              {planError && (
                <p role="alert" className="text-sm text-danger">{planError}</p>
              )}
              {planInput && !planQuery.isPending && !planError && (
                // Always render the picker once the planner has had a chance
                // to respond — `<TransportPlanPicker />` owns its own
                // empty-state hint, which is more helpful than a blank gap.
                <TransportPlanPicker
                  plans={plans}
                  selectedJson={selectedJson}
                  onPick={(p) => setSelectedJson(serialisePlan(p))}
                />
              )}
            </div>

            <label className="block">
              <span className="text-sm font-medium text-fg">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary"
                placeholder="Anything worth remembering about this link"
              />
            </label>

            {validationError && (
              <p role="alert" className="text-sm text-danger">{validationError}</p>
            )}
            {serverError && !validationError && (
              <p role="alert" className="text-sm text-danger">{serverError}</p>
            )}
          </div>

          {/* Outside the scrolling region so Save changes is always
              on screen, however many transport options the plan list grows to. */}
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Create link"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
