import { useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";

import { TierBadge } from "@/features/library/components/TierBadge";
import { Button } from "@/shared/ui/Button";
import { ClockInput, formatClockPct } from "@/shared/ui/ClockInput";
import { ConfirmDeleteButton } from "@/shared/ui/ConfirmDeleteButton";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { factoryPickerOptions, type FactoryPickerCandidate } from "@/features/map/transform";
import { floorClockPct } from "@/features/validation/clock";
import type { Finding } from "@/features/validation/types";

import { claimDefaultExtractor, nodeDisplayLabel, nodeKindLabel, previewExtractorIpm } from "../display";
import { useClearNodeClaim, useSetNodeClaim } from "../hooks/useResources";
import type { ResourceNodeRow } from "../types";

/** The one `Finding` variant a resource-node row can flag inline —
 * everything else in `Finding` belongs to other screens. */
export type PortCapacityFinding = Extract<Finding, { kind: "claimOverPortCapacity" }>;

interface NodeRowProps {
  row: ResourceNodeRow;
  factories: FactoryPickerCandidate[];
  /** Position within the (resource, purity) bucket for a friendly `#N` label. */
  index: number;
  /** The map's "Placing" loadout mark, already clamped to this tier's
   * unlocked options — what the quick-claim `+` should default to
   * instead of always falling back to a node's first allowed
   * extractor (Mk1). `null` before the loadout/nodes have loaded. */
  preferredMinerId: string | null;
  /** Validate's port-capacity finding for this node, if any — same
   * check, surfaced at the row where the clock was actually set
   * instead of only two screens away. */
  portWarning?: PortCapacityFinding;
}

/**
 * One row in a purity bucket. Compact when collapsed (id + claim chip),
 * inline form when editing — keeps the wall-of-rows scan-friendly while
 * still letting the user tweak miner mark + clock + bound factory
 * without a popover.
 */
export function NodeRow({ row, factories, index, preferredMinerId, portWarning }: NodeRowProps) {
  const [editing, setEditing] = useState(false);
  const label = nodeDisplayLabel(row, index);
  const kindLabel = nodeKindLabel(row);

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
          {kindLabel && (
            <span className="shrink-0 rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] text-fg-muted">
              {kindLabel}
            </span>
          )}
          {row.claim ? (
            <ClaimChip row={row} factories={factories} portWarning={portWarning} />
          ) : (
            <span className="text-xs text-fg-muted">unclaimed</span>
          )}
        </div>
        <ClaimButton
          row={row}
          editing={editing}
          setEditing={setEditing}
          preferredMinerId={preferredMinerId}
        />
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
  portWarning,
}: {
  row: ResourceNodeRow;
  factories: FactoryPickerCandidate[];
  portWarning?: PortCapacityFinding;
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
      {portWarning && (
        <span
          className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning"
          title={`Outputs ${portWarning.outputIpm.toFixed(1)}${portWarning.isFluid ? " m³/min" : "/min"} — its port caps at ${portWarning.capacityIpm.toFixed(1)}${portWarning.isFluid ? " m³/min" : "/min"} (Mk.${portWarning.capacityMark} ${portWarning.isFluid ? "pipe" : "belt"}), clock to ${floorClockPct(portWarning.maxFittingClockPct)}% to fit`}
        >
          over port cap
        </span>
      )}
      <span className="rounded-full border border-border bg-bg px-2 py-0.5 text-fg-muted">
        {formatClockPct(row.claim?.clockPct ?? 100)}%
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
  preferredMinerId,
}: {
  row: ResourceNodeRow;
  editing: boolean;
  setEditing: (b: boolean) => void;
  preferredMinerId: string | null;
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
          // One-click claim with sensible defaults: the map's current
          // Placing mark when this node accepts it (same preference
          // the map's own quick-claim uses), else the node's first
          // allowed extractor (Mk1 for ore, the only choice for
          // oil/wells); 100% clock, no factory. The user can refine
          // via the editor afterwards.
          void setClaim.mutate({
            nodeId: row.id,
            minerId: claimDefaultExtractor(row, preferredMinerId),
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
      {/* Same two-click arm/confirm pattern every other destructive
          action in the app uses (Tauri's webview swallows
          window.confirm()) — it also gives the release action its own
          trash icon + red arm state, so it no longer reads as a second,
          unlabelled copy of the edit toggle's ✕. */}
      <ConfirmDeleteButton
        onConfirm={() => void clearClaim.mutate(row.id)}
        label="Release node"
        confirmLabel="Release"
        disabled={clearClaim.isPending}
      />
    </div>
  );
}

function ClaimEditor({
  row,
  factories,
  onDone,
}: {
  row: ResourceNodeRow;
  factories: FactoryPickerCandidate[];
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
  const [factoryId, setFactoryId] = useState<string | null>(row.claim?.factoryId ?? null);

  // The server says which buildings this node accepts — the same list
  // `set_node_claim` validates against. Geysers come back empty (they
  // feed the power slice).
  const minerOptions = row.allowedExtractors;
  // Live rate for whatever's currently dragged/picked, not yet saved —
  // without this the row above kept showing the *last saved* clock's
  // ipm the whole time the slider moved, so landing on an exact target
  // rate was guess → save → check → reopen.
  const selectedExtractor = minerOptions.find((m) => m.id === minerId);
  const previewIpm = selectedExtractor
    ? previewExtractorIpm(selectedExtractor.baseIpm, row.purity, clockPct)
    : 0;

  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-bg/50 p-3 md:grid-cols-4">
      {row.kind !== "geyser" && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">Extractor</span>
          <FilterSelect
            compact
            ariaLabel="Extractor"
            clearable={false}
            placeholder="Select extractor…"
            options={minerOptions.map((m) => ({
              value: m.id,
              label: m.name,
              badge: <TierBadge unlockTier={m.unlockTier} />,
            }))}
            value={minerId === "" ? null : minerId}
            onChange={(next) => setMinerId(next ?? "")}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">Clock</span>
        <ClockInput value={clockPct} onChange={setClockPct} ariaLabel="Claim clock percent" />
        {row.kind !== "geyser" && (
          <span className="text-[11px] font-medium text-fg">
            {Math.round(previewIpm)} ipm at this clock
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">Factory</span>
        <FilterSelect
          compact
          ariaLabel="Factory"
          placeholder="— none —"
          options={factoryPickerOptions(row, factories)}
          value={factoryId}
          onChange={setFactoryId}
        />
      </label>
      <div className="flex items-end gap-2">
        <Button
          onClick={() => {
            void setClaim.mutate(
              {
                nodeId: row.id,
                minerId: minerId === "" ? null : minerId,
                clockPct,
                factoryId,
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
  return (
    row.allowedExtractors.find((e) => e.id === buildingId)?.name ?? buildingId
  );
}
