import { useState } from "react";
import { ChevronDown, Droplets, Pickaxe } from "lucide-react";

import { ClockInput } from "@/shared/ui/ClockInput";
import type { ExtractorOption } from "@/features/resources/types";

export interface MapLoadout {
  /** Miner used when claiming/binding an unclaimed miner node. */
  minerId: string;
  minerClockPct: number;
  /** Defaults for newly-placed water extractor groups. */
  waterCount: number;
  waterClockPct: number;
}

export const DEFAULT_LOADOUT: MapLoadout = {
  minerId: "Build_MinerMk1_C",
  minerClockPct: 100,
  waterCount: 4,
  waterClockPct: 100,
};

const LOADOUT_STORAGE = "specs:map:loadout";

export function readLoadout(): MapLoadout {
  try {
    const v = localStorage.getItem(LOADOUT_STORAGE);
    if (!v) return DEFAULT_LOADOUT;
    const p: unknown = JSON.parse(v);
    if (typeof p !== "object" || p === null) return DEFAULT_LOADOUT;
    const l = p as Partial<MapLoadout>;
    const clockOk = (n: unknown): n is number =>
      typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 250;
    return {
      minerId:
        l.minerId === "Build_MinerMk1_C" ||
        l.minerId === "Build_MinerMk2_C" ||
        l.minerId === "Build_MinerMk3_C"
          ? l.minerId
          : DEFAULT_LOADOUT.minerId,
      minerClockPct: clockOk(l.minerClockPct) ? l.minerClockPct : DEFAULT_LOADOUT.minerClockPct,
      waterCount:
        typeof l.waterCount === "number" && Number.isInteger(l.waterCount) && l.waterCount >= 1
          ? l.waterCount
          : DEFAULT_LOADOUT.waterCount,
      waterClockPct: clockOk(l.waterClockPct) ? l.waterClockPct : DEFAULT_LOADOUT.waterClockPct,
    };
  } catch {
    return DEFAULT_LOADOUT;
  }
}

export function writeLoadout(loadout: MapLoadout): void {
  try {
    localStorage.setItem(LOADOUT_STORAGE, JSON.stringify(loadout));
  } catch {}
}

/** Short "Mk{n}" form from a miner building id, for the compact segmented
 * control — falls back to the full catalog name if the id ever stops
 * matching the `Build_MinerMk{n}_C` shape. */
function shortMarkLabel(option: Pick<ExtractorOption, "id" | "name">): string {
  const m = option.id.match(/^Build_MinerMk(\d)_C$/);
  return m ? `Mk${m[1]}` : option.name;
}

/**
 * The mark the widget should actually be showing/defaulting to: the
 * current selection if it's still tier-eligible, else the best
 * (highest-tier) option the playthrough has actually reached. `options`
 * arrives pre-filtered to what's unlocked right now (same server-side
 * tier gate the generator picker uses), so this never has to compare
 * tiers itself — it just checks membership.
 *
 * Guards against two real cases: a stale `minerId` left in
 * `localStorage` from a higher-tier playthrough, and the loadout
 * surviving a downgrade. Returns `loadout` unchanged while `options`
 * hasn't loaded yet (empty array) rather than guessing.
 */
export function clampLoadoutMinerId(loadout: MapLoadout, options: ExtractorOption[]): MapLoadout {
  if (options.length === 0) return loadout;
  if (options.some((o) => o.id === loadout.minerId)) return loadout;
  const best = options[options.length - 1];
  return { ...loadout, minerId: best.id };
}

export interface PlacementLoadoutProps {
  loadout: MapLoadout;
  onChange: (next: MapLoadout) => void;
  /** Miner marks unlocked at the current tier, ascending — same shape
   * as the generator picker's eligible list. Never includes a mark the
   * player hasn't reached yet, so the segmented control can't select
   * into an illegal default. */
  markOptions: ExtractorOption[];
}

const COLLAPSE_STORAGE = "specs:map:loadout:collapsed";

function fmtClock(n: number): string {
  return `${n % 1 === 0 ? n.toFixed(0) : n}%`;
}

/**
 * "What I'm currently placing" — the miner mark + clock every new
 * claim uses, and the defaults for water extractor groups. Collapsed
 * to a summary pill by default so it doesn't crowd the map; the pill
 * still shows the active mark + clock at a glance.
 */
export function PlacementLoadout({ loadout, onChange, markOptions }: PlacementLoadoutProps) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_STORAGE) !== "open",
  );
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_STORAGE, c ? "open" : "closed");
      } catch {}
      return !c;
    });
  };

  const activeMark = markOptions.find((m) => m.id === loadout.minerId);
  const markLabel = activeMark ? shortMarkLabel(activeMark) : "Mk1";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        title="Placement loadout — what new claims and water extractors use"
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-bg-raised/95 px-2.5 py-1.5 text-[11px] font-medium text-fg shadow-lg backdrop-blur hover:border-primary"
      >
        <Pickaxe className="h-3.5 w-3.5 text-primary" />
        {markLabel} @ {fmtClock(loadout.minerClockPct)}
        <Droplets className="ml-1 h-3 w-3 text-accent" />
        {loadout.waterCount}× @ {fmtClock(loadout.waterClockPct)}
      </button>
    );
  }

  return (
    <div className="w-60 rounded-lg border border-border bg-bg-raised/95 p-2.5 text-xs shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-1.5 font-semibold text-fg">
        <span className="flex items-center gap-1.5">
          <Pickaxe className="h-3.5 w-3.5 text-primary" />
          Placing
        </span>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label="Collapse placement loadout"
          className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* flex-wrap: the tier suffix ("Mk2 · T4") makes each mark button
          wider than the old bare "Mk2" ever was, and up to 3 of them can
          render side by side once T8 unlocks Mk3 — wrapping the clock
          input to its own line beats clipping the segmented control. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Miner mark">
          {markOptions.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...loadout, minerId: m.id })}
              aria-pressed={loadout.minerId === m.id}
              title={`${m.name} — unlocks T${m.unlockTier}`}
              className={`px-2 py-1 text-[11px] font-medium ${
                loadout.minerId === m.id
                  ? "bg-primary text-white"
                  : "text-fg-muted hover:bg-border hover:text-fg"
              }`}
            >
              {shortMarkLabel(m)} · T{m.unlockTier}
            </button>
          ))}
        </div>
        <ClockInput
          value={loadout.minerClockPct}
          onChange={(v) => onChange({ ...loadout, minerClockPct: v })}
          slider={false}
          ariaLabel="Miner clock percent"
        />
      </div>

      <div className="mt-2 border-t border-border/40 pt-2">
        <div className="flex items-center gap-1.5">
          <Droplets className="h-3.5 w-3.5 shrink-0 text-accent" />
          <input
            type="number"
            min={1}
            step={1}
            value={loadout.waterCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v >= 1) onChange({ ...loadout, waterCount: v });
            }}
            aria-label="Water extractor count"
            className="h-7 w-14 rounded-md border border-border bg-bg px-1.5 text-[12px] tabular-nums text-fg outline-none focus:border-primary"
          />
          <span className="text-fg-muted">×</span>
          <ClockInput
            value={loadout.waterClockPct}
            onChange={(v) => onChange({ ...loadout, waterClockPct: v })}
            slider={false}
            ariaLabel="Water extractor clock percent"
          />
        </div>
      </div>
    </div>
  );
}
