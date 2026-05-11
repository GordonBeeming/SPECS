import { useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/Icon";
import { IconPicker } from "@/shared/ui/IconPicker";
import { useBuildings } from "@/features/library/hooks/useLibrary";
import { useCreateFactory } from "../hooks/useFactories";

interface CreateFactoryModalProps {
  onClose: () => void;
  onCreated?: (id: string) => void;
}

export function CreateFactoryModal({ onClose, onCreated }: CreateFactoryModalProps) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [iconId, setIconId] = useState<string | null>(null);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const create = useCreateFactory();
  const buildings = useBuildings();

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
    setValidationError(null);
    create.mutate(
      {
        name: name.trim(),
        notes: notes.trim() || undefined,
        iconId: iconId ?? undefined,
      },
      {
        onSuccess: (factory) => {
          onCreated?.(factory.id);
          onClose();
        },
      },
    );
  };

  const serverError = create.error instanceof Error ? create.error.message : null;

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
      <div className="w-full max-w-md max-h-[90vh] overflow-auto rounded-lg border border-border bg-bg-raised p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
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

        <form onSubmit={onSubmit} className="space-y-4">
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

          <div className="flex justify-end gap-2 pt-2">
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
