import { useEffect, useMemo, useState } from "react";
import { Pencil, X } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { ConfirmDeleteButton } from "@/shared/ui/ConfirmDeleteButton";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Icon } from "@/shared/ui/Icon";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useRecipes } from "@/features/library/hooks/useLibrary";

import { ampSlotsForBuilding, clockCapForShards } from "../ampRules";
import type { FactoryMachine, UpdateMachineInput } from "../types";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 110;
export const NODE_WIDTH_EDITING = 320;

export interface MachineNodeProps {
  machine: FactoryMachine;
  buildingName: string;
  recipeName: string;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onRemove: () => void;
  onUpdate: (patch: UpdateMachineInput) => void;
  updating: boolean;
}

export function MachineNodeCard({
  machine,
  buildingName,
  recipeName,
  editing,
  onEdit,
  onCancelEdit,
  onRemove,
  onUpdate,
  updating,
}: MachineNodeProps) {
  if (editing) {
    return (
      <InlineEditor
        machine={machine}
        buildingName={buildingName}
        recipeName={recipeName}
        onCancel={onCancelEdit}
        onUpdate={onUpdate}
        updating={updating}
      />
    );
  }
  const slots = ampSlotsForBuilding(machine.buildingId);
  const amp =
    machine.useSomersloop && machine.somersloopSlotsFilled > 0
      ? `${machine.somersloopSlotsFilled}/${slots}× S`
      : null;
  return (
    <div
      className="rounded-md border border-border bg-bg-raised p-3 text-xs shadow-sm"
      style={{ width: NODE_WIDTH }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon itemId={machine.buildingId} alt={buildingName} className="h-5 w-5" />
          <span className="truncate font-medium text-fg">{recipeName}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit machine"
            className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <ConfirmDeleteButton onConfirm={onRemove} label="Remove machine" />
        </div>
      </div>
      <div className="mt-1 text-fg-muted">{buildingName}</div>
      <div className="mt-2 grid grid-cols-3 gap-1 tabular-nums">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">count</div>
          <div className="font-semibold text-fg">{machine.count}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">clock</div>
          <div className="font-semibold text-fg">{machine.clockPct.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">amp</div>
          <div className="font-semibold text-fg">
            {amp ?? (machine.powerShardCount > 0 ? `${machine.powerShardCount}× PS` : "—")}
          </div>
        </div>
      </div>
    </div>
  );
}

interface InlineEditorProps {
  machine: FactoryMachine;
  buildingName: string;
  recipeName: string;
  onCancel: () => void;
  onUpdate: (patch: UpdateMachineInput) => void;
  updating: boolean;
}

function InlineEditor({
  machine,
  buildingName,
  recipeName,
  onCancel,
  onUpdate,
  updating,
}: InlineEditorProps) {
  const recipes = useRecipes();
  const playthrough = useCurrentPlaythrough();
  const tierCap = playthrough.data?.currentTier ?? 9;

  const [recipeId, setRecipeId] = useState(machine.recipeId);
  const [count, setCount] = useState(machine.count);
  const [clockPct, setClockPct] = useState(machine.clockPct);
  const [useSomersloop, setUseSomersloop] = useState(machine.useSomersloop);
  const [somersloopSlotsFilled, setSomersloopSlotsFilled] = useState(
    machine.somersloopSlotsFilled,
  );
  const [powerShardCount, setPowerShardCount] = useState(machine.powerShardCount);
  const [error, setError] = useState<string | null>(null);

  // Reset local state if a refetch swaps in a different machine object
  // (e.g. someone deleted + re-added). xyflow keeps the node id but the
  // underlying record could change.
  useEffect(() => {
    setRecipeId(machine.recipeId);
    setCount(machine.count);
    setClockPct(machine.clockPct);
    setUseSomersloop(machine.useSomersloop);
    setSomersloopSlotsFilled(machine.somersloopSlotsFilled);
    setPowerShardCount(machine.powerShardCount);
  }, [machine]);

  const recipeOptions = useMemo(() => {
    if (!recipes.data) return [];
    // Building-locked: the backend's update_factory_machine command
    // rejects any swap where recipe.building_id ≠ machine.building_id,
    // so the dropdown only shows recipes that satisfy that constraint.
    // Tier-gated against the current playthrough, with isAlt grouped to
    // match the AddMachineForm picker.
    return recipes.data
      .filter(
        (r) =>
          r.buildingId === machine.buildingId &&
          r.unlockTier <= tierCap,
      )
      .sort((a, b) => {
        if (a.isAlt !== b.isAlt) return a.isAlt ? 1 : -1;
        return a.name.localeCompare(b.name);
      })
      .map((r) => ({
        value: r.id,
        label: r.name + (r.isAlt ? " (alt)" : ""),
        iconId: r.outputs[0]?.itemId,
        group: r.isAlt ? "Alts" : "Standard",
      }));
  }, [recipes.data, machine.buildingId, tierCap]);

  const slots = ampSlotsForBuilding(machine.buildingId);
  const shardClockCap = clockCapForShards(powerShardCount);

  const submit = () => {
    if (!Number.isFinite(count) || count < 1 || count > 10_000) {
      setError("Count must be between 1 and 10,000.");
      return;
    }
    if (!Number.isFinite(clockPct) || clockPct < 1 || clockPct > 250) {
      setError("Clock must be between 1% and 250%.");
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
    const swapped = recipeId !== machine.recipeId;
    onUpdate({
      id: machine.id,
      // Only send recipeId + buildingId when the user actually picked
      // a different recipe — otherwise leave them unset so the backend
      // takes the cheap update_machine path (no dataset cross-check).
      recipeId: swapped ? recipeId : undefined,
      buildingId: swapped ? machine.buildingId : undefined,
      count,
      clockPct,
      useSomersloop,
      somersloopSlotsFilled: useSomersloop ? somersloopSlotsFilled : 0,
      powerShardCount,
    });
  };

  return (
    <div
      className="rounded-md border border-primary/60 bg-bg-raised p-3 text-xs shadow-md"
      style={{ width: NODE_WIDTH_EDITING }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon itemId={machine.buildingId} alt={buildingName} className="h-5 w-5" />
          <span className="truncate font-medium text-fg">{buildingName}</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel edit"
          className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <label className="mt-2 block">
        <span className="text-[10px] uppercase tracking-wide text-fg-muted">
          Recipe
        </span>
        <div className="mt-0.5">
          <FilterSelect
            compact
            ariaLabel={`Recipe for ${recipeName}`}
            options={recipeOptions}
            value={recipeId}
            onChange={(next) => setRecipeId(next ?? machine.recipeId)}
          />
        </div>
      </label>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-fg-muted">
            Count
          </span>
          <div className="mt-0.5 flex items-stretch overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setCount((c) => Math.max(1, c - 1))}
              className="px-2 text-fg-muted hover:bg-border hover:text-fg"
              aria-label="Decrement count"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="h-7 w-full min-w-0 bg-bg px-1 text-center text-xs text-fg outline-none focus:border-primary tabular-nums"
              aria-label="Machine count"
            />
            <button
              type="button"
              onClick={() => setCount((c) => Math.min(10000, c + 1))}
              className="px-2 text-fg-muted hover:bg-border hover:text-fg"
              aria-label="Increment count"
            >
              +
            </button>
          </div>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-fg-muted">
            Clock %
          </span>
          <div className="mt-0.5 flex items-center gap-1">
            <input
              type="range"
              min={1}
              max={shardClockCap}
              step={1}
              value={Math.min(clockPct, shardClockCap)}
              onChange={(e) => setClockPct(Number(e.target.value))}
              className="h-7 w-full accent-primary"
              aria-label="Clock percent slider"
            />
            <input
              type="number"
              min={1}
              max={shardClockCap}
              step={0.1}
              value={clockPct}
              onChange={(e) => setClockPct(Number(e.target.value))}
              className="h-7 w-14 rounded-md border border-border bg-bg px-1 text-right text-xs text-fg outline-none focus:border-primary tabular-nums"
              aria-label="Clock percent input"
            />
          </div>
        </label>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-fg-muted">
            Somersloop ({slots} slot{slots === 1 ? "" : "s"})
          </span>
          <input
            type="number"
            min={0}
            max={slots}
            value={somersloopSlotsFilled}
            onChange={(e) => {
              const v = Math.max(0, Math.min(slots, Number(e.target.value)));
              setSomersloopSlotsFilled(v);
              setUseSomersloop(v > 0);
            }}
            className="mt-0.5 h-7 w-full rounded-md border border-border bg-bg px-2 text-xs text-fg outline-none focus:border-primary tabular-nums"
            aria-label="Somersloop slots filled"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-fg-muted">
            Power shards (cap {shardClockCap}%)
          </span>
          <input
            type="number"
            min={0}
            max={3}
            value={powerShardCount}
            onChange={(e) =>
              setPowerShardCount(
                Math.max(0, Math.min(3, Number(e.target.value))),
              )
            }
            className="mt-0.5 h-7 w-full rounded-md border border-border bg-bg px-2 text-xs text-fg outline-none focus:border-primary tabular-nums"
            aria-label="Power shard count"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={onCancel}
          className="px-2 py-1 text-xs"
        >
          Cancel
        </Button>
        <Button onClick={submit} disabled={updating} className="px-2 py-1 text-xs">
          {updating ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
