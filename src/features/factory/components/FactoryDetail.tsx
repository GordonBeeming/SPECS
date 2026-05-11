import { useMemo, useState } from "react";
import { Factory as FactoryGlyph, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/Icon";
import { IconPicker } from "@/shared/ui/IconPicker";
import {
  useFactoryDetail,
  useMachineLayouts,
  useSetFactoryIcon,
} from "../hooks/useFactories";
import { useBuildings, useItems, useRecipes } from "@/features/library/hooks/useLibrary";
import { AddMachineForm } from "./AddMachineForm";
import { FactoryGraphView } from "./FactoryGraphView";
import { FactoryLedgerTable } from "./FactoryLedgerTable";

interface FactoryDetailProps {
  factoryId: string;
}

export function FactoryDetail({ factoryId }: FactoryDetailProps) {
  const detail = useFactoryDetail(factoryId);
  const items = useItems();
  const recipes = useRecipes();
  const buildings = useBuildings();
  const layouts = useMachineLayouts(factoryId);
  const setIcon = useSetFactoryIcon();
  const [showAdd, setShowAdd] = useState(false);
  const [editingIcon, setEditingIcon] = useState(false);

  // Memoise the lookup Maps + layout Map BEFORE any early return so
  // the hook count stays constant across renders (Rules of Hooks).
  // Stable identity also breaks the FactoryGraphView setNodes ↔
  // useEffect loop that surfaced as "Maximum update depth exceeded"
  // inside ReactFlow's Wrapper.
  const buildingNames = useMemo(
    () => new Map(buildings.data?.map((b) => [b.id, b.name]) ?? []),
    [buildings.data],
  );
  const recipeNames = useMemo(
    () => new Map(recipes.data?.map((r) => [r.id, r.name]) ?? []),
    [recipes.data],
  );
  const itemNames = useMemo(
    () => new Map(items.data?.map((i) => [i.id, i.name]) ?? []),
    [items.data],
  );
  const layoutMap = useMemo(
    () =>
      new Map(
        (layouts.data ?? []).map((l) => [l.machineId, { x: l.x, y: l.y }] as const),
      ),
    [layouts.data],
  );

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

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditingIcon((v) => !v)}
            aria-label="Change factory icon"
            className="group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-raised hover:border-primary"
          >
            {factory.iconId ? (
              <Icon itemId={factory.iconId} alt="" className="h-9 w-9" />
            ) : (
              <FactoryGlyph className="h-6 w-6 text-fg-muted" />
            )}
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Pencil className="h-2.5 w-2.5" />
            </span>
          </button>
          <div>
            <h2 className="text-xl font-semibold text-fg">{factory.name}</h2>
            {factory.notes && <p className="mt-1 text-sm text-fg-muted">{factory.notes}</p>}
          </div>
        </div>
        <div className="text-right text-xs text-fg-muted tabular-nums">
          {machines.length} {machines.length === 1 ? "machine" : "machines"} · {ledger.powerMw.toFixed(1)}&nbsp;MW
        </div>
      </header>

      {editingIcon && (
        <section className="rounded-md border border-border bg-bg-raised p-3">
          <IconPicker
            value={factory.iconId ?? null}
            suggested={(buildings.data ?? []).map((b) => b.id)}
            onChange={(next) => {
              setIcon.mutate(
                { id: factory.id, iconId: next },
                { onSuccess: () => setEditingIcon(false) },
              );
            }}
          />
        </section>
      )}

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
          <FactoryGraphView
            factoryId={factoryId}
            machines={machines}
            buildingNames={buildingNames}
            recipeNames={recipeNames}
            layouts={layoutMap}
          />
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
