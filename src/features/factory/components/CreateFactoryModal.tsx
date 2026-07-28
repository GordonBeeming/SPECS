import { useEffect, useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/Icon";
import { IconPicker } from "@/shared/ui/IconPicker";
import { useBuildings } from "@/features/library/hooks/useLibrary";
import { queryKeys } from "@/shared/query/keys";
import { factoryApi } from "../api";
import { useCreateFactory } from "../hooks/useFactories";

interface CreateFactoryModalProps {
  onClose: () => void;
  onCreated?: (id: string) => void;
}

/** A world coordinate typed into the position fields, or the sentinel
 * meaning "leave it unplaced" (both fields blank — the schema default,
 * same as before this field existed). Anything else that doesn't parse
 * to two finite numbers is a validation error, not a silent 0. */
type PositionInput = { x: number; y: number } | "unset" | "invalid";

function parsePosition(xRaw: string, yRaw: string): PositionInput {
  const x = xRaw.trim();
  const y = yRaw.trim();
  if (x === "" && y === "") return "unset";
  const nx = Number(x);
  const ny = Number(y);
  if (x === "" || y === "" || !Number.isFinite(nx) || !Number.isFinite(ny)) return "invalid";
  return { x: nx, y: ny };
}

export function CreateFactoryModal({ onClose, onCreated }: CreateFactoryModalProps) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [iconId, setIconId] = useState<string | null>(null);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [worldX, setWorldX] = useState("");
  const [worldY, setWorldY] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const create = useCreateFactory();
  const buildings = useBuildings();
  const queryClient = useQueryClient();

  // Default the suggested grid to all production building ids — those
  // are what a factory most naturally identifies with (Smelter, Refinery,
  // Manufacturer, …). Fall back to an empty list while buildings
  // are still loading so the picker doesn't flicker mid-render.
  const suggested = useMemo(
    () => (buildings.data ?? []).map((b) => b.id),
    [buildings.data],
  );

  const validate = (n: string): string | null => {
    const t = n.trim();
    if (t.length === 0) return "Name is required.";
    if (t.length > 80) return "Name must be 80 characters or fewer.";
    return null;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate(name);
    if (err) {
      setValidationError(err);
      return;
    }
    const position = parsePosition(worldX, worldY);
    if (position === "invalid") {
      setValidationError("Position needs both World X and World Y, or leave both blank.");
      return;
    }
    setValidationError(null);
    create.mutate(
      {
        name: name.trim(),
        notes: notes.trim() || undefined,
        iconId: iconId ?? undefined,
      },
      {
        onSuccess: (factory) => {
          // Every factory created here used to default to (0, 0) with no
          // way to say otherwise, so a second factory landed stacked
          // exactly on top of the first. Leaving both fields blank still
          // means unplaced (unchanged from before) — this only runs when
          // the user actually typed coordinates.
          const placed =
            position === "unset"
              ? Promise.resolve()
              : factoryApi
                  .setPosition({ id: factory.id, worldX: position.x, worldY: position.y })
                  .then(() => {
                    queryClient.invalidateQueries({ queryKey: queryKeys.factory.list });
                    queryClient.invalidateQueries({ queryKey: queryKeys.factory.detail(factory.id) });
                  })
                  .catch((err: unknown) => {
                    // The factory itself was created — losing the position
                    // write only leaves it unplaced until dragged on the
                    // map, which isn't worth blocking the modal on, but it
                    // must not vanish silently either.
                    console.error("Couldn't set the new factory's position:", err);
                  });
          void placed.finally(() => {
            onCreated?.(factory.id);
            onClose();
          });
        },
      },
    );
  };

  const serverError = create.error instanceof Error ? create.error.message : null;

  // Escape closes the innermost open layer first — the icon picker, if
  // it's expanded — then the modal itself, matching how a nested popover
  // is expected to unwind rather than jumping straight out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showIconPicker) setShowIconPicker(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showIconPicker, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-factory-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-md max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-xl">
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 id="create-factory-title" className="text-lg font-semibold text-fg">
            New factory
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The icon picker's grid can grow past the dialog's own height
            (max-h-[90vh]), so only this middle section scrolls — the
            header and the Create/Cancel footer stay put rather than
            scrolling out of view with it. */}
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
            <label className="block">
              <span className="text-sm font-medium text-fg">Name</span>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Iron Works, Mass Constructor 1, …"
                className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
                maxLength={80}
              />
            </label>

            <div>
              <span className="text-sm font-medium text-fg">Icon (optional)</span>
              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowIconPicker((v) => !v)}
                  className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-bg hover:border-primary"
                  aria-label="Pick an icon for this factory"
                >
                  {iconId ? (
                    <Icon itemId={iconId} alt="" className="h-9 w-9" />
                  ) : (
                    <span className="text-xs text-fg-muted">none</span>
                  )}
                </button>
                <p className="text-xs text-fg-muted">
                  {iconId
                    ? "Click to pick a different glyph."
                    : "Give this factory some character — pick from buildings, ingots, or any item."}
                </p>
              </div>
              {showIconPicker && (
                <div className="mt-3 rounded-md border border-border bg-bg p-3">
                  <IconPicker
                    value={iconId}
                    onChange={(next) => setIconId(next)}
                    suggested={suggested}
                  />
                </div>
              )}
            </div>

            <div>
              <span className="text-sm font-medium text-fg">Position on the map (optional)</span>
              <p className="mt-0.5 text-xs text-fg-muted">
                Leave both blank to place it later by dragging it on the map — otherwise every
                factory created from this list lands on the same spot and stacks under the last
                one.
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  value={worldX}
                  onChange={(e) => setWorldX(e.target.value)}
                  placeholder="World X"
                  aria-label="Factory world X coordinate"
                  className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
                />
                <input
                  type="number"
                  step="any"
                  value={worldY}
                  onChange={(e) => setWorldY(e.target.value)}
                  placeholder="World Y"
                  aria-label="Factory world Y coordinate"
                  className="h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
                />
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-fg">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary"
                placeholder="What does this factory do? Where does it live in-game?"
              />
            </label>

            {validationError && (
              <p role="alert" className="text-sm text-danger">{validationError}</p>
            )}
            {serverError && !validationError && (
              <p role="alert" className="text-sm text-danger">{serverError}</p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4 px-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
