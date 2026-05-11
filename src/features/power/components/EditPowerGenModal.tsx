import { useState, type FormEvent } from "react";
import { X } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

import { useUpdatePowerGen } from "../hooks/usePower";
import type { PowerGen } from "../types";

interface EditPowerGenModalProps {
  factoryId: string;
  gen: PowerGen;
  generatorName: string;
  fuelOptions: Array<{ id: string; name: string }>;
  onClose: () => void;
}

/**
 * Edit a single power_gen row in-place: count, clock, fuel item.
 * Generator type stays fixed (a Coal Generator can't become a Fuel
 * Generator mid-edit) — change that path stays via delete + re-add.
 */
export function EditPowerGenModal({
  factoryId,
  gen,
  generatorName,
  fuelOptions,
  onClose,
}: EditPowerGenModalProps) {
  const update = useUpdatePowerGen(factoryId);
  const [count, setCount] = useState(gen.count);
  const [clockPct, setClockPct] = useState(gen.clockPct);
  const [fuelItemId, setFuelItemId] = useState(gen.fuelItemId);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(count) || count < 1 || count > 1000) {
      setError("Count must be between 1 and 1,000.");
      return;
    }
    if (!Number.isFinite(clockPct) || clockPct < 1 || clockPct > 250) {
      setError("Clock must be between 1% and 250%.");
      return;
    }
    setError(null);
    update.mutate(
      { id: gen.id, count, clockPct, fuelItemId },
      { onSuccess: onClose },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${generatorName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg">Edit generator</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-fg-muted">{generatorName}</p>

        <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-fg-muted">Count</span>
              <input
                type="number"
                min={1}
                max={1000}
                step={1}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg-muted">Clock %</span>
              <input
                type="number"
                min={1}
                max={250}
                step={0.1}
                value={clockPct}
                onChange={(e) => setClockPct(Number(e.target.value))}
                className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
              />
            </label>
          </div>

          {fuelOptions.length > 1 && (
            <label className="block">
              <span className="text-xs font-medium text-fg-muted">Fuel</span>
              <select
                value={fuelItemId}
                onChange={(e) => setFuelItemId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
              >
                {fuelOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {error && (
            <div role="alert" className="text-sm text-danger">
              {error}
            </div>
          )}
          {update.isError && !error && (
            <div role="alert" className="text-sm text-danger">
              {update.error instanceof Error
                ? update.error.message
                : String(update.error)}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
