import { useState, type FormEvent } from "react";
import { X } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

import { ampSlotsForBuilding, clockCapForShards } from "../ampRules";
import { useUpdateMachine } from "../hooks/useFactories";
import type { FactoryMachine } from "../types";

interface EditMachineModalProps {
  factoryId: string;
  machine: FactoryMachine;
  recipeName: string;
  buildingName: string;
  onClose: () => void;
}

/**
 * Modal-style edit for a single machine row. Recipe + building are
 * immutable here — the "swap to a different recipe" flow stays via
 * delete + re-add. This sticks to the same count / clock / amp
 * triple the AddMachineForm exposes, with the matching client-side
 * validation so the user never round-trips a known-bad value.
 */
export function EditMachineModal({
  factoryId,
  machine,
  recipeName,
  buildingName,
  onClose,
}: EditMachineModalProps) {
  const update = useUpdateMachine(factoryId);

  const [count, setCount] = useState(machine.count);
  const [clockPct, setClockPct] = useState(machine.clockPct);
  const [useSomersloop, setUseSomersloop] = useState(machine.useSomersloop);
  const [somersloopSlotsFilled, setSomersloopSlotsFilled] = useState(
    machine.somersloopSlotsFilled,
  );
  const [powerShardCount, setPowerShardCount] = useState(machine.powerShardCount);
  const [error, setError] = useState<string | null>(null);

  const slots = ampSlotsForBuilding(machine.buildingId);
  const shardClockCap = clockCapForShards(powerShardCount);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(count) || count < 1 || count > 10_000) {
      setError("Count must be a number between 1 and 10,000.");
      return;
    }
    if (!Number.isFinite(clockPct) || clockPct < 1 || clockPct > 250) {
      setError("Clock must be a number between 1% and 250%.");
      return;
    }
    if (clockPct > shardClockCap) {
      setError(
        `${powerShardCount} power shard${
          powerShardCount === 1 ? "" : "s"
        } only allow clocks up to ${shardClockCap}%.`,
      );
      return;
    }
    if (somersloopSlotsFilled > slots) {
      setError(
        `This building only has ${slots} Somersloop slot${slots === 1 ? "" : "s"}.`,
      );
      return;
    }
    setError(null);
    update.mutate(
      {
        id: machine.id,
        count,
        clockPct,
        useSomersloop,
        somersloopSlotsFilled: useSomersloop ? somersloopSlotsFilled : 0,
        powerShardCount,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${recipeName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-fg">Edit machine</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {recipeName} · {buildingName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} noValidate className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-fg-muted">Count</span>
              <input
                type="number"
                min={1}
                max={10000}
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

          <details className="rounded-md border border-border p-2">
            <summary className="cursor-pointer text-xs font-medium text-fg-muted">
              Amplifiers
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={useSomersloop}
                  onChange={(e) => setUseSomersloop(e.target.checked)}
                />
                Use Somersloop
              </label>
              {useSomersloop && (
                <label className="block text-xs">
                  <span className="text-fg-muted">
                    Slots filled (max {slots})
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={slots}
                    step={1}
                    value={somersloopSlotsFilled}
                    onChange={(e) =>
                      setSomersloopSlotsFilled(Number(e.target.value))
                    }
                    className="mt-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
                  />
                </label>
              )}
              <label className="block text-xs">
                <span className="text-fg-muted">
                  Power shards (caps clock at {shardClockCap}%)
                </span>
                <input
                  type="number"
                  min={0}
                  max={3}
                  step={1}
                  value={powerShardCount}
                  onChange={(e) => setPowerShardCount(Number(e.target.value))}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
                />
              </label>
            </div>
          </details>

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
