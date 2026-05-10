import { useMemo, useState } from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown, X } from "lucide-react";

export interface FilterOption {
  value: string;
  label: string;
  /** Optional secondary text rendered to the right of the label. */
  hint?: string;
}

interface BaseProps {
  options: FilterOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Optional fold for label-aria etc. */
  ariaLabel?: string;
  /** Render compact (h-9) instead of standard (h-10). Defaults to standard. */
  compact?: boolean;
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
            className={baseInputClass}
          />
          <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2 text-fg-muted">
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
      value={props.value}
      onChange={(next: string | null) => props.onChange(next)}
      disabled={props.disabled}
    >
      <div className="relative">
        <ComboboxInput
          aria-label={props.ariaLabel}
          displayValue={() => selectedLabel}
          placeholder={props.placeholder ?? "Type to filter…"}
          onChange={(e) => setQuery(e.target.value)}
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
          <ComboboxButton className="flex items-center pr-1.5">
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

function DropdownPanel({ filtered, value, multiple }: DropdownPanelProps) {
  return (
    <ComboboxOptions
      className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-bg-raised py-1 shadow-lg empty:hidden"
      modal={false}
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-2 text-sm text-fg-muted">No matches.</div>
      ) : (
        filtered.map((option) => (
          <ComboboxOption
            key={option.value}
            value={option.value}
            className={({ active }) =>
              `flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm ${
                active ? "bg-primary text-white" : "text-fg"
              }`
            }
          >
            {() => {
              const selected = value.has(option.value);
              return (
                <>
                  <span className="flex-1 truncate">{option.label}</span>
                  <div className="ml-3 flex items-center gap-2">
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
                </>
              );
            }}
          </ComboboxOption>
        ))
      )}
    </ComboboxOptions>
  );
}
