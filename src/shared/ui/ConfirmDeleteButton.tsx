import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

interface ConfirmDeleteButtonProps {
  /** Called when the user clicks the armed (red) confirm button. */
  onConfirm: () => void;
  /** Short label shown on the armed state. Default: 'Confirm'. */
  confirmLabel?: string;
  /** Idle-state aria/title text. */
  label?: string;
  /** Auto-disarm after this many ms. Default 3000. */
  timeoutMs?: number;
  /** Disabled while a related mutation is in flight, etc. */
  disabled?: boolean;
}

/**
 * Tauri 2's webview suppresses `window.confirm()` so the dialog
 * never appears and the click silently no-ops. Replace every
 * `confirm() ? delete : noop` site with this two-click pattern:
 * first click arms (button turns red, label flips to 'Confirm'),
 * second click within `timeoutMs` fires the delete, otherwise it
 * auto-disarms.
 */
export function ConfirmDeleteButton({
  onConfirm,
  confirmLabel = "Confirm",
  label = "Delete",
  timeoutMs = 3000,
  disabled,
}: ConfirmDeleteButtonProps) {
  const [armed, setArmed] = useState(false);
  // Track the disarm timeout so re-arming or unmounting cancels the
  // pending callback. Without this, setArmed(false) can fire after
  // unmount (React 18 warns about state updates on unmounted
  // components) or stomp on a fresh arm if the user re-clicks within
  // the 3s window.
  const disarmTimerRef = useRef<number | null>(null);

  const clearDisarmTimer = () => {
    if (disarmTimerRef.current != null) {
      window.clearTimeout(disarmTimerRef.current);
      disarmTimerRef.current = null;
    }
  };

  useEffect(() => {
    return clearDisarmTimer;
  }, []);

  if (armed) {
    return (
      <button
        type="button"
        onClick={() => {
          clearDisarmTimer();
          onConfirm();
          setArmed(false);
        }}
        disabled={disabled}
        aria-label="Click to confirm delete"
        className="inline-flex items-center gap-1 rounded-md bg-danger px-2 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
        {confirmLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        clearDisarmTimer();
        setArmed(true);
        disarmTimerRef.current = window.setTimeout(() => {
          disarmTimerRef.current = null;
          setArmed(false);
        }, timeoutMs);
      }}
      disabled={disabled}
      aria-label={label}
      title={`${label} — click again to confirm`}
      className="rounded-md p-1.5 text-fg-muted hover:bg-danger/20 hover:text-danger disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}
