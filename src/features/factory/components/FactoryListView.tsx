import { useEffect, useState } from "react";
import { Factory as FactoryGlyph, Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";
import { useNavStore } from "@/shared/nav-store";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useDeleteFactory, useFactoryList } from "../hooks/useFactories";
import type { Factory } from "../types";
import { CreateFactoryModal } from "./CreateFactoryModal";
import { FactoryDetail } from "./FactoryDetail";

const LAST_FACTORY_KEY = (playthroughId: string) =>
  `specs:last-factory:${playthroughId}`;

export function FactoryListView() {
  const playthrough = useCurrentPlaythrough();
  const list = useFactoryList();
  const deleteMut = useDeleteFactory();
  const takePendingFactoryId = useNavStore((s) => s.takePendingFactoryId);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // On mount + whenever the list of factories settles, pick a default
  // selection so the right-hand pane isn't always the empty hint:
  //   1. A pending id set by HomeView's deep-link tile wins.
  //   2. Else, the last-selected factory id remembered in localStorage
  //      for this playthrough wins (only if it still exists).
  //   3. Else, leave the pane empty so the user picks.
  useEffect(() => {
    if (selected || !list.data || !playthrough.data) return;
    const pending = takePendingFactoryId();
    if (pending && list.data.some((f) => f.id === pending)) {
      setSelected(pending);
      return;
    }
    try {
      const remembered = localStorage.getItem(
        LAST_FACTORY_KEY(playthrough.data.id),
      );
      if (remembered && list.data.some((f) => f.id === remembered)) {
        setSelected(remembered);
      }
    } catch {
      // localStorage can throw (private mode, quota); ignore.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, playthrough.data?.id]);

  // Persist the selection so a refresh / app restart lands on the same
  // factory. Stored per playthrough so two playthroughs don't collide.
  useEffect(() => {
    if (!selected || !playthrough.data) return;
    try {
      localStorage.setItem(LAST_FACTORY_KEY(playthrough.data.id), selected);
    } catch {
      // ignore — same reasons as the read path above.
    }
  }, [selected, playthrough.data?.id]);

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
    <div className="grid h-full gap-4 lg:grid-cols-[20rem_1fr]">
      <Card className="flex flex-col gap-3 overflow-hidden">
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
              active={selected === f.id}
              onSelect={() => setSelected(f.id)}
              onDelete={() => {
                if (confirm(`Delete factory "${f.name}"? This removes all its machines.`)) {
                  deleteMut.mutate(f.id, {
                    onSuccess: () => {
                      if (selected === f.id) setSelected(null);
                    },
                  });
                }
              }}
            />
          )) ?? null}
        </ul>
      </Card>

      <Card className="flex flex-col overflow-hidden">
        {selected ? (
          <FactoryDetail factoryId={selected} />
        ) : (
          <div className="m-auto max-w-md text-center text-sm text-fg-muted">
            Select a factory on the left to inspect its machines and per-item
            ledger, or create a new one.
          </div>
        )}
      </Card>

      {showCreate && (
        <CreateFactoryModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => setSelected(id)}
        />
      )}
    </div>
  );
}

interface FactoryRowProps {
  factory: Factory;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function FactoryRow({ factory, active, onSelect, onDelete }: FactoryRowProps) {
  return (
    <li
      className={`flex items-center gap-1 rounded-md transition-colors ${
        active ? "bg-primary/10" : "hover:bg-border/40"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
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
        onClick={onDelete}
        aria-label={`Delete ${factory.name}`}
        className="mr-1 rounded-md p-1.5 text-fg-muted hover:bg-danger/20 hover:text-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
