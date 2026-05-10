import { useItems } from "../hooks/useLibrary";
import type { Item } from "../types";
import { LibraryTable, type Column } from "./LibraryTable";

const columns: Column<Item>[] = [
  { header: "Name", cell: (i) => i.name },
  { header: "Category", cell: (i) => i.category },
  { header: "Stack", cell: (i) => (i.isFluid ? "—" : i.stackSize.toLocaleString()), align: "right" },
  { header: "Type", cell: (i) => (i.isFluid ? "Fluid" : "Solid") },
  { header: "ID", cell: (i) => <code className="text-xs text-fg-muted">{i.id}</code> },
];

export function ItemsTable() {
  const { data, isPending } = useItems();
  return (
    <LibraryTable rows={data} isPending={isPending} columns={columns} rowKey={(r) => r.id} />
  );
}
