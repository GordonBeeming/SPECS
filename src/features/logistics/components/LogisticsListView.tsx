import { useMemo, useState } from "react";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";

import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useItems } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

import { useDeleteLogisticsLink, useLogisticsLinks } from "../hooks/useLogistics";
import type { LogisticsLink } from "../types";
import { LogisticsLinkEditor } from "./LogisticsLinkEditor";

export function LogisticsListView() {
  const playthrough = useCurrentPlaythrough();
  const list = useLogisticsLinks();
  const factories = useFactoryList();
  const items = useItems();
  const deleteMut = useDeleteLogisticsLink();

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<LogisticsLink | null>(null);

  const factoryName = useMemo(() => {
    const map = new Map<string, string>();
    (factories.data ?? []).forEach((f) => map.set(f.id, f.name));
    return (id: string) => map.get(id) ?? id;
  }, [factories.data]);

  const itemName = useMemo(() => {
    const map = new Map<string, string>();
    (items.data ?? []).forEach((i) => map.set(i.id, i.name));
    return (id: string) => map.get(id) ?? id;
  }, [items.data]);

  const itemIsFluid = useMemo(() => {
    const map = new Map<string, boolean>();
    (items.data ?? []).forEach((i) => map.set(i.id, i.isFluid));
    return (id: string) => map.get(id) ?? false;
  }, [items.data]);

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Logistics</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to start wiring
          factories together. Logistics links live inside the
          playthrough's `.specsdb` file.
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
            <h1 className="text-lg font-semibold text-primary">Logistics</h1>
            <p className="text-xs text-fg-muted">
              {playthrough.data.displayName} · T{playthrough.data.currentTier}
            </p>
          </div>
          <Button
            onClick={() => setShowCreate(true)}
            disabled={!canCreate}
            aria-label="New logistics link"
            title={canCreate ? undefined : "Create at least two factories before linking them"}
          >
            <Plus className="h-4 w-4" />
            New link
          </Button>
        </div>

        {list.isError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            Couldn't load logistics links
            {list.error instanceof Error ? `: ${list.error.message}` : null}
          </div>
        )}
        {list.isPending && <div className="text-sm text-fg-muted">Loading…</div>}
        {list.data && list.data.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            {canCreate
              ? <>No links yet. Click <strong>New link</strong> to wire two factories together.</>
              : <>You'll need at least two factories before you can link them. Visit <strong>Factories</strong> to add some.</>}
          </div>
        )}
        {list.data && list.data.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {list.data.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                fromName={factoryName(link.fromFactoryId)}
                toName={factoryName(link.toFactoryId)}
                itemLabel={itemName(link.itemId)}
                isFluid={itemIsFluid(link.itemId)}
                onEdit={() => setEditing(link)}
                onDelete={() => {
                  if (
                    confirm(
                      `Delete link ${factoryName(link.fromFactoryId)} → ${factoryName(link.toFactoryId)}?`,
                    )
                  ) {
                    deleteMut.mutate(link.id);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      {showCreate && (
        <LogisticsLinkEditor
          onClose={() => setShowCreate(false)}
          onSaved={() => setShowCreate(false)}
        />
      )}
      {editing && (
        <LogisticsLinkEditor
          link={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface LinkRowProps {
  link: LogisticsLink;
  fromName: string;
  toName: string;
  itemLabel: string;
  isFluid: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function LinkRow({ link, fromName, toName, itemLabel, isFluid, onEdit, onDelete }: LinkRowProps) {
  // Fluids ride pipes and the planner reports m³/min for them — match that
  // unit in the row so the editor / picker / list all speak the same units.
  const unit = isFluid ? "m³/min" : "ipm";
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <span className="truncate">{fromName}</span>
          <ArrowRight className="h-3.5 w-3.5 text-fg-muted" aria-hidden />
          <span className="truncate">{toName}</span>
        </div>
        <div className="mt-0.5 text-xs text-fg-muted tabular-nums">
          {link.itemsPerMinute.toFixed(2)} {unit} · {itemLabel} · {link.transportKind}
          {link.distanceM != null ? ` · ${link.distanceM} m` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit link ${fromName} to ${toName}`}
        className="rounded-md p-1.5 text-fg-muted hover:bg-border/40 hover:text-fg"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete link ${fromName} to ${toName}`}
        className="rounded-md p-1.5 text-fg-muted hover:bg-danger/20 hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
