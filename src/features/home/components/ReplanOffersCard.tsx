import { ArrowRight, Wand2 } from "lucide-react";

import type { ReplanOffer } from "@/features/planner/types";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

import { useApplyReplanOffer, useReplanOffers } from "../hooks/useReplanOffers";

/** "6 machines · 28.0 MW" — the same shape the map's factory card prints,
 * so the before figure here matches the one on that card. */
function summary(machines: number, powerMw: number): string {
  return `${machines} machine${machines === 1 ? "" : "s"} · ${powerMw.toFixed(1)} MW`;
}

function OfferRow({ offer }: { offer: ReplanOffer }) {
  const apply = useApplyReplanOffer();
  const cheaper = offer.reoptimizedPowerMw < offer.currentPowerMw;
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-border/40 py-2 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{offer.factoryName}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-fg-muted">
          <span>{summary(offer.currentMachines, offer.currentPowerMw)}</span>
          <ArrowRight className="h-3 w-3 shrink-0" aria-label="becomes" />
          <span className={cheaper ? "text-success" : "text-fg"}>
            {summary(offer.reoptimizedMachines, offer.reoptimizedPowerMw)}
          </span>
        </div>
        <ul className="mt-1 space-y-0.5 text-[11px] text-fg-muted">
          {offer.swaps.map((swap) => (
            <li key={swap.itemId}>
              <span className="text-fg">{swap.itemName}</span>: {swap.fromRecipeName} →{" "}
              <span className={swap.toIsAlt ? "text-primary" : undefined}>
                {swap.toRecipeName}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Button
        variant="ghost"
        onClick={() => apply.mutate(offer.factoryId)}
        disabled={apply.isPending}
        title={`Rebuild ${offer.factoryName}'s machine list on these recipes`}
        className="shrink-0 px-2.5 py-1.5 text-xs"
      >
        <Wand2 className="h-3.5 w-3.5" />
        {apply.isPending ? "Re-optimizing…" : "Re-optimize"}
      </Button>
      {apply.isError && (
        <p className="w-full text-xs text-danger">
          Couldn't re-optimize {offer.factoryName}:{" "}
          {apply.error instanceof Error ? apply.error.message : "unknown error"}
        </p>
      )}
    </li>
  );
}

/**
 * "3 factories could be cheaper — review?", sitting under the tier
 * picker because reaching a tier is what puts better recipes within
 * reach.
 *
 * Nothing here happens on its own. A saved plan holds the recipes it
 * was built on, so this card is the whole of how a player finds out a
 * better plan exists, and taking it is per factory — the point is being
 * able to redesign the new plant and leave the one already standing in
 * the game alone.
 */
export function ReplanOffersCard({ tier }: { tier: number }) {
  const offers = useReplanOffers();
  const rows = offers.data ?? [];
  if (rows.length === 0) return null;

  return (
    <Card className="border-primary/30">
      <h2 className="text-sm font-semibold text-primary">
        {rows.length} {rows.length === 1 ? "factory" : "factories"} would plan
        differently at Tier {tier}
      </h2>
      <p className="mt-1 text-xs text-fg-muted">
        Your plans keep the recipes they were built on. These are the factories the
        optimizer would now build another way — take the ones you haven't put down in
        game yet.
      </p>
      <ul className="mt-2">
        {rows.map((offer) => (
          <OfferRow key={offer.factoryId} offer={offer} />
        ))}
      </ul>
    </Card>
  );
}
