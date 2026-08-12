import { useState } from "react";
import { ArrowRight, Wand2 } from "lucide-react";

import type { ReplanOffer } from "@/features/planner/types";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { UndoSnackbar } from "@/shared/ui/UndoSnackbar";

import {
  useApplyReplanOffer,
  useReplanOffers,
  useUndoReplanOffer,
} from "../hooks/useReplanOffers";

/** "6 machines · 28.0 MW" — the same shape the map's factory card prints,
 * so the before figure here matches the one on that card. */
function summary(machines: number, powerMw: number): string {
  return `${machines} machine${machines === 1 ? "" : "s"} · ${powerMw.toFixed(1)} MW`;
}

/** What the last apply dropped, so the snackbar can put it back. */
interface TakenOffer {
  factoryId: string;
  factoryName: string;
  recipes: Record<string, string>;
  /** Remounts the snackbar so taking a second offer gets its own full
   * undo window instead of the remains of the first. */
  seq: number;
}

function OfferRow({
  offer,
  tier,
  onTaken,
}: {
  offer: ReplanOffer;
  tier: number;
  onTaken: (taken: Omit<TakenOffer, "seq">) => void;
}) {
  const apply = useApplyReplanOffer();
  const [confirming, setConfirming] = useState(false);
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
        onClick={() => setConfirming(true)}
        disabled={apply.isPending || confirming}
        title={`Rebuild ${offer.factoryName}'s machine list on these recipes`}
        className="shrink-0 px-2.5 py-1.5 text-xs"
      >
        <Wand2 className="h-3.5 w-3.5" />
        {apply.isPending ? "Re-optimizing…" : "Re-optimize"}
      </Button>
      {confirming && (
        <div
          role="alertdialog"
          className="w-full rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
        >
          <div className="font-semibold text-warning">
            Re-optimize {offer.factoryName}?
          </div>
          <p className="mt-1 text-fg-muted">
            This drops the recipes {offer.factoryName} is built on and picks fresh ones
            from everything reachable at Tier {tier}, alts included. The new choices can
            change what this factory needs, so existing imports or links may end up
            unsourced or unused. Its machine list is rebuilt straight away — there's no
            save to hold it back — and you can undo it right after. A link that survives
            keeps the transport you gave it; one the new recipes drop comes back as a
            plain belt.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirming(false)}
              className="px-3 py-1 text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                apply.mutate(offer.factoryId, {
                  onSuccess: (result) =>
                    onTaken({
                      factoryId: offer.factoryId,
                      factoryName: offer.factoryName,
                      recipes: result.droppedRecipes,
                    }),
                });
              }}
              className="px-3 py-1 text-xs"
            >
              Re-optimize
            </Button>
          </div>
        </div>
      )}
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
 * the game alone. Taking one carries the same confirm-then-undo the
 * designer's own Re-optimize does; it rebuilds machines that may already
 * be built in the game, and which screen it was pressed from doesn't
 * change that.
 */
export function ReplanOffersCard({ tier }: { tier: number }) {
  const offers = useReplanOffers();
  const undo = useUndoReplanOffer();
  const [taken, setTaken] = useState<TakenOffer | null>(null);
  const rows = offers.data ?? [];
  if (rows.length === 0 && !taken && !undo.isError) return null;

  return (
    <>
      {undo.isError && (
        <Card className="border-danger/40">
          <p className="text-xs text-danger">
            Couldn't undo that re-optimize:{" "}
            {undo.error instanceof Error ? undo.error.message : "unknown error"}. The
            factory is still on its new recipes — open it and re-optimize from there to
            pick again.
          </p>
        </Card>
      )}
      {rows.length > 0 && (
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
              <OfferRow
                key={offer.factoryId}
                offer={offer}
                tier={tier}
                onTaken={(next) =>
                  setTaken((prev) => ({ ...next, seq: (prev?.seq ?? 0) + 1 }))
                }
              />
            ))}
          </ul>
        </Card>
      )}
      {taken && (
        <UndoSnackbar
          key={taken.seq}
          message={`${taken.factoryName} re-optimized.`}
          onUndo={() => {
            undo.mutate({ factoryId: taken.factoryId, recipes: taken.recipes });
            setTaken(null);
          }}
          onDismiss={() => setTaken(null)}
        />
      )}
    </>
  );
}
