import { AlertTriangle } from "lucide-react";
import { useBeltTiers, usePipeTiers } from "../hooks/useLibrary";

interface ErrorBoxProps {
  what: string;
  error: unknown;
}
function ErrorBox({ what, error }: ErrorBoxProps) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Failed to load.";
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-medium">Couldn't load {what}.</div>
        <div className="text-xs opacity-80">{message}</div>
      </div>
    </div>
  );
}

export function TransportTable() {
  const belts = useBeltTiers();
  const pipes = usePipeTiers();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-muted uppercase tracking-wide">
          Conveyor belts (items / min)
        </h2>
        {belts.isError ? (
          <ErrorBox what="belt tiers" error={belts.error} />
        ) : belts.isPending ? (
          <div className="p-3 text-sm text-fg-muted">Loading…</div>
        ) : (
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
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-fg-muted uppercase tracking-wide">
          Pipelines (m³ / min)
        </h2>
        {pipes.isError ? (
          <ErrorBox what="pipe tiers" error={pipes.error} />
        ) : pipes.isPending ? (
          <div className="p-3 text-sm text-fg-muted">Loading…</div>
        ) : (
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
        )}
      </section>
    </div>
  );
}
