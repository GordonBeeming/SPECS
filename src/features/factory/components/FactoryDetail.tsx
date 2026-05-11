import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useFactoryDetail, useRemoveMachine } from "../hooks/useFactories";
import { useBuildings, useItems, useRecipes } from "@/features/library/hooks/useLibrary";
import { AddMachineForm } from "./AddMachineForm";
import { FactoryLedgerTable } from "./FactoryLedgerTable";
import type { FactoryMachine } from "../types";
import { ampSlotsForBuilding } from "../ampRules";

function formatAmpSummary(m: FactoryMachine): string {
  const parts: string[] = [];
  if (m.useSomersloop && m.somersloopSlotsFilled > 0) {
    parts.push(`${m.somersloopSlotsFilled}/${ampSlotsForBuilding(m.buildingId)} S`);
  }
  if (m.powerShardCount > 0) {
    parts.push(`${m.powerShardCount}× PS`);
  }
  return parts.length === 0 ? "—" : parts.join(" · ");
}

interface FactoryDetailProps {
  factoryId: string;
}

export function FactoryDetail({ factoryId }: FactoryDetailProps) {
  const detail = useFactoryDetail(factoryId);
  const items = useItems();
  const recipes = useRecipes();
  const buildings = useBuildings();
  const removeMachine = useRemoveMachine(factoryId);
  const [showAdd, setShowAdd] = useState(false);

  if (detail.isError) {
    return (
      <div role="alert" className="m-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
        Couldn't load this factory
        {detail.error instanceof Error ? `: ${detail.error.message}` : null}
      </div>
    );
  }
  if (detail.isPending || !detail.data) {
    return <div className="m-3 text-sm text-fg-muted">Loading factory…</div>;
  }

  const { factory, machines, ledger } = detail.data;
  const buildingNames = new Map(buildings.data?.map((b) => [b.id, b.name]) ?? []);
  const recipeNames = new Map(recipes.data?.map((r) => [r.id, r.name]) ?? []);
  const itemNames = new Map(items.data?.map((i) => [i.id, i.name]) ?? []);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-fg">{factory.name}</h2>
          {factory.notes && <p className="mt-1 text-sm text-fg-muted">{factory.notes}</p>}
        </div>
        <div className="text-right text-xs text-fg-muted tabular-nums">
          {machines.length} {machines.length === 1 ? "machine" : "machines"} · {ledger.powerMw.toFixed(1)}&nbsp;MW
        </div>
      </header>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Machines</h3>
          <Button onClick={() => setShowAdd((v) => !v)} variant={showAdd ? "ghost" : "primary"}>
            {showAdd ? "Cancel" : "Add machine"}
          </Button>
        </div>
        {showAdd && (
          <div className="mb-3">
            <AddMachineForm factoryId={factoryId} onSubmitted={() => setShowAdd(false)} />
          </div>
        )}
        {machines.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            No machines yet. Click <strong>Add machine</strong> to wire up a recipe.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-border/50 text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Recipe</th>
                  <th className="px-3 py-2 text-left font-medium">Building</th>
                  <th className="px-3 py-2 text-right font-medium">Count</th>
                  <th className="px-3 py-2 text-right font-medium">Clock</th>
                  <th className="px-3 py-2 text-right font-medium">Amp</th>
                  <th className="px-3 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {machines.map((m) => (
                  <tr key={m.id} className="hover:bg-border/30">
                    <td className="px-3 py-2">{recipeNames.get(m.recipeId) ?? m.recipeId}</td>
                    <td className="px-3 py-2 text-fg-muted">{buildingNames.get(m.buildingId) ?? m.buildingId}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.clockPct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right text-xs text-fg-muted tabular-nums">
                      {formatAmpSummary(m)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Remove this ${recipeNames.get(m.recipeId) ?? "machine"} row?`)) {
                            removeMachine.mutate(m.id);
                          }
                        }}
                        aria-label="Remove machine"
                        className="rounded-md p-1.5 text-fg-muted hover:bg-danger/20 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg-muted uppercase tracking-wide">
          Per-item ledger (items / min)
        </h3>
        <FactoryLedgerTable ledger={ledger} itemNames={itemNames} />
      </section>
    </div>
  );
}
