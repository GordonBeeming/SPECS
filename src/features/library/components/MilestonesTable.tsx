import { useMilestones } from "../hooks/useLibrary";
import type { Milestone } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";

const columns: Column<Milestone>[] = [
  { header: "Tier", cell: (m) => m.tier, align: "right", width: "5rem" },
  { header: "Name", cell: (m) => m.name },
  {
    header: "Unlocks",
    cell: (m) =>
      m.unlocks.length === 0 ? (
        <span className="text-fg-muted">—</span>
      ) : (
        <code className="text-xs text-fg-muted">{m.unlocks.join(", ")}</code>
      ),
  },
];

export function MilestonesTable() {
  const { data, isPending } = useMilestones();
  return (
    <LibraryTable rows={data} isPending={isPending} columns={columns} rowKey={(r) => r.id} />
  );
}
