import { useCallback, useMemo, useState } from "react";
import { Check, Plus, Share2, X } from "lucide-react";

import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Icon } from "@/shared/ui/Icon";
import { buildTargetOptions } from "@/features/planner/options";
import type { PlanTargetSpec } from "@/features/planner/types";
import { useItemTiers } from "@/features/planner/hooks/useItemTiers";
import { useItems } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { RateInput } from "./RateInput";

export interface PlanTargetsBarProps {
  targets: PlanTargetSpec[];
  itemNames: Map<string, string>;
  onAddTarget: (itemId: string, ipm: number) => void;
  onRemoveTarget: (itemId: string) => void;
  onSetTargetIpm: (itemId: string, ipm: number) => void;
}

/** Chip strip of the plan's products: icon + name + inline rate +
 * remove, plus an "Add product" picker. */
export function PlanTargetsBar({
  targets,
  itemNames,
  onAddTarget,
  onRemoveTarget,
  onSetTargetIpm,
}: PlanTargetsBarProps) {
  const items = useItems();
  const itemTiers = useItemTiers();
  const playthrough = useCurrentPlaythrough();
  const [adding, setAdding] = useState(false);
  // Item and rate land together, one commit — picking the item alone used to
  // add it at a hardcoded 60/min and re-solve immediately, so deep-tree items
  // (Modular Frame etc.) blew the factory out to hundreds of machines before
  // the rate could be edited down.
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pendingIpm, setPendingIpm] = useState(60);
  const [pendingRateInvalid, setPendingRateInvalid] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const targetOptions = useMemo(
    () => buildTargetOptions(items.data, itemTiers.data, playthrough.data?.currentTier),
    [items.data, itemTiers.data, playthrough.data?.currentTier],
  );
  const available = useMemo(() => {
    const used = new Set(targets.map((t) => t.itemId));
    return targetOptions.filter((o) => !used.has(o.value));
  }, [targetOptions, targets]);
  const pendingItemName = pendingItemId ? (itemNames.get(pendingItemId) ?? pendingItemId) : null;

  // Stable identity: `RateInput` reports validity from an effect, so a
  // fresh closure would re-fire it on every render.
  const handlePendingRateInvalid = useCallback((invalid: boolean) => {
    setPendingRateInvalid(invalid);
    if (!invalid) setAddError(null);
  }, []);

  const cancelAdd = () => {
    setAdding(false);
    setPendingItemId(null);
    setPendingIpm(60);
    setPendingRateInvalid(false);
    setAddError(null);
  };
  const confirmAdd = () => {
    if (pendingRateInvalid) {
      setAddError("Enter a rate greater than 0 — decimals like 2.5 are fine.");
      return;
    }
    if (!pendingItemId) {
      setAddError("Pick a product first.");
      return;
    }
    onAddTarget(pendingItemId, pendingIpm);
    cancelAdd();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {targets.map((t) => (
        <div
          key={t.itemId}
          className="flex items-center gap-2 rounded-full border border-border bg-bg-raised py-1 pl-2 pr-1"
        >
          <Icon itemId={t.itemId} alt="" className="h-5 w-5" />
          <span className="text-sm font-medium text-fg">
            {itemNames.get(t.itemId) ?? t.itemId}
          </span>
          <RateInput
            value={t.ipm}
            onCommit={(next) => onSetTargetIpm(t.itemId, next)}
            ariaLabel={`Rate for ${itemNames.get(t.itemId) ?? t.itemId}`}
            className="h-7 w-20 rounded-md border border-border bg-bg px-2 text-sm tabular-nums text-fg outline-none focus:border-primary"
          />
          <span className="text-xs text-fg-muted">/min</span>
          {t.exportIpm != null && t.exportIpm > 0 && (
            <span
              className="flex items-center gap-0.5 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] tabular-nums text-accent"
              title={`${t.exportIpm}/min offered to other factories (edit on the node)`}
            >
              <Share2 className="h-2.5 w-2.5" />
              {t.exportIpm}
            </span>
          )}
          <button
            type="button"
            aria-label={`Remove ${itemNames.get(t.itemId) ?? t.itemId}`}
            onClick={() => onRemoveTarget(t.itemId)}
            className="rounded-full p-1 text-fg-muted hover:bg-border hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {adding ? (
        pendingItemId ? (
          <div className="flex flex-col gap-1">
            <form
              // noValidate: native constraint validation cancels the
              // submit before React's handler runs, which is how a
              // rejected rate used to look identical to a dead button.
              // The check below owns the decision and the message.
              noValidate
              className="flex items-center gap-2 rounded-full border border-dashed border-primary/60 bg-bg-raised py-1 pl-2 pr-1"
              onSubmit={(e) => {
                e.preventDefault();
                confirmAdd();
              }}
            >
              <Icon itemId={pendingItemId} alt="" className="h-5 w-5" />
              <span className="text-sm font-medium text-fg">{pendingItemName}</span>
              <RateInput
                autoFocus
                value={pendingIpm}
                onCommit={setPendingIpm}
                revertOnBlur={false}
                onInvalidChange={handlePendingRateInvalid}
                ariaLabel={`Rate for ${pendingItemName}`}
                className="h-7 w-20 rounded-md border border-border bg-bg px-2 text-sm tabular-nums text-fg outline-none focus:border-primary"
              />
              <span className="text-xs text-fg-muted">/min</span>
              <button
                type="submit"
                aria-label={`Confirm adding ${pendingItemName}`}
                className="rounded-full p-1 text-success hover:bg-border"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Cancel adding product"
                onClick={cancelAdd}
                className="rounded-full p-1 text-fg-muted hover:bg-border hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
            {addError && (
              <span role="alert" className="px-3 text-xs text-danger">
                {addError}
              </span>
            )}
          </div>
        ) : (
          <div className="w-72">
            <FilterSelect
              compact
              autoFocus
              ariaLabel="Add product"
              options={available}
              value={null}
              placeholder="What should this factory make?"
              onChange={(next) => {
                if (next) {
                  setPendingItemId(next);
                } else {
                  setAdding(false);
                }
              }}
            />
          </div>
        )
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          Add product
        </button>
      )}
    </div>
  );
}
