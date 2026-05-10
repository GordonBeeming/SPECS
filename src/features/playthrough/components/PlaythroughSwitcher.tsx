import { useState } from "react";
import { ChevronDown, FolderOpen, Plus } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import {
  useCurrentPlaythrough,
  useOpenPlaythrough,
  usePlaythroughList,
} from "../hooks/usePlaythroughs";
import { CreatePlaythroughModal } from "./CreatePlaythroughModal";

export function PlaythroughSwitcher() {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const list = usePlaythroughList();
  const current = useCurrentPlaythrough();
  const openMut = useOpenPlaythrough();

  const label = current.data
    ? `${current.data.displayName} · T${current.data.currentTier}`
    : "No playthrough";

  return (
    <div className="relative">
      <Button
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <FolderOpen className="h-4 w-4" />
        <span className="max-w-[16rem] truncate">{label}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </Button>

      {open && (
        // Plain interactive popover — not a WAI-ARIA `menu` (which would
        // commit us to roving focus / arrow-key nav). `<button>` children
        // are still tab-focusable and announced with their own labels, which
        // is the keyboard story we actually want here.
        <div
          aria-label="Playthroughs"
          className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-border bg-bg-raised p-1 shadow-lg"
        >
          <div className="max-h-72 overflow-auto py-1">
            {list.isPending && (
              <div className="px-3 py-2 text-sm text-fg-muted">Loading…</div>
            )}
            {list.isError && (
              <div role="alert" className="px-3 py-2 text-sm text-danger">
                Couldn't load playthroughs.
              </div>
            )}
            {list.data && list.data.length === 0 && (
              <div className="px-3 py-2 text-sm text-fg-muted">
                No playthroughs yet.
              </div>
            )}
            {list.data?.map((p) => {
              const active = current.data?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    openMut.mutate(p.id, { onSuccess: () => setOpen(false) });
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    active ? "bg-primary text-white" : "text-fg hover:bg-border"
                  }`}
                >
                  <span className="truncate">{p.displayName}</span>
                  {active && <span className="text-xs opacity-80">active</span>}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border pt-1">
            <button
              type="button"
              onClick={() => {
                setShowCreate(true);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-border"
            >
              <Plus className="h-4 w-4" />
              New playthrough
            </button>
          </div>
        </div>
      )}

      {showCreate && <CreatePlaythroughModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
