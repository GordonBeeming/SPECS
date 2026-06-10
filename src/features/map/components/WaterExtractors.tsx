import { useRef, useState } from "react";
import { Droplets, Plus, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { ClockInput } from "@/shared/ui/ClockInput";
import type { WaterExtractorGroup } from "@/features/resources/types";

// Mirror of MapView's CLICK_THRESHOLD_PX — mousedown→up under this is
// a click, past it is a drag.
const CLICK_THRESHOLD_PX = 4;

export interface WaterExtractorPinProps {
  group: WaterExtractorGroup;
  x: number;
  y: number;
  selected: boolean;
  onClick: () => void;
  onDragEnd: (pt: { x: number; y: number }) => void;
  currentScale: () => number;
}

/** Droplet marker for a group of water extractors — drag to move,
 * click for the editor popover. */
export function WaterExtractorPin({
  group,
  x,
  y,
  selected,
  onClick,
  onDragEnd,
  currentScale,
}: WaterExtractorPinProps) {
  const startRef = useRef<{ clientX: number; clientY: number; moved: boolean } | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const totalCount = group.count + (group.count2 ?? 0);

  return (
    <button
      type="button"
      className={`specs-map-pin absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-md border-2 px-1.5 py-0.5 text-[11px] font-medium text-fg shadow-sm active:cursor-grabbing ${
        selected ? "border-accent bg-accent/25" : "border-accent/70 bg-bg-raised/95 hover:bg-bg-raised"
      }`}
      style={{ left: `${hoverPos?.x ?? x}px`, top: `${hoverPos?.y ?? y}px` }}
      title={`${totalCount}× Water Extractor · ${group.outputIpm.toFixed(0)} m³/min — click to edit, drag to move`}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startRef.current = { clientX: e.clientX, clientY: e.clientY, moved: false };
        const onMove = (ev: MouseEvent) => {
          const s = startRef.current;
          if (!s) return;
          const dx = ev.clientX - s.clientX;
          const dy = ev.clientY - s.clientY;
          if (!s.moved && Math.hypot(dx, dy) >= CLICK_THRESHOLD_PX) s.moved = true;
          if (s.moved) {
            const scale = currentScale();
            setHoverPos({ x: x + dx / scale, y: y + dy / scale });
          }
        };
        const onUp = (ev: MouseEvent) => {
          const s = startRef.current;
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          startRef.current = null;
          if (!s) return;
          if (!s.moved) {
            setHoverPos(null);
            onClick();
            return;
          }
          const scale = currentScale();
          setHoverPos(null);
          onDragEnd({
            x: x + (ev.clientX - s.clientX) / scale,
            y: y + (ev.clientY - s.clientY) / scale,
          });
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    >
      <span className="inline-flex items-center gap-1">
        <Droplets className="h-3.5 w-3.5 text-accent" />
        {totalCount}×
      </span>
    </button>
  );
}

export interface WaterExtractorPopoverProps {
  group: WaterExtractorGroup;
  factories: Array<{ id: string; name: string }>;
  pending: boolean;
  onSave: (patch: {
    count: number;
    clockPct: number;
    count2: number | null;
    clock2Pct: number | null;
    factoryId: string | null;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Editor for one water extractor group: bank 1 always, an optional
 * second bank ("40 @ 100% and 2 @ 45%"), the computed total, and the
 * factory the output feeds. */
export function WaterExtractorPopover({
  group,
  factories,
  pending,
  onSave,
  onDelete,
  onClose,
}: WaterExtractorPopoverProps) {
  const [count, setCount] = useState(group.count);
  const [clockPct, setClockPct] = useState(group.clockPct);
  const [bank2, setBank2] = useState<{ count: number; clockPct: number } | null>(
    group.count2 != null && group.clock2Pct != null
      ? { count: group.count2, clockPct: group.clock2Pct }
      : null,
  );
  const [factoryId, setFactoryId] = useState(group.factoryId ?? "");

  const bankIpm = (c: number, p: number) => c * 120 * (p / 100);
  const totalIpm = bankIpm(count, clockPct) + (bank2 ? bankIpm(bank2.count, bank2.clockPct) : 0);

  return (
    <Card className="w-[340px] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Droplets className="h-4 w-4 text-accent" />
          Water extractors
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
        >
          ×
        </button>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs">
        <input
          type="number"
          min={1}
          step={1}
          value={count}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isInteger(v) && v >= 1) setCount(v);
          }}
          aria-label="Extractor count"
          className="h-7 w-16 shrink-0 rounded-md border border-border bg-bg px-1.5 text-[12px] tabular-nums text-fg outline-none focus:border-primary"
        />
        <span className="shrink-0 whitespace-nowrap text-fg-muted">× @</span>
        <ClockInput value={clockPct} onChange={setClockPct} ariaLabel="Bank 1 clock percent" />
      </div>

      {bank2 ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <input
            type="number"
            min={1}
            step={1}
            value={bank2.count}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v >= 1) setBank2({ ...bank2, count: v });
            }}
            aria-label="Second bank count"
            className="h-7 w-16 shrink-0 rounded-md border border-border bg-bg px-1.5 text-[12px] tabular-nums text-fg outline-none focus:border-primary"
          />
          <span className="shrink-0 whitespace-nowrap text-fg-muted">× @</span>
          <ClockInput
            value={bank2.clockPct}
            onChange={(v) => setBank2({ ...bank2, clockPct: v })}
            ariaLabel="Second bank clock percent"
          />
          <button
            type="button"
            aria-label="Remove second bank"
            onClick={() => setBank2(null)}
            className="rounded p-1 text-fg-muted hover:bg-border hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setBank2({ count: 1, clockPct: 100 })}
          className="mt-2 flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-fg-muted hover:bg-border hover:text-fg"
        >
          <Plus className="h-3 w-3" />
          Add second bank (different clock)
        </button>
      )}

      <div className="mt-2 rounded-md bg-bg px-2 py-1.5 text-xs tabular-nums">
        <span className="text-fg-muted">Output</span>{" "}
        <span className="font-semibold text-fg">
          {totalIpm % 1 === 0 ? totalIpm.toFixed(0) : totalIpm.toFixed(1)} m³/min
        </span>
      </div>

      <label className="mt-2 block text-xs">
        <span className="text-fg-muted">Feeds factory</span>
        <select
          value={factoryId}
          onChange={(e) => setFactoryId(e.target.value)}
          className="mt-1 h-7 w-full rounded-md border border-border bg-bg px-1.5 text-[12px] text-fg outline-none focus:border-primary"
        >
          <option value="">— none —</option>
          {factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onDelete} disabled={pending} className="px-2 py-1 text-xs text-danger">
          <Trash2 className="h-3 w-3" />
          Remove
        </Button>
        <Button
          disabled={pending}
          onClick={() =>
            onSave({
              count,
              clockPct,
              count2: bank2?.count ?? null,
              clock2Pct: bank2?.clockPct ?? null,
              factoryId: factoryId.trim() === "" ? null : factoryId,
            })
          }
          className="px-3 py-1 text-xs"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}
