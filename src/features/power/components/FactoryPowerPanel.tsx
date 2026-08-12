import { useMemo, useState } from "react";
import { Pencil, TrendingDown, TrendingUp, Zap } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { ConfirmDeleteButton } from "@/shared/ui/ConfirmDeleteButton";
import { useGenerators, useItems } from "@/features/library/hooks/useLibrary";
import { useItemTiers } from "@/features/planner/hooks/useItemTiers";
import { obtainableTierById } from "@/features/planner/itemTiers";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";

import { AddPowerGenForm } from "./AddPowerGenForm";
import { EditPowerGenModal } from "./EditPowerGenModal";
import { eligibleGenerators, fuelNameOptions } from "../fuelOptions";
import { usePowerBalance, usePowerGens, useRemovePowerGen } from "../hooks/usePower";
import type { PowerGen } from "../types";

interface FactoryPowerPanelProps {
  factoryId: string;
  /** Rendered under the header of the screen the player is already on
   * (the production plan), so the whole-grid view needs a way back.
   * Omitted where there's no app nav to hand — a popped-out factory
   * window. */
  onOpenGridView?: () => void;
}

/**
 * Power generation for one factory, sized for the production plan's
 * side panel. Every factory needs generators and the draw is printed in
 * that plan's own header, so the decision gets made here — the Power
 * screen keeps the same job for the grid as a whole.
 */
export function FactoryPowerPanel({ factoryId, onOpenGridView }: FactoryPowerPanelProps) {
  const gens = usePowerGens(factoryId);
  const balance = usePowerBalance(factoryId);
  const remove = useRemovePowerGen(factoryId);
  const generators = useGenerators();
  const items = useItems();
  const itemTiers = useItemTiers();
  const playthrough = useCurrentPlaythrough();
  const [editing, setEditing] = useState<PowerGen | null>(null);
  // The mutation's own error is swallowed by the row unmounting on
  // success, so hold the failure separately — Tauri 2's webview
  // suppresses window.alert(), which makes an uncaught delete failure
  // completely invisible.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const tierCap = playthrough.data?.currentTier ?? 9;
  const itemsById = useMemo(
    () => new Map(items.data?.map((i) => [i.id, i]) ?? []),
    [items.data],
  );
  const generatorsById = useMemo(
    () => new Map(generators.data?.map((g) => [g.id, g]) ?? []),
    [generators.data],
  );
  const fuelTierById = useMemo(() => obtainableTierById(itemTiers.data), [itemTiers.data]);
  const unlockedGenerators = useMemo(
    () => eligibleGenerators(generators.data, tierCap),
    [generators.data, tierCap],
  );

  const netMw = balance.data?.netMw ?? 0;
  const short = balance.data ? balance.data.netMw < 0 : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-bg px-3 py-2 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">Generated</div>
          <div className="text-sm font-semibold tabular-nums text-fg">
            {balance.data ? balance.data.generatedMw.toFixed(1) : "—"} MW
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">Consumed</div>
          <div className="text-sm font-semibold tabular-nums text-fg">
            {balance.data ? balance.data.consumedMw.toFixed(1) : "—"} MW
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">Net</div>
          {/* Red and green alone don't carry this: DESIGN.md's rule is
              that every red gets an icon, and the sign of the figure is
              the whole reading. The arrow states the direction for
              anyone who can't separate the two colours. */}
          <div
            className={`flex items-center justify-center gap-1 text-sm font-semibold tabular-nums ${
              short ? "text-danger" : "text-success"
            }`}
          >
            {balance.data &&
              (short ? (
                <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ))}
            <span>
              {balance.data ? balance.data.netMw.toFixed(1) : "—"} MW
              <span className="sr-only">{balance.data ? (short ? " short" : " spare") : ""}</span>
            </span>
          </div>
        </div>
      </div>

      {/* A factory on a shared grid drawing from elsewhere is normal, so
          this states the gap rather than flagging it as an error — the
          grid-wide verdict stays on the Power screen and Validate. */}
      {short && (
        <p className="text-xs text-fg-muted">
          This factory draws {Math.abs(netMw).toFixed(1)} MW more than it makes. Add generators
          here, or leave it drawing the difference from the rest of the grid.
        </p>
      )}

      <AddPowerGenForm
        factoryId={factoryId}
        unlockedGenerators={unlockedGenerators}
        itemsById={itemsById}
        fuelTierById={fuelTierById}
        tierCap={tierCap}
        // `playthrough` belongs here as much as the catalogs do: while
        // it's in flight `tierCap` falls back to 9, so enabling early
        // offers a Tier 0 player every generator in the game.
        optionsLoading={
          generators.isPending || items.isPending || itemTiers.isPending || playthrough.isPending
        }
        layout="stacked"
      />

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Generators
        </h3>
        {gens.isPending && <div className="mt-1 text-xs text-fg-muted">Loading…</div>}
        {gens.data?.length === 0 && (
          <div className="mt-1 rounded-md border border-dashed border-border p-3 text-xs text-fg-muted">
            None yet — everything this factory draws comes from the rest of the grid.
          </div>
        )}
        {gens.data && gens.data.length > 0 && (
          <ul className="mt-1 flex flex-col gap-1">
            {gens.data.map((g) => {
              const gen = generatorsById.get(g.generatorId);
              const fuelName = itemsById.get(g.fuelItemId)?.name ?? g.fuelItemId;
              return (
                <li
                  key={g.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5 text-xs"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">
                      {g.count}× {gen?.name ?? g.generatorId}
                    </span>
                    <span className="block truncate text-fg-muted tabular-nums">
                      {fuelName ? `${fuelName} · ` : ""}
                      {g.clockPct.toFixed(1)}%
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(g)}
                    aria-label={`Edit ${gen?.name ?? g.generatorId}`}
                    className="rounded-md p-1.5 text-fg-muted hover:bg-border hover:text-fg"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <ConfirmDeleteButton
                    label="Remove generator"
                    disabled={remove.isPending}
                    onConfirm={() => {
                      setDeleteError(null);
                      remove.mutate(g.id, {
                        onError: (err) => {
                          console.error("remove power_gen failed", err);
                          setDeleteError(err instanceof Error ? err.message : String(err));
                        },
                      });
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {deleteError && (
          <p role="alert" className="mt-1 text-xs text-danger">
            Couldn't remove that generator: {deleteError}
          </p>
        )}
      </div>

      {balance.data && balance.data.fuelFlows.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            Fuel demand
          </h3>
          <ul className="mt-1 flex flex-col gap-1">
            {balance.data.fuelFlows.map((f) => (
              <li
                key={f.itemId}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-2 py-1 text-xs"
              >
                <span className="min-w-0 truncate text-fg">{f.itemName}</span>
                <span className="shrink-0 tabular-nums text-fg-muted">
                  {f.perMinute.toFixed(2)} {f.isFluid ? "m³/min" : "/min"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {onOpenGridView && (
        <Button variant="ghost" onClick={onOpenGridView} className="self-start px-2 py-1 text-xs">
          <Zap className="h-3.5 w-3.5 text-warning" />
          Power across every factory
        </Button>
      )}

      {editing &&
        (() => {
          const gen = generatorsById.get(editing.generatorId);
          return (
            <EditPowerGenModal
              factoryId={factoryId}
              gen={editing}
              generatorName={gen?.name ?? editing.generatorId}
              fuelOptions={fuelNameOptions(gen, {
                itemsById,
                fuelTierById,
                tierCap,
                keepFuelItemId: editing.fuelItemId,
              })}
              onClose={() => setEditing(null)}
            />
          );
        })()}
    </div>
  );
}
