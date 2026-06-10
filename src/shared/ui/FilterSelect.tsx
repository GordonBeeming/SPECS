import { useMemo, useRef, useState } from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown, X } from "lucide-react";
import { Icon } from "./Icon";

export interface FilterOption {
  value: string;
  label: string;
  /** Optional secondary text rendered to the right of the label. */
  hint?: string;
  /**
   * Optional game-data icon id (`Desc_*_C` / `Build_*_C`). When set, the
   * row shows the matching satisfactorytools icon next to the label.
   */
  iconId?: string;
  /**
   * Optional group label — rows sharing the same `group` are rendered
   * together under a sticky header. Caller is responsible for ordering
   * the options (the dropdown renders them in the order provided).
   * Empty / undefined groups render without a header.
   */
  group?: string;
  /**
   * Recipe-style flows, rendered as an icon + rate strip under the
   * label (inputs → outputs, per machine at 100% clock). Lets recipe
   * pickers read like the in-game build menu so ratios inform the
   * choice before clicking.
   */
  io?: {
    inputs: Array<{ itemId: string; perMinute: number }>;
    outputs: Array<{ itemId: string; perMinute: number }>;
  };
}

interface BaseProps {
  options: FilterOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Optional fold for label-aria etc. */
  ariaLabel?: string;
  /** Render compact (h-9) instead of standard (h-10). Defaults to standard. */
  compact?: boolean;
  /** Focus the input on mount — with `immediate`, that opens the list
      straight away (used by "Add product"-style reveals). */
  autoFocus?: boolean;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string | null;
  onChange: (next: string | null) => void;
  /** Allow clearing the selection via an inline X button. Default: true. */
  clearable?: boolean;
}

interface MultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (next: string[]) => void;
}

export type FilterSelectProps = SingleProps | MultiProps;

/**
 * Type-to-filter dropdown. Backed by Headless UI's `Combobox` so we get
 * combobox semantics (role=combobox + role=listbox + role=option) and
 * keyboard navigation (arrow keys, Enter to select, Escape to close,
 * type-ahead). Supports single and multiple selection from one component.
 */
export function FilterSelect(props: FilterSelectProps) {
  const [query, setQuery] = useState("");
  // Forwarded onto the chevron `<ComboboxButton>` so the input's
  // `onClick` can re-route to it. Headless UI's `immediate` prop only
  // opens on focus; clicking an already-focused input doesn't fire
  // focus, so without this the user has to click the chevron each
  // time. With the redirect, clicking anywhere on the input chrome
  // toggles the listbox like a native `<select>`.
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Headless UI's `immediate` prop opens on focus, but if the user
  // clicks an already-focused input the dropdown stays closed because
  // focus doesn't fire again. Forward a click on the input chrome to
  // the chevron `<ComboboxButton>` only when it's currently closed,
  // so a single click always opens — and clicking the chevron itself
  // still toggles closed without us re-opening.
  const openIfClosed = () => {
    requestAnimationFrame(() => {
      const btn = buttonRef.current;
      if (!btn) return;
      if (btn.getAttribute("aria-expanded") === "true") return;
      btn.click();
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return props.options;
    return props.options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [query, props.options]);

  const heightClass = props.compact ? "h-9" : "h-10";
  const baseInputClass = `w-full rounded-md border border-border bg-bg pl-3 pr-9 text-sm text-fg outline-none focus:border-primary disabled:opacity-50 ${heightClass}`;

  if (props.multiple) {
    const selectedSet = new Set(props.value);
    const selectedLabels = props.options
      .filter((o) => selectedSet.has(o.value))
      .map((o) => o.label);
    return (
      <Combobox
        multiple
        immediate
        value={props.value}
        onChange={(next: string[]) => props.onChange(next)}
        disabled={props.disabled}
      >
        <div className="relative">
          <ComboboxInput
            aria-label={props.ariaLabel}
            displayValue={() =>
              selectedLabels.length === 0
                ? ""
                : selectedLabels.length <= 2
                  ? selectedLabels.join(", ")
                  : `${selectedLabels.length} selected`
            }
            placeholder={props.placeholder ?? "Type to filter…"}
            onChange={(e) => setQuery(e.target.value)}
            onClick={openIfClosed}
            className={baseInputClass}
          />
          <ComboboxButton
            ref={buttonRef}
            className="absolute inset-y-0 right-0 flex items-center pr-2 text-fg-muted"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </ComboboxButton>
          <DropdownPanel filtered={filtered} value={new Set(props.value)} multiple />
        </div>
      </Combobox>
    );
  }

  const selectedLabel = props.options.find((o) => o.value === props.value)?.label ?? "";
  const showClear = props.clearable !== false && props.value !== null && props.value !== "";

  return (
    <Combobox
      immediate
      value={props.value}
      onChange={(next: string | null) => props.onChange(next)}
      disabled={props.disabled}
    >
      <div className="relative">
        <ComboboxInput
          aria-label={props.ariaLabel}
          autoFocus={props.autoFocus}
          displayValue={() => selectedLabel}
          placeholder={props.placeholder ?? "Type to filter…"}
          onChange={(e) => setQuery(e.target.value)}
          onClick={openIfClosed}
          className={baseInputClass}
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-1 text-fg-muted">
          {showClear && (
            <button
              type="button"
              onMouseDown={(e) => {
                // Stop the input losing focus before our handler fires.
                e.preventDefault();
                props.onChange(null);
                setQuery("");
              }}
              aria-label="Clear selection"
              className="rounded p-1 hover:bg-border"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ComboboxButton ref={buttonRef} className="flex items-center pr-1.5">
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </ComboboxButton>
        </div>
        <DropdownPanel filtered={filtered} value={new Set([props.value ?? ""])} multiple={false} />
      </div>
    </Combobox>
  );
}

interface DropdownPanelProps {
  filtered: FilterOption[];
  value: Set<string>;
  multiple: boolean;
}

function rate(n: number): string {
  // Satisfactory ratios are exact (3.75, 1.875) — rounding to one
  // decimal would mislead anyone balancing a line. Up to 3 decimals,
  // trailing zeros dropped.
  return Number(n.toFixed(3)).toString();
}

function DropdownPanel({ filtered, value, multiple }: DropdownPanelProps) {
  // Rows with an IO strip need more room than plain labels; only pay
  // for the wider panel when a recipe picker is actually using it.
  const hasIo = filtered.some((o) => o.io);
  return (
    <ComboboxOptions
      // `anchor` portals the panel to the body so it floats above
      // whatever stacking context the input lives in — inside a
      // ReactFlow node the old in-place panel painted UNDER sibling
      // nodes. min/max width mirror the old in-place sizing: at least
      // the input's width, capped so long recipe names fit without
      // spanning the pane.
      anchor={{ to: "bottom start", gap: 4 }}
      className={`z-50 max-h-60 min-w-[var(--input-width)] ${
        hasIo ? "max-w-[32rem]" : "max-w-[28rem]"
      } overflow-auto rounded-md border border-border bg-bg-raised py-1 shadow-lg empty:hidden`}
      modal={false}
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-sm text-fg-muted">No matches.</div>
      ) : (
        // Walk options in caller-provided order and emit a sticky
        // header whenever the `group` changes. Header rows are pure
        // markup (not ComboboxOption) so the keyboard focus skips
        // them and selection logic stays unchanged.
        filtered.map((option, idx) => {
          const prev = idx > 0 ? filtered[idx - 1].group : undefined;
          const showHeader = option.group && option.group !== prev;
          const selected = value.has(option.value);
          return (
            <div key={option.value}>
              {showHeader && (
                <div className="sticky top-0 z-10 bg-bg-raised/95 px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted backdrop-blur">
                  {option.group}
                </div>
              )}
              <ComboboxOption
                value={option.value}
                className={({ active }) =>
                  `cursor-pointer px-3 py-1.5 text-sm ${
                    active ? "bg-primary text-white" : "text-fg"
                  }`
                }
              >
                <div className="flex items-center justify-between gap-3 whitespace-nowrap">
                  <div className="flex flex-1 items-center gap-2">
                    {option.iconId && (
                      <Icon itemId={option.iconId} alt="" className="h-5 w-5 shrink-0" />
                    )}
                    <span>{option.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {option.hint && (
                      <span className="text-xs opacity-70">{option.hint}</span>
                    )}
                    {(selected || multiple) && (
                      <Check
                        className={`h-3.5 w-3.5 ${selected ? "" : "opacity-0"}`}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </div>
                {option.io && (
                  // Inputs → outputs at 100% clock. Colour inherits from
                  // the row (white on the active highlight) with opacity
                  // doing the muting, so the strip stays legible in both
                  // states. Wraps so 4-input Manufacturer alts never
                  // overflow the panel.
                  // aria-hidden: to a screen reader the strip is a run of
                  // contextless numbers, and it would pollute the option's
                  // accessible name — the label alone is the name.
                  <div
                    aria-hidden="true"
                    className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] tabular-nums opacity-75"
                  >
                    {option.io.inputs.map((f) => (
                      <span key={`in-${f.itemId}`} className="flex items-center gap-1">
                        <Icon itemId={f.itemId} alt="" className="h-3.5 w-3.5 shrink-0" />
                        {rate(f.perMinute)}
                      </span>
                    ))}
                    <span aria-hidden="true">→</span>
                    {option.io.outputs.map((f) => (
                      <span
                        key={`out-${f.itemId}`}
                        className="flex items-center gap-1 font-semibold"
                      >
                        <Icon itemId={f.itemId} alt="" className="h-3.5 w-3.5 shrink-0" />
                        {rate(f.perMinute)}
                        <span className="font-normal opacity-80">/min</span>
                      </span>
                    ))}
                  </div>
                )}
              </ComboboxOption>
            </div>
          );
        })
      )}
    </ComboboxOptions>
  );
}
