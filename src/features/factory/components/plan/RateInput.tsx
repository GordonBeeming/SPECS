import { useEffect, useState } from "react";

export interface RateInputProps {
  /** The committed rate. Shown whenever the field isn't being typed in. */
  value: number;
  /** Fires as soon as the typed text is a usable rate. */
  onCommit: (next: number) => void;
  ariaLabel: string;
  /** Lets a submitting parent refuse and explain instead of no-opping. */
  onInvalidChange?: (invalid: boolean) => void;
  /** Zero is a real rate for an export slice ("offer nothing"), never
   * for a production target. */
  allowZero?: boolean;
  /**
   * Live-edit fields snap back to the committed value on blur so the
   * field can't show something the plan doesn't hold. A field inside a
   * form wants the opposite: clicking the submit button blurs the input
   * first, and reverting there would submit the old value behind the
   * user's back instead of refusing the one they typed.
   */
  revertOnBlur?: boolean;
  className?: string;
  autoFocus?: boolean;
  title?: string;
}

/** Empty, half-typed (`2.`), or non-numeric text isn't a rate yet. */
function parseRate(draft: string, allowZero: boolean): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  if (allowZero ? parsed < 0 : parsed <= 0) return null;
  return parsed;
}

/**
 * A rate field that accepts fractions and says so when it can't.
 *
 * Satisfactory rates are routinely fractional — Computer 2.5/min, Motor
 * 2.5/min — so `step="any"` is the only correct step here. `step="1"`
 * doesn't just annoy the spinner: inside a form it fails native
 * constraint validation, and the browser cancels the submit before any
 * handler runs, so the dialog silently refuses to close with nothing
 * on screen to explain why.
 *
 * The draft is held locally so half-typed text survives a re-render,
 * and a value that never becomes usable reverts on blur rather than
 * leaving the field showing something the plan doesn't hold.
 */
export function RateInput({
  value,
  onCommit,
  ariaLabel,
  onInvalidChange,
  allowZero = false,
  revertOnBlur = true,
  className,
  autoFocus,
  title,
}: RateInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseRate(draft, allowZero) === null;

  useEffect(() => {
    onInvalidChange?.(invalid);
  }, [invalid, onInvalidChange]);

  return (
    <input
      type="number"
      // min is the stepping base for native spinners — 0.1 made a
      // down-arrow from 3 land on 2.1. With base 0 the arrows step in
      // whole numbers while `step="any"` keeps decimals typeable.
      min={0}
      step="any"
      autoFocus={autoFocus}
      title={title}
      value={draft ?? value}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseRate(e.target.value, allowZero);
        if (parsed !== null) onCommit(parsed);
      }}
      onBlur={() => {
        if (revertOnBlur || !invalid) setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !invalid) (e.target as HTMLInputElement).blur();
      }}
      className={`${className ?? ""} ${invalid ? "border-danger" : ""}`.trim()}
    />
  );
}
