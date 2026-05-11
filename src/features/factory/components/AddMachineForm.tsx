import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/shared/ui/Button";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { useBuildings, useRecipes } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useAddMachine } from "../hooks/useFactories";
import { ampSlotsForBuilding, clockCapForShards } from "../ampRules";

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
  // Wait for buildings before deciding eligibility. Treating "building still
  // loading" as eligible would briefly show recipes the playthrough's tier
  // should hide, so we hold the list empty until both queries resolve and
  // skip recipes whose building is genuinely missing from the dataset.
  const eligibleRecipes = useMemo(() => {
    if (!recipes.data || !buildings.data) return [];
    return recipes.data.filter((r) => {
      if (r.unlockTier > tierCap) return false;
      const b = buildingsById.get(r.buildingId);
      if (!b) return false;
      return b.unlockTier <= tierCap;
    });
  }, [recipes.data, buildings.data, buildingsById, tierCap]);

  const [recipeId, setRecipeId] = useState("");
  const [count, setCount] = useState(1);
  const [clockPct, setClockPct] = useState(100);
  // Amp-state lives outside the disclosure so the values survive when the
  // user toggles the panel closed and re-opens it during the same edit.
  const [useSomersloop, setUseSomersloop] = useState(false);
  const [somersloopSlotsFilled, setSomersloopSlotsFilled] = useState(0);
  const [powerShardCount, setPowerShardCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recipe = recipes.data?.find((r) => r.id === recipeId);
  const slots = recipe ? ampSlotsForBuilding(recipe.buildingId) : 1;
  const shardClockCap = clockCapForShards(powerShardCount);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!recipe) {
      setError("Pick a recipe.");
      return;
    }
    // `Number.isFinite` rejects NaN / ±Infinity. A cleared `<input
    // type="number">` resolves to NaN, and bare `count < 1` is false for NaN
    // so the bad value would slip through to the backend without this guard.
    if (!Number.isFinite(count) || count < 1 || count > 10_000) {
      setError("Count must be a number between 1 and 10,000.");
      return;
    }
    if (!Number.isFinite(clockPct) || clockPct < 1 || clockPct > 250) {
      setError("Clock must be a number between 1% and 250%.");
      return;
    }
    if (clockPct > shardClockCap) {
      // Mirror the Rust validate_clock_against_shards check — surfacing
      // this client-side keeps the failure visible without a round-trip.
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
    addMachine.mutate(
      {
        factoryId,
        buildingId: recipe.buildingId,
        recipeId: recipe.id,
        count,
        clockPct,
        useSomersloop,
        somersloopSlotsFilled: useSomersloop ? somersloopSlotsFilled : 0,
        powerShardCount,
      },
      { onSuccess: () => onSubmitted?.() },
    );
  };

  const serverError = addMachine.error instanceof Error ? addMachine.error.message : null;

  return (
    <form
      onSubmit={onSubmit}
      // HTML5 numeric `max` would short-circuit the submit when the user
      // exceeds the power-shard clock cap, so the inline error never gets
      // a chance to render. `noValidate` cedes that gate to the JS check
      // above, which also surfaces the cap with the right wording.
      noValidate
      className="grid gap-3 rounded-md border border-border bg-bg-raised/40 p-3 md:grid-cols-[1fr_6rem_8rem_auto] md:items-end"
    >
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

      <details className="md:col-span-4">
        <summary className="cursor-pointer select-none text-xs font-medium text-fg-muted hover:text-fg">
          Amplifiers (optional — Somersloop / Power Shard)
        </summary>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">Somersloop slots filled</span>
            <input
              type="number"
              min={0}
              max={slots}
              value={somersloopSlotsFilled}
              disabled={!recipe}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSomersloopSlotsFilled(v);
                setUseSomersloop(v > 0);
              }}
              className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary disabled:opacity-50 tabular-nums"
            />
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              {recipe
                ? slots === 1
                  ? "This building has 1 slot (output × 2 when filled)."
                  : `This building has ${slots} slots (output × (1 + filled/${slots})).`
                : "Pick a recipe to see slot count."}
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-fg-muted">Power shards</span>
            <input
              type="number"
              min={0}
              max={3}
              value={powerShardCount}
              onChange={(e) => setPowerShardCount(Number(e.target.value))}
              className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
            />
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              0 → 100% · 1 → 150% · 2 → 200% · 3 → 250%
            </span>
          </label>

          <div className="self-end rounded-md border border-border bg-bg/40 px-2 py-1.5 text-xs text-fg-muted">
            <strong className="text-fg">Effective clock cap:</strong>{" "}
            <span className="tabular-nums">{shardClockCap}%</span>
          </div>
        </div>
      </details>

      {(error || serverError) && (
        <p role="alert" className="md:col-span-4 text-sm text-danger">
          {error ?? serverError}
        </p>
      )}
    </form>
  );
}
