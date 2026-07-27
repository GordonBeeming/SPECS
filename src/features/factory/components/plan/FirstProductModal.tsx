import { useCallback, useMemo, useState } from "react";
import { Package, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Icon } from "@/shared/ui/Icon";
import { buildTargetOptions } from "@/features/planner/options";
import { useItemTiers } from "@/features/planner/hooks/useItemTiers";
import { useItems } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { RateInput } from "./RateInput";

export interface FirstProductModalProps {
  factoryName: string;
  /** Fresh from quick-create — the cancel wording acknowledges the
      factory was just made. */
  firstRun: boolean;
  onConfirm: (itemId: string, ipm: number) => void;
  onDeleteFactory: () => void;
}

/**
 * The getting-started moment: an empty plan (first run OR every
 * product cleared) gets a centered modal instead of a top-left picker
 * the eye never finds. One product + one rate and the graph takes it
 * from there; the only other way out is deleting the factory.
 */
export function FirstProductModal({
  factoryName,
  firstRun,
  onConfirm,
  onDeleteFactory,
}: FirstProductModalProps) {
  const items = useItems();
  const itemTiers = useItemTiers();
  const playthrough = useCurrentPlaythrough();
  const [itemId, setItemId] = useState<string | null>(null);
  const [ipm, setIpm] = useState(60);
  const [rateInvalid, setRateInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => buildTargetOptions(items.data, itemTiers.data, playthrough.data?.currentTier),
    [items.data, itemTiers.data, playthrough.data?.currentTier],
  );
  const itemName = useMemo(
    () => options.find((o) => o.value === itemId)?.label ?? null,
    [options, itemId],
  );

  // Stable identity: `RateInput` reports validity from an effect.
  const handleRateInvalid = useCallback((invalid: boolean) => {
    setRateInvalid(invalid);
    if (!invalid) setError(null);
  }, []);

  const submit = () => {
    if (rateInvalid) {
      setError("Enter a rate greater than 0 — decimals like 2.5 are fine.");
      return;
    }
    if (itemId === null) {
      setError("Pick a product first.");
      return;
    }
    onConfirm(itemId, ipm);
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm">
      <form
        role="dialog"
        aria-label="Choose what this factory makes"
        className="w-full max-w-[460px] rounded-xl border border-border bg-bg-raised p-8 shadow-2xl"
        // noValidate: native constraint validation cancels the submit
        // before this handler runs, and a dialog that just refuses to
        // close is the worst failure mode available — the user can't
        // tell "rejected" from "my click didn't register".
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3 className="text-center text-2xl font-semibold text-fg">
          What should {factoryName} make?
        </h3>
        <p className="mt-2 text-center text-sm text-fg-muted">
          Pick a product and a rate — the production graph builds itself. Recipes,
          sources and exports can all change later.
        </p>

        <div className="mt-6 flex justify-center">
          <div
            className={`flex h-24 w-24 items-center justify-center rounded-full transition-colors ${
              itemId
                ? "bg-primary/10 ring-2 ring-primary/40"
                : "ring-2 ring-dashed ring-border"
            }`}
          >
            {itemId ? (
              <Icon itemId={itemId} alt={itemName ?? ""} className="h-16 w-16" />
            ) : (
              <Package className="h-10 w-10 text-fg-muted" />
            )}
          </div>
        </div>

        <div className="mt-6">
          <FilterSelect
            autoFocus
            ariaLabel="Product"
            options={options}
            value={itemId}
            placeholder="Search products…"
            onChange={setItemId}
          />
        </div>

        <div className="mt-4 flex items-baseline justify-center gap-2">
          <RateInput
            value={ipm}
            onCommit={setIpm}
            revertOnBlur={false}
            onInvalidChange={handleRateInvalid}
            ariaLabel="Items per minute"
            className="h-12 w-32 rounded-lg border border-border bg-bg px-3 text-center text-2xl font-semibold tabular-nums text-fg outline-none focus:border-primary"
          />
          <span className="text-lg text-fg-muted">/min</span>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-center text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="danger"
            onClick={onDeleteFactory}
            className="px-3 py-2 text-sm"
          >
            <Trash2 className="h-4 w-4" />
            {firstRun ? "Cancel & delete this factory" : "Delete this factory"}
          </Button>
          <Button type="submit" className="px-6 py-2 text-sm">
            OK
          </Button>
        </div>
      </form>
    </div>
  );
}
