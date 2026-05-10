import { useBeltTiers, usePipeTiers } from "../hooks/useLibrary";

export function TransportTable() {
  const belts = useBeltTiers();
  const pipes = usePipeTiers();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-muted uppercase tracking-wide">
          Conveyor belts (items / min)
        </h2>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-border/50 text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Mark</th>
                <th className="px-3 py-2 text-right font-medium">Throughput</th>
                <th className="px-3 py-2 text-right font-medium">Unlocks at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {belts.data?.map((b) => (
                <tr key={b.mark} className="hover:bg-border/30">
                  <td className="px-3 py-2">Mk.{b.mark}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {b.itemsPerMinute.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">Tier {b.unlockTier}</td>
                </tr>
              )) ?? null}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-muted uppercase tracking-wide">
          Pipelines (m³ / min)
        </h2>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-border/50 text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Mark</th>
                <th className="px-3 py-2 text-right font-medium">Throughput</th>
                <th className="px-3 py-2 text-right font-medium">Unlocks at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pipes.data?.map((p) => (
                <tr key={p.mark} className="hover:bg-border/30">
                  <td className="px-3 py-2">Mk.{p.mark}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.cubicMetersPerMinute.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">Tier {p.unlockTier}</td>
                </tr>
              )) ?? null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
