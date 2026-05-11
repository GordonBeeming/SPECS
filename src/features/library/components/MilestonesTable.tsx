import { useMilestones } from "../hooks/useLibrary";
import type { Milestone } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";
import { TierBadge } from "./TierBadge";

const columns: Column<Milestone>[] = [
  { header: "Tier", cell: (m) => <TierBadge unlockTier={m.tier} />, align: "right", width: "10rem" },
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
  const { data, isPending, isError, error } = useMilestones();
  const rows = data
    ? [...data].sort((a, b) =>
        a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier - b.tier,
      )
    : undefined;
  return (
    <LibraryTable
      rows={rows}
      isPending={isPending}
      isError={isError}
      error={error}
      columns={columns}
      rowKey={(r) => r.id}
      groupKey={(r) => `Tier ${r.tier}`}
    />
  );
}
