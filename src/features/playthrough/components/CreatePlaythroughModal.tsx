import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useCreatePlaythrough } from "../hooks/usePlaythroughs";

interface CreatePlaythroughModalProps {
  onClose: () => void;
  onCreated?: () => void;
}

export function CreatePlaythroughModal({ onClose, onCreated }: CreatePlaythroughModalProps) {
  const [displayName, setDisplayName] = useState("");
  const [startingTier, setStartingTier] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const create = useCreatePlaythrough();

  const validate = (name: string, tier: number): string | null => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return "Name is required.";
    if (trimmed.length > 80) return "Name must be 80 characters or fewer.";
    if (tier < 0 || tier > 9) return "Starting tier must be between 0 and 9.";
    return null;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate(displayName, startingTier);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    create.mutate(
      { displayName: displayName.trim(), startingTier },
      {
        onSuccess: () => {
          onCreated?.();
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
      aria-labelledby="create-playthrough-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-raised p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="create-playthrough-title" className="text-lg font-semibold text-fg">
            New playthrough
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
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Iron Run, Tier 9 push, …"
              className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary"
              maxLength={80}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-fg">Starting tier</span>
            <select
              value={startingTier}
              onChange={(e) => setStartingTier(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary"
            >
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i} value={i}>
                  Tier {i}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-fg-muted">
              Pick the tier you've reached in-game. Library entries above this
              tier will be marked as locked.
            </p>
          </label>

          {validationError && (
            <p role="alert" className="text-sm text-danger">
              {validationError}
            </p>
          )}
          {serverError && !validationError && (
            <p role="alert" className="text-sm text-danger">
              {serverError}
            </p>
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
