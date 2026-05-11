import { useMemo } from "react";
import { Icon } from "@/shared/ui/Icon";
import { useItems, useRecipes } from "../hooks/useLibrary";
import type { Item } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";

const columns: Column<Item & { _tier: number }>[] = [
  {
    header: "",
    cell: (i) => <Icon itemId={i.id} alt={i.name} className="h-6 w-6" />,
  },
  { header: "Name", cell: (i) => i.name },
  { header: "Category", cell: (i) => i.category },
  { header: "Stack", cell: (i) => (i.isFluid ? "—" : i.stackSize.toLocaleString()), align: "right" },
  { header: "Type", cell: (i) => (i.isFluid ? "Fluid" : "Solid") },
  { header: "ID", cell: (i) => <code className="text-xs text-fg-muted">{i.id}</code> },
];

export function ItemsTable() {
  const { data, isPending, isError, error } = useItems();
  const recipes = useRecipes();
  // Items don't carry a tier directly; derive from the earliest
  // standard (non-alt, non-Unpackage) recipe producing each item.
  // Raw resources (no producing recipe) sort to Tier 0.
  const rows = useMemo(() => {
    if (!data) return undefined;
    const tierByItem = new Map<string, number>();
    for (const r of recipes.data ?? []) {
      if (r.isAlt) continue;
      if (r.id.startsWith("Recipe_Unpackage")) continue;
      for (const o of r.outputs) {
        const cur = tierByItem.get(o.itemId);
        if (cur === undefined || r.unlockTier < cur) {
          tierByItem.set(o.itemId, r.unlockTier);
        }
      }
    }
    return [...data]
      .map((i) => ({ ...i, _tier: tierByItem.get(i.id) ?? 0 }))
      .sort((a, b) =>
        a._tier === b._tier
          ? a.name.localeCompare(b.name)
          : a._tier - b._tier,
      );
  }, [data, recipes.data]);

  return (
    <LibraryTable
      rows={rows}
      isPending={isPending}
      isError={isError}
      error={error}
      columns={columns}
      rowKey={(r) => r.id}
      groupKey={(r) => `Tier ${r._tier}`}
    />
  );
}
