import { useMemo, useState } from "react";
import { Package, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Icon } from "@/shared/ui/Icon";
import { buildTargetOptions } from "@/features/planner/options";
import { useItems, useRecipes } from "@/features/library/hooks/useLibrary";

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
  const recipes = useRecipes();
  const [itemId, setItemId] = useState<string | null>(null);
  const [ipm, setIpm] = useState(60);

  const options = useMemo(
    () => buildTargetOptions(items.data, recipes.data),
    [items.data, recipes.data],
  );
  const itemName = useMemo(
    () => options.find((o) => o.value === itemId)?.label ?? null,
    [options, itemId],
  );

  const canConfirm = itemId !== null && Number.isFinite(ipm) && ipm > 0;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm">
      <form
        role="dialog"
        aria-label="Choose what this factory makes"
        className="w-full max-w-[460px] rounded-xl border border-border bg-bg-raised p-8 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm && itemId) onConfirm(itemId, ipm);
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
          <input
            type="number"
            min={0}
            step={1}
            value={ipm}
            aria-label="Items per minute"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setIpm(v);
            }}
            className="h-12 w-32 rounded-lg border border-border bg-bg px-3 text-center text-2xl font-semibold tabular-nums text-fg outline-none focus:border-primary"
          />
          <span className="text-lg text-fg-muted">/min</span>
        </div>

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
          <Button type="submit" disabled={!canConfirm} className="px-6 py-2 text-sm">
            OK
          </Button>
        </div>
      </form>
    </div>
  );
}
