import { Icon } from "@/shared/ui/Icon";
import { useBuildings, useItems, useRecipes } from "../hooks/useLibrary";
import type { Recipe } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";
import { TierBadge } from "./TierBadge";

function IoList({
  io,
  itemName,
}: {
  io: { itemId: string; perMinute: number }[];
  itemName: (id: string) => string;
}) {
  if (io.length === 0) return <span className="text-fg-muted">—</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {io.map((row) => (
        <li key={row.itemId} className="flex items-center gap-2 whitespace-nowrap">
          <Icon itemId={row.itemId} alt="" className="h-4 w-4 shrink-0" />
          <span className="tabular-nums">{row.perMinute.toLocaleString()}</span>
          <span>{itemName(row.itemId)}/min</span>
        </li>
      ))}
    </ul>
  );
}

export function RecipesTable() {
  const { data: recipes, isPending, isError, error } = useRecipes();
  const { data: items } = useItems();
  const { data: buildings } = useBuildings();

  const itemNames = new Map(items?.map((i) => [i.id, i.name]) ?? []);
  const buildingNames = new Map(buildings?.map((b) => [b.id, b.name]) ?? []);
  const itemName = (id: string) => itemNames.get(id) ?? id;
  const buildingName = (id: string) => buildingNames.get(id) ?? id;

  const columns: Column<Recipe>[] = [
    {
      header: "",
      cell: (r) => (
        <Icon itemId={r.outputs[0]?.itemId ?? r.id} alt="" className="h-6 w-6" />
      ),
    },
    {
      header: "Name",
      cell: (r) => (
        <span className="whitespace-nowrap">
          {r.name}
          {r.isAlt && (
            <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-medium text-warning">
              alt
            </span>
          )}
        </span>
      ),
    },
    {
      header: "Building",
      cell: (r) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <Icon itemId={r.buildingId} alt="" className="h-4 w-4 shrink-0" />
          {buildingName(r.buildingId)}
        </span>
      ),
    },
    {
      header: "Inputs",
      cell: (r) => <IoList io={r.inputs} itemName={itemName} />,
    },
    {
      header: "Outputs",
      cell: (r) => <IoList io={r.outputs} itemName={itemName} />,
    },
    { header: "Cycle (s)", cell: (r) => r.cycleSeconds.toFixed(1), align: "right" },
    { header: "Unlocks at", cell: (r) => <TierBadge unlockTier={r.unlockTier} />, align: "right" },
  ];

  // Sort non-alts by their unlock tier; alts go into a dedicated
  // 'Alts (Hard Drives)' bucket at the bottom because their
  // dataset-level unlockTier=0 means 'available after Hard Drive
  // analysis', not 'available at T0'.
  const sorted = recipes
    ? [...recipes].sort((a, b) => {
        if (a.isAlt !== b.isAlt) return a.isAlt ? 1 : -1;
        if (!a.isAlt) {
          return a.unlockTier === b.unlockTier
            ? a.name.localeCompare(b.name)
            : a.unlockTier - b.unlockTier;
        }
        return a.name.localeCompare(b.name);
      })
    : undefined;

  return (
    <LibraryTable
      rows={sorted}
      isPending={isPending}
      isError={isError}
      error={error}
      columns={columns}
      rowKey={(r) => r.id}
      groupKey={(r) => (r.isAlt ? "Alts (Hard Drives)" : `Tier ${r.unlockTier}`)}
    />
  );
}
