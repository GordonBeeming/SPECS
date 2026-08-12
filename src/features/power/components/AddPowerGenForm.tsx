import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/shared/ui/Button";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import type { Generator, Item } from "@/features/library/types";

import { fuelFilterOptions, generatorFilterOptions } from "../fuelOptions";
import { useAddPowerGen } from "../hooks/usePower";
import type { CreatePowerGenInput } from "../types";

const MIN_COUNT = 1;
// Mirrors `validate_count`'s upper bound in src-tauri/src/features/power/commands.rs —
// keep the two in sync so a count the form accepts never bounces off the backend.
const MAX_COUNT = 1_000;
const MIN_CLOCK_PCT = 1;
const MAX_CLOCK_PCT = 250;

/**
 * `row` spreads the fields across one line for the Power screen's
 * full-width card; `stacked` runs them down a column for the
 * production plan's fixed-width side panel, where a five-column row
 * squeezes both pickers below the width their option text needs.
 */
export type AddPowerGenLayout = "row" | "stacked";

interface AddPowerGenFormProps {
  factoryId: string;
  /** Already filtered to what the playthrough's tier has unlocked. */
  unlockedGenerators: Generator[];
  itemsById: Map<string, Item>;
  fuelTierById: Map<string, number>;
  tierCap: number;
  /**
   * The reads the option lists are built from — the generator and item
   * catalogs, the tier table, and the playthrough that sets `tierCap`.
   * Until all of them land the pickers are genuinely empty, and an
   * empty fuel picker is exactly what a player sees when a fuel is out
   * of reach at their tier. A half-loaded form must not impersonate
   * that. `tierCap` matters just as much as the catalogs: it defaults
   * to 9 while the playthrough is in flight, so enabling early would
   * offer a Tier 0 player every generator in the game.
   */
  optionsLoading: boolean;
  /** Called after a row is written, for callers that hide the form. */
  onSubmitted?: () => void;
  layout?: AddPowerGenLayout;
}

/**
 * Adds a bank of generators to one factory. Shared so the Power screen
 * and the in-factory panel can't drift on the rules that decide what's
 * offered, what validates, and what a half-loaded picker says.
 */
export function AddPowerGenForm({
  factoryId,
  unlockedGenerators,
  itemsById,
  fuelTierById,
  tierCap,
  optionsLoading,
  onSubmitted,
  layout = "row",
}: AddPowerGenFormProps) {
  const add = useAddPowerGen(factoryId);
  const [generatorId, setGeneratorId] = useState("");
  const [fuelItemId, setFuelItemId] = useState("");
  // Counts are held as raw strings so clearing the box leaves it empty
  // rather than snapping to 0 mid-edit — `Number("")` is 0, which
  // fights anyone selecting-all to retype a value.
  const [countText, setCountText] = useState("1");
  const [clockText, setClockText] = useState("100");
  const [error, setError] = useState<string | null>(null);

  const generator = unlockedGenerators.find((g) => g.id === generatorId);
  const burnsNothing = !!generator && generator.fuels.length === 0;
  // Memoised because the stale-fuel effect below depends on it — rebuilt
  // inline, a fresh array every render would re-run that effect on every
  // render for no reason.
  const fuelOptions = useMemo(
    () => fuelFilterOptions(generator, { itemsById, fuelTierById, tierCap }),
    [generator, itemsById, fuelTierById, tierCap],
  );

  // A pick can stop being valid underneath the player: raising a tier
  // is additive, but loading a different playthrough or switching
  // factories can drop the generator out of the unlocked list. Leaving
  // the id set then reads as a populated field whose fuel picker is
  // empty and whose submit answers "Pick a generator".
  useEffect(() => {
    if (generatorId && !generator && !optionsLoading) {
      setGeneratorId("");
      setFuelItemId("");
    }
  }, [generatorId, generator, optionsLoading]);

  // Likewise for the fuel: a generator swap clears it, but a tier
  // change can strip the chosen fuel from an unchanged generator.
  useEffect(() => {
    if (fuelItemId && !optionsLoading && !fuelOptions.some((o) => o.value === fuelItemId)) {
      setFuelItemId("");
    }
  }, [fuelItemId, fuelOptions, optionsLoading]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!generator) {
      setError("Pick a generator.");
      return;
    }
    // Geothermal generators burn nothing, so `add_power_gen` takes an
    // empty fuel id for them rather than a missing one.
    if (!burnsNothing && !fuelItemId) {
      setError("Pick a fuel.");
      return;
    }
    const count = Number(countText.trim());
    const clockPct = Number(clockText.trim());
    // Whole generators only. `<input type="number">` happily holds
    // "1.5", and the form is noValidate, so without the integer check a
    // fractional count reached `CreatePowerGenInput.count: i64` and came
    // back as a raw serde message — "invalid type: floating point `1.5`,
    // expected i64" — shown to the player as a server error.
    if (
      countText.trim() === "" ||
      !Number.isInteger(count) ||
      count < MIN_COUNT ||
      count > MAX_COUNT
    ) {
      setError(`Count must be a whole number between ${MIN_COUNT} and ${MAX_COUNT.toLocaleString()}.`);
      return;
    }
    if (
      clockText.trim() === "" ||
      !Number.isFinite(clockPct) ||
      clockPct < MIN_CLOCK_PCT ||
      clockPct > MAX_CLOCK_PCT
    ) {
      setError(`Clock must be between ${MIN_CLOCK_PCT}% and ${MAX_CLOCK_PCT}%.`);
      return;
    }
    setError(null);
    const input: CreatePowerGenInput = {
      factoryId,
      generatorId: generator.id,
      fuelItemId: burnsNothing ? "" : fuelItemId,
      count,
      clockPct,
    };
    add.mutate(input, {
      onSuccess: () => {
        // The generator and fuel stay picked: adding a second bank of
        // the same burners is the common next move, and re-picking both
        // every time is the friction this form exists to remove. Callers
        // that hide the form on submit discard this anyway.
        setCountText("1");
        setClockText("100");
        onSubmitted?.();
      },
    });
  };

  const serverError = add.error instanceof Error ? add.error.message : null;
  const stacked = layout === "stacked";
  const labelClass = stacked
    ? "text-[11px] font-medium text-fg-muted"
    : "text-xs font-medium text-fg-muted";
  const inputClass =
    "mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums";

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={
        stacked ? "flex flex-col gap-2" : "grid gap-3 md:grid-cols-[1fr_1fr_6rem_8rem_auto] md:items-end"
      }
    >
      <label className="block">
        <span className={labelClass}>Generator</span>
        <div className="mt-1">
          <FilterSelect
            ariaLabel="Generator"
            compact
            disabled={optionsLoading}
            placeholder={optionsLoading ? "Loading generators…" : "Pick a generator…"}
            value={generatorId || null}
            onChange={(next) => {
              setGeneratorId(next ?? "");
              setFuelItemId("");
            }}
            options={generatorFilterOptions(unlockedGenerators)}
          />
        </div>
      </label>
      <label className="block">
        <span className={labelClass}>Fuel</span>
        <div className="mt-1">
          <FilterSelect
            ariaLabel="Fuel"
            compact
            placeholder={
              optionsLoading ? "Loading fuels…" : burnsNothing ? "Burns nothing" : "Pick a fuel…"
            }
            disabled={burnsNothing || optionsLoading}
            value={fuelItemId || null}
            onChange={(next) => setFuelItemId(next ?? "")}
            options={fuelOptions}
          />
        </div>
      </label>
      <div className={stacked ? "flex items-end gap-2" : "contents"}>
        <label className={stacked ? "block flex-1" : "block"}>
          <span className={labelClass}>Count</span>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_COUNT}
            max={MAX_COUNT}
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={stacked ? "block flex-1" : "block"}>
          <span className={labelClass}>Clock %</span>
          <input
            type="number"
            inputMode="decimal"
            min={MIN_CLOCK_PCT}
            max={MAX_CLOCK_PCT}
            step={0.1}
            value={clockText}
            onChange={(e) => setClockText(e.target.value)}
            className={inputClass}
          />
        </label>
        <Button
          type="submit"
          disabled={add.isPending}
          className={stacked ? "h-9 px-3 py-0 text-xs" : undefined}
        >
          {add.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
      {(error || serverError) && (
        <p role="alert" className={stacked ? "text-xs text-danger" : "md:col-span-5 text-sm text-danger"}>
          {error ?? serverError}
        </p>
      )}
    </form>
  );
}
