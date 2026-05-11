import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  width?: string;
}

interface LibraryTableProps<T> {
  rows: T[] | undefined;
  isPending: boolean;
  isError?: boolean;
  error?: unknown;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
}

// Literal Tailwind classes — string-interpolating utilities like `text-${align}`
// would defeat Tailwind's class extraction and silently drop the alignment.
const ALIGN_TH: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
};
const ALIGN_TD: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right tabular-nums",
};

export function LibraryTable<T>({
  rows,
  isPending,
  isError,
  error,
  columns,
  rowKey,
  emptyMessage = "No rows.",
}: LibraryTableProps<T>) {
  if (isError) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Failed to load.";
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-medium">Couldn't load this view.</div>
          <div className="text-xs opacity-80">{message}</div>
        </div>
      </div>
    );
  }
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
                // `whitespace-nowrap` keeps short column headers on one
                // line ("Cycle (s)", "Unlocks at") rather than wrapping
                // mid-word in narrow viewports. Long-text columns
                // (Inputs / Outputs) wrap their cell content but the
                // header stays as one line.
                className={`px-3 py-2 whitespace-nowrap ${ALIGN_TH[c.align ?? "left"]} font-medium`}
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
                  className={`px-3 py-2 ${ALIGN_TD[c.align ?? "left"]}`}
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
