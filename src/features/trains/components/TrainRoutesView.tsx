import { useMemo, useState } from "react";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";

import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

import {
  useDeleteTrainRoute,
  useTrainRoute,
  useTrainRoutes,
} from "../hooks/useTrains";
import type { TrainRoute } from "../types";
import { TrainRouteEditor } from "./TrainRouteEditor";

export function TrainRoutesView() {
  const playthrough = useCurrentPlaythrough();
  const list = useTrainRoutes();
  const factories = useFactoryList();
  const deleteMut = useDeleteTrainRoute();

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = useTrainRoute(editingId);

  const factoryName = useMemo(() => {
    const map = new Map<string, string>();
    (factories.data ?? []).forEach((f) => map.set(f.id, f.name));
    return (id: string) => map.get(id) ?? id;
  }, [factories.data]);

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Train routes</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to plan train routes.
        </p>
      </Card>
    );
  }

  const canCreate = (factories.data?.length ?? 0) >= 2;

  return (
    <div className="flex h-full flex-col gap-4">
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-primary">Train routes</h1>
            <p className="text-xs text-fg-muted">
              {playthrough.data.displayName} · T{playthrough.data.currentTier}
            </p>
          </div>
          <Button
            onClick={() => setShowCreate(true)}
            disabled={!canCreate}
            aria-label="New train route"
            title={canCreate ? undefined : "Create at least two factories before planning a route"}
          >
            <Plus className="h-4 w-4" />
            New route
          </Button>
        </div>

        {list.isError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            Couldn't load train routes
            {list.error instanceof Error ? `: ${list.error.message}` : null}
          </div>
        )}
        {list.isPending && <div className="text-sm text-fg-muted">Loading…</div>}
        {list.data && list.data.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            {canCreate
              ? <>No routes yet. Click <strong>New route</strong> to plan a shared train.</>
              : <>You'll need at least two factories before planning a route. Visit <strong>Factories</strong> to add some.</>}
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {list.data.map((route) => (
              <RouteRow
                key={route.id}
                route={route}
                onEdit={() => setEditingId(route.id)}
                onDelete={() => {
                  if (confirm(`Delete route "${route.name}"? This detaches any links carried by it.`)) {
                    deleteMut.mutate(route.id);
                  }
                }}
                factoryName={factoryName}
              />
            ))}
          </ul>
        )}
      </Card>

      {showCreate && (
        <TrainRouteEditor
          onClose={() => setShowCreate(false)}
          onSaved={() => setShowCreate(false)}
        />
      )}
      {editingId && editing.data && (
        <TrainRouteEditor
          detail={editing.data}
          onClose={() => setEditingId(null)}
          onSaved={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

interface RouteRowProps {
  route: TrainRoute;
  onEdit: () => void;
  onDelete: () => void;
  factoryName: (id: string) => string;
}

function RouteRow({ route, onEdit, onDelete }: RouteRowProps) {
  const cycleLabel =
    route.estCycleSeconds != null
      ? `${(route.estCycleSeconds / 60).toFixed(1)} min cycle`
      : "no estimate yet";
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <span className="truncate">{route.name}</span>
          <ArrowRight className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
        </div>
        <div className="mt-0.5 text-xs text-fg-muted tabular-nums">
          {route.freightCars} freight · {route.fluidCars} fluid · {cycleLabel}
          {route.totalDistanceM != null ? ` · ${route.totalDistanceM} m` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${route.name}`}
        className="rounded-md p-1.5 text-fg-muted hover:bg-border/40 hover:text-fg"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${route.name}`}
        className="rounded-md p-1.5 text-fg-muted hover:bg-danger/20 hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
