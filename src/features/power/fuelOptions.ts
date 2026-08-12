import type { Generator, Item } from "@/features/library/types";
import type { FilterOption } from "@/shared/ui/FilterSelect";

/** Generators the playthrough has actually unlocked. */
export function eligibleGenerators(
  generators: Generator[] | undefined,
  tierCap: number,
): Generator[] {
  return (generators ?? []).filter((g) => g.unlockTier <= tierCap);
}

/**
 * Whether a fuel is reachable at `tierCap`, given the obtainable-tier
 * map the planner slice builds (`obtainableTierById`). Gating on the
 * fuel rather than on its generator's `unlockTier` is the point: the
 * Fuel Generator alone spans Fuel through Ionized Fuel, so the
 * generator being buildable says nothing about which of its fuels are
 * within reach. An id absent from the map is unreachable — no stand-in
 * number, which would read as a real tier at the comparison.
 *
 * `keepFuelItemId` pins a choice already saved on a row so an edit
 * can't silently reassign it if the tier cap has moved beneath it.
 */
export function isFuelAvailable(
  fuelItemId: string,
  fuelTierById: Map<string, number>,
  tierCap: number,
  keepFuelItemId?: string,
): boolean {
  if (keepFuelItemId && fuelItemId === keepFuelItemId) return true;
  const tier = fuelTierById.get(fuelItemId);
  return tier !== undefined && tier <= tierCap;
}

export interface FuelOptionContext {
  itemsById: Map<string, Item>;
  /** From `obtainableTierById` — see {@link isFuelAvailable}. */
  fuelTierById: Map<string, number>;
  tierCap: number;
  /** Never filter this fuel out — see {@link isFuelAvailable}. */
  keepFuelItemId?: string;
}

/**
 * The fuels a generator can be given right now, as `FilterSelect`
 * options. The hint spells out the burn rate plus any supplemental
 * input (a Nuclear Power Plant's water), because that flow is what
 * decides whether the generator is affordable, not the fuel's name.
 */
export function fuelFilterOptions(
  generator: Generator | undefined,
  ctx: FuelOptionContext,
): FilterOption[] {
  return (generator?.fuels ?? [])
    .filter((f) =>
      isFuelAvailable(f.fuelItemId, ctx.fuelTierById, ctx.tierCap, ctx.keepFuelItemId),
    )
    .map((f) => ({
      value: f.fuelItemId,
      label: ctx.itemsById.get(f.fuelItemId)?.name ?? f.fuelItemId,
      hint:
        `${f.fuelPerMinute.toFixed(2)} /min` +
        (f.supplementalItemId
          ? ` + ${f.supplementalPerMinute?.toFixed(0) ?? "?"} ${
              ctx.itemsById.get(f.supplementalItemId)?.name ?? f.supplementalItemId
            }`
          : ""),
      iconId: f.fuelItemId,
    }));
}

/** The same fuel list in the `{ id, name }` shape `EditPowerGenModal`
 * takes, which shows a plain select rather than a filterable one. */
export function fuelNameOptions(
  generator: Generator | undefined,
  ctx: FuelOptionContext,
): Array<{ id: string; name: string }> {
  return fuelFilterOptions(generator, ctx).map((o) => ({ id: o.value, name: o.label }));
}

/** Generator options for `FilterSelect`, tagged with output and unlock
 * tier so the pick can be made without cross-referencing the library. */
export function generatorFilterOptions(generators: Generator[]): FilterOption[] {
  return generators.map((g) => ({
    value: g.id,
    label: g.name,
    hint: `${g.powerMw} MW · T${g.unlockTier}`,
    iconId: g.id,
  }));
}
