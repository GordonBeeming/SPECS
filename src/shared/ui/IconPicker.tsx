import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Icon } from "./Icon";

interface IconPickerProps {
  /** Currently picked id (string), or `null` for the "no icon" choice. */
  value: string | null;
  onChange: (next: string | null) => void;
  /**
   * Optional pool of suggested ids to feature at the top of the grid
   * (e.g. building ids for a factory). Falls back to the bundled icon
   * list otherwise.
   */
  suggested?: string[];
  /**
   * Pool the user can search through. When omitted, every bundled icon
   * is searchable (~127 ids in v1.1). Pass a narrower list when only
   * a slice of ids is sensible (e.g. only buildings).
   */
  pool?: string[];
}

/**
 * Visual picker for `Desc_*_C` / `Build_*_C` icons. Surfaces the bundled
 * satisfactorytools pack via `<Icon>`. Highlights a small set of
 * "suggested" ids at the top, then a search-filtered grid of the rest.
 * The "no icon" pill clears the selection — the consumer is expected to
 * fall back to its own glyph when value is null.
 */
export function IconPicker({ value, onChange, suggested = [], pool }: IconPickerProps) {
  const [query, setQuery] = useState("");

  const everything = useMemo(() => {
    if (pool) return pool;
    // Pull every bundled icon id from the same Vite glob the runtime
    // primitive uses, so the picker never offers an id we can't render.
    const modules = import.meta.glob<{ default: string }>(
      "/src/assets/icons/satisfactory/*.png",
      { eager: true },
    );
    return Object.keys(modules).map((p) => {
      const file = p.split("/").pop() ?? "";
      return file.replace(/\.png$/i, "");
    });
  }, [pool]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return everything;
    return everything.filter((id) => id.toLowerCase().includes(q));
  }, [query, everything]);

  // De-dupe suggested → main grid so the same icon doesn't appear twice.
  const suggestedSet = new Set(suggested);
  const restOfGrid = filtered.filter((id) => !suggestedSet.has(id)).slice(0, 60);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
            value === null
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-fg-muted hover:bg-border"
          }`}
        >
          <X className="h-3 w-3" />
          No icon
        </button>
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            type="search"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-bg pl-7 pr-2 text-xs text-fg outline-none focus:border-primary"
          />
        </label>
      </div>

      {suggested.length > 0 && query === "" && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
            Suggested
          </div>
          <Grid value={value} onChange={onChange} ids={suggested} />
        </div>
      )}

      <div>
        {suggested.length > 0 && query === "" && (
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg-muted">
            All icons
          </div>
        )}
        <Grid value={value} onChange={onChange} ids={restOfGrid} />
        {restOfGrid.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-fg-muted">
            No icons match "{query}".
          </div>
        )}
      </div>
    </div>
  );
}

function Grid({
  value,
  onChange,
  ids,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  ids: string[];
}) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {ids.map((id) => {
        const picked = id === value;
        return (
          <button
            key={id}
            type="button"
            title={id}
            onClick={() => onChange(id)}
            className={`flex h-10 w-10 items-center justify-center rounded-md border transition-colors ${
              picked
                ? "border-primary bg-primary/10"
                : "border-border bg-bg hover:border-primary/50 hover:bg-border/40"
            }`}
          >
            <Icon itemId={id} alt={id} className="h-7 w-7" />
          </button>
        );
      })}
    </div>
  );
}
