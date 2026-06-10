import { useState } from "react";
import { ChevronDown, Droplets, Pickaxe } from "lucide-react";

import { ClockInput } from "@/shared/ui/ClockInput";

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

const MINER_MARKS: Array<{ id: MapLoadout["minerId"]; label: string }> = [
  { id: "Build_MinerMk1_C", label: "Mk1" },
  { id: "Build_MinerMk2_C", label: "Mk2" },
  { id: "Build_MinerMk3_C", label: "Mk3" },
];

export interface PlacementLoadoutProps {
  loadout: MapLoadout;
  onChange: (next: MapLoadout) => void;
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
export function PlacementLoadout({ loadout, onChange }: PlacementLoadoutProps) {
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

  const markLabel = MINER_MARKS.find((m) => m.id === loadout.minerId)?.label ?? "Mk1";

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

      <div className="mt-2 flex items-center gap-1.5">
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Miner mark">
          {MINER_MARKS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...loadout, minerId: m.id })}
              aria-pressed={loadout.minerId === m.id}
              className={`px-2 py-1 text-[11px] font-medium ${
                loadout.minerId === m.id
                  ? "bg-primary text-white"
                  : "text-fg-muted hover:bg-border hover:text-fg"
              }`}
            >
              {m.label}
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
