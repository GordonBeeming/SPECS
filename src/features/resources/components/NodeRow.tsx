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
import { num } from "@/shared/format/rates";

import { claimDefaultExtractor, nodeDisplayLabel, nodeKindLabel, previewExtractorIpm } from "../display";
import { useClearNodeClaim, useSetNodeClaim } from "../hooks/useResources";
import type { ResourceNodeRow } from "../types";

/** The one `Finding` variant a resource-node row can flag inline —
 * everything else in `Finding` belongs to other screens. */
export type PortCapacityFinding = Extract<Finding, { kind: "claimOverPortCapacity" }>;

/**
 * The claim as it stands in the open editor, before Save. Held by the
 * row rather than the editor so the chip above can read the same
 * numbers: with the state inside the editor, dragging the clock to 50
 * left the row still reading the saved `100% · 60 ipm` next to the
 * editor's `30 ipm at this clock` — two answers for one node.
 */
interface ClaimDraft {
  minerId: string;
  clockPct: number;
  factoryId: string | null;
}

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
  // Null when the editor is closed — one piece of state answers both
  // "is it open" and "what does it currently say".
  const [draft, setDraft] = useState<ClaimDraft | null>(null);
  const label = nodeDisplayLabel(row, index);
  const kindLabel = nodeKindLabel(row);

  const openEditor = () =>
    setDraft({
      // A stale claim (e.g. Mk2 saved on an oil node before oil got its
      // own extractor family) preselects the valid building so a plain
      // Save repairs it.
      minerId: claimDefaultExtractor(row, row.claim?.minerId) ?? "",
      clockPct: row.claim?.clockPct ?? 100,
      factoryId: row.claim?.factoryId ?? null,
    });

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
          {row.claim || draft ? (
            <ClaimChip row={row} factories={factories} portWarning={portWarning} draft={draft} />
          ) : (
            <span className="text-xs text-fg-muted">unclaimed</span>
          )}
        </div>
        <ClaimButton
          row={row}
          editing={draft !== null}
          onOpenEditor={openEditor}
          onCloseEditor={() => setDraft(null)}
          preferredMinerId={preferredMinerId}
        />
      </div>
      {draft && (
        <ClaimEditor
          row={row}
          factories={factories}
          draft={draft}
          onChange={setDraft}
          onDone={() => setDraft(null)}
        />
      )}
    </li>
  );
}

function ClaimChip({
  row,
  factories,
  portWarning,
  draft,
}: {
  row: ResourceNodeRow;
  factories: FactoryPickerCandidate[];
  portWarning?: PortCapacityFinding;
  /** When the editor is open, the chip reports what it says rather than
   * what's saved. */
  draft: ClaimDraft | null;
}) {
  const minerId = draft ? draft.minerId : (row.claim?.minerId ?? null);
  const clockPct = draft ? draft.clockPct : (row.claim?.clockPct ?? 100);
  const factoryId = draft ? draft.factoryId : (row.claim?.factoryId ?? null);
  const factory = factoryId ? factories.find((f) => f.id === factoryId) : null;
  // An unsaved claim has no server-computed rate to read, so the draft
  // reuses the same preview formula the editor prints below it — the
  // two lines can't disagree because they're one calculation.
  const draftExtractor = draft
    ? row.allowedExtractors.find((e) => e.id === draft.minerId)
    : undefined;
  const ipm = draft
    ? draftExtractor
      ? previewExtractorIpm(draftExtractor.baseIpm, row.purity, draft.clockPct)
      : 0
    : row.itemsPerMinute;
  const ipmLabel = ipm > 0 ? `${Math.round(ipm)} ipm` : null;
  // Both badges are verdicts the backend passed on the *saved* claim, so
  // neither can speak for a draft. The invalid-extractor one is moot the
  // moment the editor opens (it seeds a valid building). The port cap
  // can still be judged live, but only while the draft keeps the same
  // extractor — swap it and the finding's capacity figure is for a
  // different machine.
  const showInvalidExtractor = !draft && row.claimInvalidExtractor;
  // The row can only report the draft while it also says the number
  // isn't committed yet, since a live figure styled exactly like a saved
  // one just moves the confusion rather than fixing it. Shown once the
  // draft actually diverges, so opening the editor doesn't mark an
  // untouched claim dirty.
  const unsaved =
    !!draft &&
    (draft.minerId !== (row.claim?.minerId ?? "") ||
      draft.clockPct !== (row.claim?.clockPct ?? 100) ||
      draft.factoryId !== (row.claim?.factoryId ?? null));
  const showPortWarning =
    !!portWarning &&
    (!draft
      ? true
      : draftExtractor?.name === portWarning.extractorName && ipm > portWarning.capacityIpm);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full border border-border bg-bg px-2 py-0.5 text-fg-muted">
        {minerId ? extractorChipLabel(minerId, row) : "no extractor"}
      </span>
      {showInvalidExtractor && (
        <span
          className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning"
          title={`This node uses ${row.allowedExtractors[0]?.name ?? "a different extractor"} — edit and save to fix the claim. Rates already use the correct extractor.`}
        >
          wrong extractor
        </span>
      )}
      {showPortWarning && portWarning && (
        <span
          className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning"
          title={`Outputs ${portWarning.outputIpm.toFixed(1)}${portWarning.isFluid ? " m³/min" : "/min"} — its port caps at ${portWarning.capacityIpm.toFixed(1)}${portWarning.isFluid ? " m³/min" : "/min"} (Mk.${portWarning.capacityMark} ${portWarning.isFluid ? "pipe" : "belt"}), clock to ${floorClockPct(portWarning.maxFittingClockPct)}% to fit`}
        >
          over port cap
        </span>
      )}
      <span className="rounded-full border border-border bg-bg px-2 py-0.5 text-fg-muted">
        {formatClockPct(clockPct)}%
      </span>
      {ipmLabel && (
        <span className="font-medium text-fg">{ipmLabel}</span>
      )}
      {factory && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
          → {factory.name}
        </span>
      )}
      {unsaved && (
        <span
          className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary"
          title="These are the numbers in the editor below — Save to keep them"
        >
          unsaved
        </span>
      )}
    </div>
  );
}

function ClaimButton({
  row,
  editing,
  onOpenEditor,
  onCloseEditor,
  preferredMinerId,
}: {
  row: ResourceNodeRow;
  editing: boolean;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  preferredMinerId: string | null;
}) {
  const setClaim = useSetNodeClaim();
  const clearClaim = useClearNodeClaim();
  const toggleEditor = () => (editing ? onCloseEditor() : onOpenEditor());
  if (row.kind === "geyser") {
    // Geysers don't yield items; we still surface them in the list so
    // the user can mark them "owned" via the editor (notes), but the
    // default action is just an edit button.
    return (
      <Button
        variant="ghost"
        onClick={toggleEditor}
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
            // `set_node_claim` writes every field it's given, so a
            // literal null here is a delete. Unreachable with a note
            // today (this button only renders on an unclaimed node),
            // but reading the note through keeps that a property of
            // the write rather than of the guard above it.
            notes: row.claim?.notes ?? null,
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
        onClick={toggleEditor}
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
  draft,
  onChange,
  onDone,
}: {
  row: ResourceNodeRow;
  factories: FactoryPickerCandidate[];
  draft: ClaimDraft;
  onChange: (next: ClaimDraft) => void;
  onDone: () => void;
}) {
  const setClaim = useSetNodeClaim();
  const { minerId, clockPct, factoryId } = draft;

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
            onChange={(next) => onChange({ ...draft, minerId: next ?? "" })}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">Clock</span>
        <ClockInput
          value={clockPct}
          onChange={(next) => onChange({ ...draft, clockPct: next })}
          ariaLabel="Claim clock percent"
        />
        {row.kind !== "geyser" && (
          <span className="text-[11px] font-medium text-fg">
            {num(previewIpm)} ipm at this clock
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
          onChange={(next) => onChange({ ...draft, factoryId: next })}
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
                // This editor has no notes field, so the note is
                // pass-through, not something being saved. Sending null
                // deleted it on every clock nudge and factory rebind —
                // and the note is the only record of why a node was
                // underclocked, so nothing else could bring it back.
                notes: row.claim?.notes ?? null,
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
