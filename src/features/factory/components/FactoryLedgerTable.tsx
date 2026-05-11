import { Icon } from "@/shared/ui/Icon";
import type { FactoryLedger } from "../types";

interface FactoryLedgerTableProps {
  ledger: FactoryLedger;
  itemNames: Map<string, string>;
}

export function FactoryLedgerTable({ ledger, itemNames }: FactoryLedgerTableProps) {
  if (ledger.flows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
        No flows yet. Add a machine above and the per-item ledger will appear here.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-border/50 text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Item</th>
            <th className="px-3 py-2 text-right font-medium">Produced</th>
            <th className="px-3 py-2 text-right font-medium">Consumed</th>
            <th className="px-3 py-2 text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ledger.flows.map((flow) => {
            const name = flow.itemName || itemNames.get(flow.itemId) || flow.itemId;
            const surplus = flow.netPerMinute > 0.001;
            const deficit = flow.netPerMinute < -0.001;
            return (
              <tr key={flow.itemId} className="hover:bg-border/30">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <Icon itemId={flow.itemId} alt={name} className="h-5 w-5" />
                    {name}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {flow.producedPerMinute > 0 ? flow.producedPerMinute.toFixed(1) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {flow.consumedPerMinute > 0 ? flow.consumedPerMinute.toFixed(1) : "—"}
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums font-medium ${
                    surplus ? "text-success" : deficit ? "text-danger" : "text-fg-muted"
                  }`}
                >
                  {flow.netPerMinute > 0 ? "+" : ""}
                  {flow.netPerMinute.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
