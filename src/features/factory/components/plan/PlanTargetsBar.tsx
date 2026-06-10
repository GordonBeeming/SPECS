import { useMemo, useState } from "react";
import { Plus, Share2, X } from "lucide-react";

import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Icon } from "@/shared/ui/Icon";
import { buildTargetOptions } from "@/features/planner/options";
import type { PlanTargetSpec } from "@/features/planner/types";
import { useItems, useRecipes } from "@/features/library/hooks/useLibrary";

export interface PlanTargetsBarProps {
  targets: PlanTargetSpec[];
  itemNames: Map<string, string>;
  onAddTarget: (itemId: string) => void;
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
  const recipes = useRecipes();
  const [adding, setAdding] = useState(false);

  const targetOptions = useMemo(
    () => buildTargetOptions(items.data, recipes.data),
    [items.data, recipes.data],
  );
  const available = useMemo(() => {
    const used = new Set(targets.map((t) => t.itemId));
    return targetOptions.filter((o) => !used.has(o.value));
  }, [targetOptions, targets]);

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
          <input
            type="number"
            // min is the stepping base for native spinners — 0.1 made
            // a down-arrow from 3 land on 2.1. With base 0 the arrows
            // snap to whole numbers (3 → 2, 2.5 → 2); decimals are
            // still typeable, and onChange rejects anything ≤ 0.
            min={0}
            step={1}
            value={t.ipm}
            aria-label={`Rate for ${itemNames.get(t.itemId) ?? t.itemId}`}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) onSetTargetIpm(t.itemId, v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
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
        <div className="w-72">
          <FilterSelect
            compact
            autoFocus
            ariaLabel="Add product"
            options={available}
            value={null}
            placeholder="What should this factory make?"
            onChange={(next) => {
              if (next) onAddTarget(next);
              setAdding(false);
            }}
          />
        </div>
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
