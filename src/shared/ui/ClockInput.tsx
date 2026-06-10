import { useEffect, useState } from "react";

export interface ClockInputProps {
  value: number;
  onChange: (next: number) => void;
  /** Hide the slider where space is tight (loadout rows). */
  slider?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * Clock percent control: a whole-step slider for coarse scrubbing plus
 * a typed input where decimals are first-class — 100.01–250.00 in
 * 0.01 steps, which is exactly what the `clock_pct_x100` storage
 * represents. Precision work (101%, 150.5%) happens in the input;
 * dragging the slider snaps to whole numbers by design.
 */
export function ClockInput({
  value,
  onChange,
  slider = true,
  ariaLabel = "Clock percent",
  disabled,
}: ClockInputProps) {
  // The text field needs its own state while the user is mid-edit
  // ("10" on the way to "101.5" is out of range but must not snap).
  const [draft, setDraft] = useState<string>(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v >= 1 && v <= 250) {
      // Two decimals max — matches the on-disk precision.
      onChange(Math.round(v * 100) / 100);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {slider && (
        <input
          type="range"
          min={1}
          max={250}
          step={1}
          value={Math.round(value)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 w-full min-w-0 flex-1 accent-primary"
          aria-label={`${ariaLabel} slider`}
        />
      )}
      <input
        type="number"
        min={1}
        max={250}
        step={0.01}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 1 && v <= 250) {
            onChange(Math.round(v * 100) / 100);
          }
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const el = e.target as HTMLInputElement;
            commit(el.value);
            // Blur so "type 200, hit Enter" visibly takes effect.
            el.blur();
          }
        }}
        className="h-7 w-[4.5rem] shrink-0 rounded-md border border-border bg-bg px-1.5 text-[12px] tabular-nums text-fg outline-none focus:border-primary disabled:opacity-50"
        aria-label={ariaLabel}
      />
      <span className="text-[11px] text-fg-muted">%</span>
    </div>
  );
}
