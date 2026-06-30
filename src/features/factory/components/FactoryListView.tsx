import { useState } from "react";
import { ExternalLink, Factory as FactoryGlyph, Plus } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ConfirmDeleteButton } from "@/shared/ui/ConfirmDeleteButton";
import { Icon } from "@/shared/ui/Icon";
import { openPlanDesigner } from "@/shared/nav-store";
import { invoke } from "@/shared/tauri/invoke";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useDeleteFactory, useFactoryList } from "../hooks/useFactories";
import type { Factory } from "../types";
import { CreateFactoryModal } from "./CreateFactoryModal";

export function FactoryListView() {
  const playthrough = useCurrentPlaythrough();
  const list = useFactoryList();
  const deleteMut = useDeleteFactory();
  const [showCreate, setShowCreate] = useState(false);

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Factories</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to start building factories.
          Factory data lives inside the playthrough's `.specsdb` file.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <Card className="flex flex-1 flex-col gap-3 overflow-hidden">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-primary">Factories</h1>
            <p className="text-xs text-fg-muted">
              {playthrough.data.displayName} · T{playthrough.data.currentTier}
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} aria-label="New factory">
            <Plus className="h-4 w-4" />
            New
          </Button>
        </div>

        {list.isError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            Couldn't load factories
            {list.error instanceof Error ? `: ${list.error.message}` : null}
          </div>
        )}
        {list.isPending && (
          <div className="text-sm text-fg-muted">Loading…</div>
        )}
        {list.data && list.data.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            No factories yet. Click <strong>New</strong> to create the first one.
          </div>
        )}
        <ul className="flex flex-1 flex-col gap-1 overflow-auto">
          {list.data?.map((f) => (
            <FactoryRow
              key={f.id}
              factory={f}
              onOpen={() => openPlanDesigner(f.id)}
              onDelete={() => deleteMut.mutate(f.id)}
            />
          )) ?? null}
        </ul>
      </Card>

      {showCreate && (
        <CreateFactoryModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => openPlanDesigner(id, true)}
        />
      )}
    </div>
  );
}

interface FactoryRowProps {
  factory: Factory;
  onOpen: () => void;
  onDelete: () => void;
}

function FactoryRow({ factory, onOpen, onDelete }: FactoryRowProps) {
  return (
    <li className="flex items-center gap-1 rounded-md transition-colors hover:bg-border/40">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-left"
      >
        {factory.iconId ? (
          <Icon itemId={factory.iconId} alt="" className="h-5 w-5 shrink-0" />
        ) : (
          <FactoryGlyph className="h-4 w-4 shrink-0 text-fg-muted" />
        )}
        <span className="flex-1 truncate text-sm font-medium text-fg">{factory.name}</span>
        <span className="ml-2 text-xs text-fg-muted tabular-nums">
          {factory.machineCount} {factory.machineCount === 1 ? "machine" : "machines"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => void invoke("pop_out_factory", { factoryId: factory.id })}
        title={`Open ${factory.name} in its own window`}
        aria-label={`Pop out ${factory.name}`}
        className="rounded p-1.5 text-fg-muted hover:bg-border hover:text-fg"
      >
        <ExternalLink className="h-4 w-4" />
      </button>
      <span className="mr-1">
        <ConfirmDeleteButton onConfirm={onDelete} label={`Delete ${factory.name}`} />
      </span>
    </li>
  );
}
