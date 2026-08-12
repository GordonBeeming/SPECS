import { useMemo } from "react";
import { Icon } from "@/shared/ui/Icon";
import { useItems } from "../hooks/useLibrary";
import { useItemTiers } from "@/features/planner/hooks/useItemTiers";
import { obtainableTier } from "@/features/planner/itemTiers";
import type { Item } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";

const columns: Column<Item & { _tier: number | null }>[] = [
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
  const itemTiers = useItemTiers();
  // The planner's whole-chain tiers, not a second answer derived from
  // recipe stamps here. That local derivation read a byproduct recipe
  // as an item's origin, so it filed Water under the Battery that
  // drips it out rather than the Tier 3 Water Extractor, and left
  // Crude Oil at Tier 0 five tiers before the Oil Extractor exists.
  //
  // Hand gathering counts, because this table answers "when can I
  // first have this" rather than "what can I plan a factory around" —
  // Wood belongs at Tier 0 next to iron ore.
  const rows = useMemo(() => {
    if (!data) return undefined;
    const tierByItem = new Map<string, number>();
    for (const entry of itemTiers.data ?? []) {
      const tier = obtainableTier(entry);
      if (tier !== null) tierByItem.set(entry.itemId, tier);
    }
    return [...data]
      .map((i) => ({ ...i, _tier: tierByItem.get(i.id) ?? null }))
      .sort((a, b) => {
        // Items nothing reaches at all (event drops) sort last rather
        // than landing in Tier 0 the way an absent entry used to.
        if (a._tier === null || b._tier === null) {
          return a._tier === b._tier
            ? a.name.localeCompare(b.name)
            : a._tier === null
              ? 1
              : -1;
        }
        return a._tier === b._tier ? a.name.localeCompare(b.name) : a._tier - b._tier;
      });
  }, [data, itemTiers.data]);

  return (
    <LibraryTable
      rows={rows}
      isPending={isPending}
      isError={isError}
      error={error}
      columns={columns}
      rowKey={(r) => r.id}
      groupKey={(r) => (r._tier === null ? "No route to it" : `Tier ${r._tier}`)}
    />
  );
}
