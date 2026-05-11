import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { resourcesApi } from "@/features/resources/api";
import { coordChip } from "@/features/resources/display";
import type { Purity, ResourceNodeRow } from "@/features/resources/types";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";

interface ClaimMissingModalProps {
  /** Resource id the user is short on (e.g. `Desc_Water_C`). */
  resourceItemId: string;
  resourceItemName: string;
  /** ipm shortfall — surfaces as the target the user is trying to cover. */
  shortfallIpm: number;
  nodes: ResourceNodeRow[];
  onClose: () => void;
  /** Called once after at least one claim was saved so the planner can re-derive. */
  onClaimed: () => void;
}

const PURITY_ORDER: Purity[] = ["Pure", "Normal", "Impure"];

/**
 * Inline claim flow for the planner's Insufficient panel. Skips the
 * round-trip through Resources: pick a default extractor + clock once
 * at the top, then one-click claim individual nodes. Tracks running
 * coverage so the user can stop the moment they've covered the gap.
 */
export function ClaimMissingModal({
  resourceItemId,
  resourceItemName,
  shortfallIpm,
  nodes,
  onClose,
  onClaimed,
}: ClaimMissingModalProps) {
  const candidates = useMemo(
    () =>
      nodes
        .filter((n) => n.resourceItemId === resourceItemId && !n.claim)
        .sort((a, b) =>
          PURITY_ORDER.indexOf(a.purity as Purity) -
          PURITY_ORDER.indexOf(b.purity as Purity),
        ),
    [nodes, resourceItemId],
  );
  const firstKind = candidates[0]?.kind ?? "miner_node";

  const [minerId, setMinerId] = useState<string>(
    firstKind === "fracking_well"
      ? "Build_FrackingSmasher_C"
      : "Build_MinerMk1_C",
  );
  const [clockPct, setClockPct] = useState(100);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const claim = async (node: ResourceNodeRow) => {
    setError(null);
    setClaiming(node.id);
    try {
      await resourcesApi.setClaim({
        nodeId: node.id,
        minerId: node.kind === "geyser" ? null : minerId,
        clockPct,
        factoryId: null,
        notes: null,
      });
      setClaimedIds((s) => {
        const next = new Set(s);
        next.add(node.id);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaiming(null);
    }
  };

  const handleClose = () => {
    if (claimedIds.size > 0) onClaimed();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Claim ${resourceItemName} nodes`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
    >
      <Card className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
              <Icon itemId={resourceItemId} className="h-5 w-5" />
              Claim {resourceItemName}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Need {Math.ceil(shortfallIpm)} more ipm — claim a node below
              and the planner will re-derive.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {firstKind !== "geyser" && (
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <label className="block">
              <span className="text-fg-muted">Extractor</span>
              <select
                value={minerId}
                onChange={(e) => setMinerId(e.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
              >
                {firstKind === "fracking_well" ? (
                  <option value="Build_FrackingSmasher_C">
                    Resource Well Extractor
                  </option>
                ) : (
                  <>
                    <option value="Build_MinerMk1_C">Miner Mk1</option>
                    <option value="Build_MinerMk2_C">Miner Mk2</option>
                    <option value="Build_MinerMk3_C">Miner Mk3</option>
                  </>
                )}
              </select>
            </label>
            <label className="block">
              <span className="text-fg-muted">Clock {clockPct}%</span>
              <input
                type="range"
                min={1}
                max={250}
                step={1}
                value={clockPct}
                onChange={(e) => setClockPct(Number(e.target.value))}
                className="mt-2 h-2 w-full accent-primary"
              />
            </label>
          </div>
        )}

        {candidates.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            No unclaimed {resourceItemName} nodes left in the catalog. You're
            out — either reduce the target ipm or pick a recipe that doesn't
            need this item.
          </div>
        ) : (
          <ul className="mt-4 max-h-72 space-y-1 overflow-auto rounded-md border border-border p-1">
            {candidates.map((node, i) => {
              const done = claimedIds.has(node.id);
              return (
                <li
                  key={node.id}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-border/40"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        node.purity === "Pure"
                          ? "bg-amber-400"
                          : node.purity === "Normal"
                            ? "bg-slate-300"
                            : "bg-orange-700"
                      }`}
                      aria-hidden
                    />
                    <span className="font-medium">{node.purity}</span>
                    <span
                      className="truncate tabular-nums text-fg-muted"
                      title={`Catalog id: ${node.id}`}
                    >
                      #{i + 1} · {coordChip(node.x, node.y)}
                    </span>
                  </div>
                  {done ? (
                    <span className="text-success">✓ claimed</span>
                  ) : (
                    <Button
                      onClick={() => void claim(node)}
                      disabled={claiming === node.id}
                      className="px-3 py-1"
                    >
                      {claiming === node.id ? "…" : "Claim"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <div role="alert" className="mt-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-fg-muted">
          <span>
            Claimed in this session: <strong className="text-fg">{claimedIds.size}</strong>
          </span>
          <Button variant="ghost" onClick={handleClose}>
            Done
          </Button>
        </div>
      </Card>
    </div>
  );
}
