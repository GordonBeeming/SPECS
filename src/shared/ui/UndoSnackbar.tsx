import { useEffect, useRef } from "react";

interface UndoSnackbarProps {
  /** What just happened, past tense — "Recipes re-optimized." */
  message: string;
  onUndo: () => void;
  /** Called when the window closes on its own. */
  onDismiss: () => void;
  /** Positioning, since the same snackbar rides a full-screen view and
   * a card. Defaults to fixed bottom-centre. */
  className?: string;
}

/** Long enough to read the message and reach for Undo, short enough that
 * it isn't sitting over the screen while the player works. */
const UNDO_WINDOW_MS = 8000;

/**
 * "X happened. Undo" — the guard rail that rides a destructive action
 * once it has already been carried out.
 *
 * Shared rather than written per screen because the window length is the
 * promise being made: an action offering four seconds of undo and one
 * offering twelve are different deals, and two copies of the timer drift
 * apart without anyone noticing.
 *
 * The window starts on mount, so a second action while one of these is
 * still up needs a fresh `key` to get its own full window rather than
 * inheriting the remains of the last.
 */
export function UndoSnackbar({
  message,
  onUndo,
  onDismiss,
  className = "fixed bottom-4 left-1/2 z-40 -translate-x-1/2",
}: UndoSnackbarProps) {
  // The caller's handler is usually an inline arrow, so depending on it
  // directly would restart the window on every unrelated re-render and
  // leave the snackbar up indefinitely on a busy screen.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const t = window.setTimeout(() => dismissRef.current(), UNDO_WINDOW_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-lg border border-border bg-bg-raised px-4 py-2.5 text-sm shadow-xl ${className}`}
    >
      <span className="text-fg">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        Undo
      </button>
    </div>
  );
}
