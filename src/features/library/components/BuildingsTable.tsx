import { useBuildings } from "../hooks/useLibrary";
import type { Building } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";

const columns: Column<Building>[] = [
  { header: "Name", cell: (b) => b.name },
  { header: "Category", cell: (b) => b.category },
  { header: "Power (MW)", cell: (b) => b.powerMw.toFixed(1), align: "right" },
  { header: "Unlocks at", cell: (b) => `Tier ${b.unlockTier}`, align: "right" },
  { header: "ID", cell: (b) => <code className="text-xs text-fg-muted">{b.id}</code> },
];

export function BuildingsTable() {
  const { data, isPending } = useBuildings();
  return (
    <LibraryTable rows={data} isPending={isPending} columns={columns} rowKey={(r) => r.id} />
  );
}
