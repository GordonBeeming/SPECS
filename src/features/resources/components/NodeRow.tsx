import { useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { ClockInput } from "@/shared/ui/ClockInput";

import { claimDefaultExtractor, nodeDisplayLabel } from "../display";
import { useClearNodeClaim, useSetNodeClaim } from "../hooks/useResources";
import type { ResourceNodeRow } from "../types";

interface NodeRowProps {
  row: ResourceNodeRow;
  factories: { id: string; name: string }[];
  /** Position within the (resource, purity) bucket for a friendly `#N` label. */
  index: number;
}

/**
 * One row in a purity bucket. Compact when collapsed (id + claim chip),
 * inline form when editing — keeps the wall-of-rows scan-friendly while
 * still letting the user tweak miner mark + clock + bound factory
 * without a popover.
 */
export function NodeRow({ row, factories, index }: NodeRowProps) {
  const [editing, setEditing] = useState(false);
  const label = nodeDisplayLabel(row, index);

  return (
    <li className="flex flex-col gap-2 px-5 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="truncate text-[12px] tabular-nums text-fg"
            title={`Catalog id: ${row.id}`}
          >
            {label}
          </span>
          {row.claim ? (
            <ClaimChip row={row} factories={factories} />
          ) : (
            <span className="text-xs text-fg-muted">unclaimed</span>
          )}
        </div>
        <ClaimButton row={row} editing={editing} setEditing={setEditing} />
      </div>
      {editing && (
        <ClaimEditor
          row={row}
          factories={factories}
          onDone={() => setEditing(false)}
        />
      )}
    </li>
  );
}

function ClaimChip({
  row,
  factories,
}: {
  row: ResourceNodeRow;
  factories: { id: string; name: string }[];
}) {
  const factory = row.claim?.factoryId
    ? factories.find((f) => f.id === row.claim?.factoryId)
    : null;
  const ipmLabel =
    row.itemsPerMinute > 0 ? `${Math.round(row.itemsPerMinute)} ipm` : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full border border-border bg-bg px-2 py-0.5 text-fg-muted">
        {row.claim?.minerId
          ? extractorChipLabel(row.claim.minerId, row)
          : "no extractor"}
      </span>
      {row.claimInvalidExtractor && (
        <span
          className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning"
          title={`This node uses ${row.allowedExtractors[0]?.name ?? "a different extractor"} — edit and save to fix the claim. Rates already use the correct extractor.`}
        >
          wrong extractor
        </span>
      )}
      <span className="rounded-full border border-border bg-bg px-2 py-0.5 text-fg-muted">
        {(row.claim?.clockPct ?? 100).toFixed(0)}%
      </span>
      {ipmLabel && (
        <span className="font-medium text-fg">{ipmLabel}</span>
      )}
      {factory && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
          → {factory.name}
        </span>
      )}
    </div>
  );
}

function ClaimButton({
  row,
  editing,
  setEditing,
}: {
  row: ResourceNodeRow;
  editing: boolean;
  setEditing: (b: boolean) => void;
}) {
  const setClaim = useSetNodeClaim();
  const clearClaim = useClearNodeClaim();
  if (row.kind === "geyser") {
    // Geysers don't yield items; we still surface them in the list so
    // the user can mark them "owned" via the editor (notes), but the
    // default action is just an edit button.
    return (
      <Button
        variant="ghost"
        onClick={() => setEditing(!editing)}
        aria-label={editing ? "Cancel" : "Edit"}
        className="px-2 py-1"
      >
        {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
      </Button>
    );
  }
  if (!row.claim) {
    return (
      <Button
        variant="primary"
        onClick={() => {
          // One-click claim with sensible defaults: the node's first
          // allowed extractor (Mk1 for ore, the only choice for
          // oil/wells), 100% clock, no factory. The user can refine via
          // the editor afterwards.
          void setClaim.mutate({
            nodeId: row.id,
            minerId: claimDefaultExtractor(row),
            clockPct: 100,
            factoryId: null,
            notes: null,
          });
        }}
        className="px-2 py-1"
        aria-label="Claim node"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        onClick={() => setEditing(!editing)}
        aria-label={editing ? "Cancel" : "Edit"}
        className="px-2 py-1"
      >
        {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
      </Button>
      <Button
        variant="ghost"
        onClick={() => void clearClaim.mutate(row.id)}
        aria-label="Release node"
        className="px-2 py-1"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ClaimEditor({
  row,
  factories,
  onDone,
}: {
  row: ResourceNodeRow;
  factories: { id: string; name: string }[];
  onDone: () => void;
}) {
  const setClaim = useSetNodeClaim();
  // A stale claim (e.g. Mk2 saved on an oil node before oil got its own
  // extractor family) preselects the valid building so a plain Save
  // repairs it.
  const [minerId, setMinerId] = useState<string>(
    claimDefaultExtractor(row, row.claim?.minerId) ?? "",
  );
  const [clockPct, setClockPct] = useState<number>(row.claim?.clockPct ?? 100);
  const [factoryId, setFactoryId] = useState<string>(
    row.claim?.factoryId ?? "",
  );

  // The server says which buildings this node accepts — the same list
  // `set_node_claim` validates against. Geysers come back empty (they
  // feed the power slice).
  const minerOptions = row.allowedExtractors;

  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-bg/50 p-3 md:grid-cols-4">
      {row.kind !== "geyser" && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">Extractor</span>
          <select
            value={minerId}
            onChange={(e) => setMinerId(e.target.value)}
            className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
          >
            {minerOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">Clock</span>
        <ClockInput value={clockPct} onChange={setClockPct} ariaLabel="Claim clock percent" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">Factory</span>
        <select
          value={factoryId}
          onChange={(e) => setFactoryId(e.target.value)}
          className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
        >
          <option value="">— none —</option>
          {factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <Button
          onClick={() => {
            void setClaim.mutate(
              {
                nodeId: row.id,
                minerId: minerId === "" ? null : minerId,
                clockPct,
                factoryId: factoryId.trim() === "" ? null : factoryId,
                notes: null,
              },
              { onSuccess: onDone },
            );
          }}
          className="px-3 py-1.5"
        >
          <Check className="h-3.5 w-3.5" /> Save
        </Button>
        <Button variant="ghost" onClick={onDone} className="px-3 py-1.5">
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Compact pill text for the claim chip. Miner marks shorten to "Mk2"
 * (the rows are dense); everything else uses the catalog name from
 * `allowedExtractors`, falling back to the raw id for stale claims
 * whose building isn't valid for this node anymore.
 */
function extractorChipLabel(buildingId: string, row: ResourceNodeRow): string {
  const mk = buildingId.match(/^Build_MinerMk(\d)_C$/);
  if (mk) return `Mk${mk[1]}`;
  if (buildingId === "Build_FrackingSmasher_C") return "Well Extractor";
  return (
    row.allowedExtractors.find((e) => e.id === buildingId)?.name ?? buildingId
  );
}
