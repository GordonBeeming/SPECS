import { useState } from "react";
import { ChevronDown, FolderOpen, Gauge, Plus, Share2, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import {
  useCurrentPlaythrough,
  useDeletePlaythrough,
  useOpenPlaythrough,
  usePlaythroughList,
  useSetCurrentTier,
} from "../hooks/usePlaythroughs";
import { AmplifierInventoryPanel } from "./AmplifierInventoryPanel";
import { CreatePlaythroughModal } from "./CreatePlaythroughModal";
import { ExportImportModal } from "./ExportImportModal";

// Satisfactory ships ten milestone tiers (0–9). The progress slice
// validates the same range Rust-side; the dropdown surfaces the full
// list so a player switching milestones doesn't need a separate panel.
const TIERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export function PlaythroughSwitcher() {
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showAmplifier, setShowAmplifier] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const list = usePlaythroughList();
  const current = useCurrentPlaythrough();
  const openMut = useOpenPlaythrough();
  const setTierMut = useSetCurrentTier();
  const deleteMut = useDeletePlaythrough();

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
          className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-border bg-bg-raised p-1 shadow-lg"
        >
          {current.data && (
            <div className="border-b border-border px-3 py-2">
              <label className="flex items-center justify-between gap-2 text-xs text-fg-muted">
                <span>Current tier</span>
                <select
                  aria-label="Current tier"
                  value={current.data.currentTier}
                  disabled={setTierMut.isPending}
                  onChange={(e) => setTierMut.mutate(Number(e.target.value))}
                  className="h-7 rounded border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary disabled:opacity-50"
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      Tier {t}
                    </option>
                  ))}
                </select>
              </label>
              {setTierMut.isError && (
                <div role="alert" className="mt-1 text-xs text-danger">
                  Couldn't change tier:{" "}
                  {setTierMut.error instanceof Error
                    ? setTierMut.error.message
                    : String(setTierMut.error)}
                </div>
              )}
            </div>
          )}
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
              const isConfirming = confirmDeleteId === p.id;
              return (
                <div
                  key={p.id}
                  className={`group flex items-center gap-1 rounded-md transition-colors ${
                    active ? "bg-primary text-white" : "text-fg hover:bg-border"
                  }`}
                >
                  <button
                    type="button"
                    disabled={openMut.isPending}
                    onClick={() => {
                      openMut.mutate(p.id, { onSuccess: () => setOpen(false) });
                    }}
                    className="flex flex-1 items-center justify-between px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="truncate">{p.displayName}</span>
                    {active && <span className="text-xs opacity-80">active</span>}
                  </button>
                  {isConfirming ? (
                    // Two-step confirm: replaces the trash glyph with explicit
                    // "Delete" / "Cancel" so a stray hover-click can't drop a
                    // playthrough silently.
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        type="button"
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          deleteMut.mutate(p.id, {
                            onSuccess: () => {
                              setConfirmDeleteId(null);
                            },
                          });
                        }}
                        className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                        aria-label={`Confirm delete ${p.displayName}`}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-fg hover:bg-bg"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(p.id);
                      }}
                      aria-label={`Delete ${p.displayName}`}
                      className={`mr-1 rounded p-1 opacity-0 transition-opacity hover:bg-danger/20 hover:text-danger group-hover:opacity-100 focus:opacity-100 ${
                        active ? "text-white" : "text-fg-muted"
                      }`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            {openMut.isError && (
              // Silent failures here are how a broken playthrough (e.g.
              // refinery checksum divergence after a migration was edited
              // in place) looked like "clicks do nothing" — surface it so
              // the user sees what actually happened.
              <div
                role="alert"
                className="mx-1 mt-1 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
              >
                Couldn't open playthrough:{" "}
                {openMut.error instanceof Error
                  ? openMut.error.message
                  : String(openMut.error)}
              </div>
            )}
            {deleteMut.isError && (
              <div
                role="alert"
                className="mx-1 mt-1 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
              >
                Couldn't delete:{" "}
                {deleteMut.error instanceof Error
                  ? deleteMut.error.message
                  : String(deleteMut.error)}
              </div>
            )}
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
            <button
              type="button"
              onClick={() => {
                setShowShare(true);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-border"
            >
              <Share2 className="h-4 w-4" />
              Share / Import…
            </button>
            {current.data && (
              <button
                type="button"
                onClick={() => {
                  setShowAmplifier(true);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg hover:bg-border"
              >
                <Gauge className="h-4 w-4" />
                Amplifier supply…
              </button>
            )}
          </div>
        </div>
      )}

      {showCreate && <CreatePlaythroughModal onClose={() => setShowCreate(false)} />}
      {showShare && <ExportImportModal onClose={() => setShowShare(false)} />}
      {showAmplifier && (
        <AmplifierInventoryPanel onClose={() => setShowAmplifier(false)} />
      )}
    </div>
  );
}
