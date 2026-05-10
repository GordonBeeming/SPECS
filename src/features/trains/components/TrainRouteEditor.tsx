import { useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";

import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { Button } from "@/shared/ui/Button";
import { FilterSelect } from "@/shared/ui/FilterSelect";

import { useCreateTrainRoute, useUpdateTrainRoute } from "../hooks/useTrains";
import type { TrainRouteDetail } from "../types";

interface TrainRouteEditorProps {
  /** Edit mode when set; create mode when undefined. */
  detail?: TrainRouteDetail;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

export function TrainRouteEditor({ detail, onClose, onSaved }: TrainRouteEditorProps) {
  const factories = useFactoryList();
  const createMut = useCreateTrainRoute();
  const updateMut = useUpdateTrainRoute();

  const isEdit = !!detail;
  const [name, setName] = useState(detail?.route.name ?? "");
  const [freightCars, setFreightCars] = useState<string>(
    String(detail?.route.freightCars ?? 4),
  );
  const [fluidCars, setFluidCars] = useState<string>(
    String(detail?.route.fluidCars ?? 0),
  );
  const [distance, setDistance] = useState<string>(
    detail?.route.totalDistanceM != null ? String(detail.route.totalDistanceM) : "",
  );
  const [notes, setNotes] = useState<string>(detail?.route.notes ?? "");
  const [stops, setStops] = useState<string[]>(
    detail?.stops.map((s) => s.factoryId) ?? [],
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const factoryOptions = useMemo(
    () => (factories.data ?? []).map((f) => ({ value: f.id, label: f.name })),
    [factories.data],
  );

  const moveStop = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= stops.length) return;
    const next = [...stops];
    [next[idx], next[target]] = [next[target], next[idx]];
    setStops(next);
  };

  const addStop = () => setStops([...stops, ""]);
  const removeStop = (idx: number) => setStops(stops.filter((_, i) => i !== idx));
  const updateStop = (idx: number, value: string | null) => {
    const next = [...stops];
    next[idx] = value ?? "";
    setStops(next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const fc = Number(freightCars);
    const fl = Number(fluidCars);
    const dist = distance.trim() === "" ? undefined : Number(distance);
    if (name.trim().length === 0) return setValidationError("Name is required.");
    if (!Number.isInteger(fc) || fc < 0) return setValidationError("Freight cars must be a whole number ≥ 0.");
    if (!Number.isInteger(fl) || fl < 0) return setValidationError("Fluid cars must be a whole number ≥ 0.");
    if (fc + fl < 1) return setValidationError("At least one car (freight or fluid) is required.");
    if (dist != null && (!Number.isInteger(dist) || dist < 0))
      return setValidationError("Distance must be a whole number ≥ 0 (or blank).");
    if (stops.some((s) => !s)) return setValidationError("Every stop must point at a factory.");
    if (stops.length < 2) return setValidationError("A route needs at least 2 stops.");
    if (new Set(stops).size < 2) return setValidationError("Stops must visit at least 2 distinct factories.");
    for (let i = 1; i < stops.length; i++) {
      if (stops[i] === stops[i - 1])
        return setValidationError("Two consecutive stops can't be the same factory.");
    }
    setValidationError(null);

    const payload = {
      name: name.trim(),
      freightCars: fc,
      fluidCars: fl,
      stops,
      totalDistanceM: dist,
      notes: notes.trim() || undefined,
    };

    if (isEdit && detail) {
      updateMut.mutate(
        { id: detail.route.id, ...payload },
        {
          onSuccess: (saved) => {
            onSaved?.(saved.route.id);
            onClose();
          },
        },
      );
    } else {
      createMut.mutate(payload, {
        onSuccess: (saved) => {
          onSaved?.(saved.route.id);
          onClose();
        },
      });
    }
  };

  const serverError =
    (createMut.error instanceof Error ? createMut.error.message : null) ??
    (updateMut.error instanceof Error ? updateMut.error.message : null);
  const submitting = createMut.isPending || updateMut.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="train-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="train-editor-title" className="text-lg font-semibold text-fg">
            {isEdit ? "Edit train route" : "New train route"}
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

        <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 overflow-auto p-6">
          <label className="block">
            <span className="text-sm font-medium text-fg">Name</span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
              placeholder="Iron Loop, North Fluid Run, …"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-sm font-medium text-fg">Freight cars</span>
              <input
                type="number"
                min={0}
                step={1}
                value={freightCars}
                onChange={(e) => setFreightCars(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-fg">Fluid cars</span>
              <input
                type="number"
                min={0}
                step={1}
                value={fluidCars}
                onChange={(e) => setFluidCars(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-fg">Distance (m)</span>
              <input
                type="number"
                min={0}
                step={1}
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
                placeholder="round-trip"
              />
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-fg">Stops</span>
              <Button
                type="button"
                variant="ghost"
                onClick={addStop}
                aria-label="Add stop"
              >
                <Plus className="h-4 w-4" />
                Add stop
              </Button>
            </div>
            {stops.length === 0 && (
              <p className="text-xs text-fg-muted">
                Add 2+ stops in visit order. The same factory can appear
                twice at non-adjacent positions (back-and-forth shuttle).
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {stops.map((stop, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-right text-xs text-fg-muted tabular-nums">
                    {idx + 1}.
                  </span>
                  <div className="flex-1">
                    <FilterSelect
                      options={factoryOptions}
                      value={stop || null}
                      onChange={(v) => updateStop(idx, v)}
                      placeholder="Pick a factory"
                      compact
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => moveStop(idx, -1)}
                    disabled={idx === 0}
                    aria-label="Move stop up"
                    className="rounded-md p-1 text-fg-muted hover:bg-border/40 hover:text-fg disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStop(idx, 1)}
                    disabled={idx === stops.length - 1}
                    aria-label="Move stop down"
                    className="rounded-md p-1 text-fg-muted hover:bg-border/40 hover:text-fg disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStop(idx)}
                    aria-label="Remove stop"
                    className="rounded-md p-1 text-fg-muted hover:bg-danger/20 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-fg">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary"
            />
          </label>

          {validationError && (
            <p role="alert" className="text-sm text-danger">{validationError}</p>
          )}
          {serverError && !validationError && (
            <p role="alert" className="text-sm text-danger">{serverError}</p>
          )}

          <div className="mt-auto flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Create route"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
