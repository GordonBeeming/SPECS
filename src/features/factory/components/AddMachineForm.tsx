import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/Button";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { useBuildings, useRecipes } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useAddMachine } from "../hooks/useFactories";

interface AddMachineFormProps {
  factoryId: string;
  onSubmitted?: () => void;
}

export function AddMachineForm({ factoryId, onSubmitted }: AddMachineFormProps) {
  const recipes = useRecipes();
  const buildings = useBuildings();
  const playthrough = useCurrentPlaythrough();
  const addMachine = useAddMachine();

  // Filter to recipes whose unlock tier ≤ the active playthrough's current
  // tier so users can't accidentally place a machine they haven't unlocked.
  const tierCap = playthrough.data?.currentTier ?? 9;
  const buildingsById = useMemo(
    () => new Map(buildings.data?.map((b) => [b.id, b]) ?? []),
    [buildings.data],
  );
  const eligibleRecipes = useMemo(
    () =>
      (recipes.data ?? []).filter((r) => {
        if (r.unlockTier > tierCap) return false;
        const b = buildingsById.get(r.buildingId);
        return !b || b.unlockTier <= tierCap;
      }),
    [recipes.data, buildingsById, tierCap],
  );

  const [recipeId, setRecipeId] = useState("");
  const [count, setCount] = useState(1);
  const [clockPct, setClockPct] = useState(100);
  const [error, setError] = useState<string | null>(null);

  const recipe = recipes.data?.find((r) => r.id === recipeId);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!recipe) {
      setError("Pick a recipe.");
      return;
    }
    if (count < 1 || count > 10_000) {
      setError("Count must be between 1 and 10,000.");
      return;
    }
    if (clockPct < 1 || clockPct > 250) {
      setError("Clock must be between 1% and 250%.");
      return;
    }
    setError(null);
    addMachine.mutate(
      {
        factoryId,
        buildingId: recipe.buildingId,
        recipeId: recipe.id,
        count,
        clockPct,
      },
      { onSuccess: () => onSubmitted?.() },
    );
  };

  const serverError = addMachine.error instanceof Error ? addMachine.error.message : null;

  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-md border border-border bg-bg-raised/40 p-3 md:grid-cols-[1fr_6rem_8rem_auto] md:items-end">
      <label className="block">
        <span className="text-xs font-medium text-fg-muted">Recipe</span>
        <div className="mt-1">
          <FilterSelect
            ariaLabel="Recipe"
            compact
            placeholder="Type to filter recipes…"
            value={recipeId || null}
            onChange={(next) => setRecipeId(next ?? "")}
            options={eligibleRecipes.map((r) => ({
              value: r.id,
              label: r.name + (r.isAlt ? " (alt)" : ""),
              hint: buildingsById.get(r.buildingId)?.name,
            }))}
          />
        </div>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-fg-muted">Count</span>
        <input
          type="number"
          min={1}
          max={10000}
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

      <Button type="submit" disabled={addMachine.isPending}>
        {addMachine.isPending ? "Adding…" : "Add"}
      </Button>

      {(error || serverError) && (
        <p role="alert" className="md:col-span-4 text-sm text-danger">
          {error ?? serverError}
        </p>
      )}
    </form>
  );
}
