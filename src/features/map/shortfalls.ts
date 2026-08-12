import { traceRawDemand } from "@/features/factory/traceRaw";
import type { FactoryLedger } from "@/features/factory/types";
import type { Recipe } from "@/features/library/types";

/** One raw resource a factory needs, and how much of it is covered by
 * the nodes bound to that factory. `missing` is what's left. */
export interface RawRequirement {
  itemId: string;
  required: number;
  bound: number;
  missing: number;
}

/**
 * What a factory ultimately needs out of the ground, burning down as
 * bound nodes contribute — the "Requires" list on the map's factory
 * card, and the same answer the claim popup's default factory is
 * ranked on. One implementation because the two are read within a
 * gesture of each other: a default that disagreed with the number on
 * the card that sent the player to the map would be indefensible from
 * either side.
 *
 * Demand is traced GROSS (before subtracting what nodes already
 * supply) so the caller can render the burn-down as "180 of 675 bound ·
 * 495 missing"; subtracting earlier collapses that into one number and
 * loses the telemetry. Intermediates (Iron Rod, Screw, …) never bind
 * from nodes, so the rollup to raw is the only useful demand view.
 *
 * A deficit covered by an incoming logistics link is supplied, not
 * missing — a factory importing its Copper Ingot must not roll that
 * demand back to "ore missing".
 */
export function rawRequirements(
  ledger: FactoryLedger,
  recipes: Recipe[],
  extracted: ReadonlySet<string>,
): RawRequirement[] {
  const grossDeficits = ledger.flows
    .filter((flow) => flow.netPerMinute < -0.001)
    .map((flow) => ({
      itemId: flow.itemId,
      ratePerMin: Math.max(0, -flow.netPerMinute - (flow.fromLinksPerMinute ?? 0)),
    }))
    .filter((d) => d.ratePerMin > 0.001);
  const raw =
    grossDeficits.length === 0 ? {} : traceRawDemand(grossDeficits, recipes, extracted);
  const boundFor = (itemId: string): number =>
    ledger.flows.find((f) => f.itemId === itemId)?.fromNodesPerMinute ?? 0;
  return Object.entries(raw)
    .map(([itemId, required]) => {
      const bound = boundFor(itemId);
      return {
        itemId,
        required,
        bound: Math.min(bound, required),
        missing: Math.max(0, required - bound),
      };
    })
    .sort((a, b) => b.required - a.required);
}

/** Resource item id → the factories still short of it. */
export type ShortfallsByItem = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Roll every factory's raw requirements into "who still wants this
 * resource", which is the question the claim popup asks and the only
 * one it asks. A factory whose requirement is fully covered by bound
 * nodes is not short and doesn't appear.
 */
export function shortfallsByItem(
  ledgers: Array<{ factoryId: string; requirements: RawRequirement[] }>,
): Map<string, Set<string>> {
  const byItem = new Map<string, Set<string>>();
  for (const { factoryId, requirements } of ledgers) {
    for (const r of requirements) {
      if (r.missing <= 0.001) continue;
      const bucket = byItem.get(r.itemId) ?? new Set<string>();
      bucket.add(factoryId);
      byItem.set(r.itemId, bucket);
    }
  }
  return byItem;
}
