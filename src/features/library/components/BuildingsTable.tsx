import { Icon } from "@/shared/ui/Icon";
import { useBuildings } from "../hooks/useLibrary";
import type { Building } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";
import { TierBadge } from "./TierBadge";

const columns: Column<Building>[] = [
  {
    header: "",
    cell: (b) => <Icon itemId={b.id} alt={b.name} className="h-6 w-6" />,
  },
  { header: "Name", cell: (b) => b.name },
  { header: "Category", cell: (b) => b.category },
  { header: "Power (MW)", cell: (b) => b.powerMw.toFixed(1), align: "right" },
  { header: "Unlocks at", cell: (b) => <TierBadge unlockTier={b.unlockTier} />, align: "right" },
  { header: "ID", cell: (b) => <code className="text-xs text-fg-muted">{b.id}</code> },
];

export function BuildingsTable() {
  const { data, isPending, isError, error } = useBuildings();
  return (
    <LibraryTable
      rows={data}
      isPending={isPending}
      isError={isError}
      error={error}
      columns={columns}
      rowKey={(r) => r.id}
    />
  );
}
