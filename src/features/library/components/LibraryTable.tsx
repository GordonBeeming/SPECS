import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  width?: string;
}

interface LibraryTableProps<T> {
  rows: T[] | undefined;
  isPending: boolean;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

export function LibraryTable<T>({
  rows,
  isPending,
  columns,
  rowKey,
  emptyMessage = "No rows.",
}: LibraryTableProps<T>) {
  if (isPending) {
    return <div className="p-3 text-sm text-fg-muted">Loading…</div>;
  }
  if (!rows || rows.length === 0) {
    return <div className="p-3 text-sm text-fg-muted">{emptyMessage}</div>;
  }
  return (
    <div className="overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-border/50 text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                className={`px-3 py-2 text-${c.align ?? "left"} font-medium`}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-border/30">
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={`px-3 py-2 text-${c.align ?? "left"} ${c.align === "right" ? "tabular-nums" : ""}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
