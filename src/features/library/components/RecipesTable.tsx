import { useBuildings, useItems, useRecipes } from "../hooks/useLibrary";
import type { Recipe } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";

function formatIo(io: { itemId: string; perMinute: number }, itemName: (id: string) => string) {
  return `${io.perMinute.toLocaleString()} ${itemName(io.itemId)}/min`;
}

export function RecipesTable() {
  const { data: recipes, isPending } = useRecipes();
  const { data: items } = useItems();
  const { data: buildings } = useBuildings();

  const itemNames = new Map(items?.map((i) => [i.id, i.name]) ?? []);
  const buildingNames = new Map(buildings?.map((b) => [b.id, b.name]) ?? []);
  const itemName = (id: string) => itemNames.get(id) ?? id;
  const buildingName = (id: string) => buildingNames.get(id) ?? id;

  const columns: Column<Recipe>[] = [
    {
      header: "Name",
      cell: (r) => (
        <span>
          {r.name}
          {r.isAlt && (
            <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-medium text-warning">
              alt
            </span>
          )}
        </span>
      ),
    },
    { header: "Building", cell: (r) => buildingName(r.buildingId) },
    {
      header: "Inputs",
      cell: (r) => r.inputs.map((io) => formatIo(io, itemName)).join(" + ") || "—",
    },
    {
      header: "Outputs",
      cell: (r) => r.outputs.map((io) => formatIo(io, itemName)).join(" + "),
    },
    { header: "Cycle (s)", cell: (r) => r.cycleSeconds.toFixed(1), align: "right" },
    { header: "Unlocks at", cell: (r) => `Tier ${r.unlockTier}`, align: "right" },
  ];

  return (
    <LibraryTable rows={recipes} isPending={isPending} columns={columns} rowKey={(r) => r.id} />
  );
}
