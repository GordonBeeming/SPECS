import { useMemo, useState } from "react";
import { Sparkles, Plus, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Icon } from "@/shared/ui/Icon";
import { useItems, useRecipes } from "@/features/library/hooks/useLibrary";
import { useUnlockedAlts } from "@/features/alts/hooks/useAlts";
import { useResourceNodes } from "@/features/resources/hooks/useResources";
import { plannerApi } from "@/features/planner/api";
import { ChainPreview } from "@/features/planner/components/ChainPreview";
import type {
  DeriveChainResult,
  InputSource,
  PlannerError,
} from "@/features/planner/types";
import { queryKeys } from "@/shared/query/keys";

import { useApplyChainToFactory, useFactoryList } from "../hooks/useFactories";

interface FactoryTargetPanelProps {
  factoryId: string;
  onClose: () => void;
}

// In-memory shape for the per-item pin list. We track sources as a
// nested array `pins[itemId] = [{ factoryId, cap }, …]` so the user
// can stack multiple feeders for one item and the planner allocates
// in declared order.
type PinRow = { factoryId: string; cap: number | "" };
type PinMap = Record<string, PinRow[]>;

function pinsToSources(pins: PinMap): InputSource[] {
  const out: InputSource[] = [];
  for (const [itemId, rows] of Object.entries(pins)) {
    for (const row of rows) {
      if (!row.factoryId) continue;
      out.push({
        itemId,
        source: { kind: "factory", id: row.factoryId },
        ipmCap: typeof row.cap === "number" && row.cap > 0 ? row.cap : undefined,
      });
    }
  }
  return out;
}

export function FactoryTargetPanel({ factoryId, onClose }: FactoryTargetPanelProps) {
  const items = useItems();
  const recipes = useRecipes();
  const factories = useFactoryList();
  const nodes = useResourceNodes();
  const unlockedAlts = useUnlockedAlts();
  const queryClient = useQueryClient();
  const applyChain = useApplyChainToFactory(factoryId);

  const [target, setTarget] = useState<string | null>(null);
  const [targetIpm, setTargetIpm] = useState(60);
  const [pins, setPins] = useState<PinMap>({});
  // User-chosen recipes per item (item_id → recipe_id). The Rust side
  // honours these whenever they're valid for the item and falls back
  // to the auto-pick when stale.
  const [chosenRecipes, setChosenRecipes] = useState<Record<string, string>>(
    {},
  );
  const [result, setResult] = useState<DeriveChainResult | null>(null);
  const [staleAfterTargetEdit, setStaleAfterTargetEdit] = useState(false);
  const [pending, setPending] = useState(false);
  const [applyPending, setApplyPending] = useState(false);
  const [applied, setApplied] = useState<string[] | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Target options follow the same tier-aware rule the cross-factory
  // PlannerView uses: only items with a non-alt-only recipe path, and
  // grouped by their earliest standard tier so late-game items don't
  // bucket under Tier 0 because of their Hard Drive alt.
  const targetOptions = useMemo(() => {
    if (!items.data || !recipes.data) return [];
    const standardTier = new Map<string, number>();
    const altTier = new Map<string, number>();
    for (const r of recipes.data) {
      if (r.id.startsWith("Recipe_Unpackage")) continue;
      const bucket = r.isAlt ? altTier : standardTier;
      for (const o of r.outputs) {
        const cur = bucket.get(o.itemId);
        if (cur === undefined || r.unlockTier < cur) {
          bucket.set(o.itemId, r.unlockTier);
        }
      }
    }
    const effectiveTier = (itemId: string): number | undefined =>
      standardTier.get(itemId) ?? altTier.get(itemId);
    const eligible = items.data.filter(
      (i) => i.category !== "raw" && effectiveTier(i.id) !== undefined,
    );
    eligible.sort((a, b) => {
      const at = effectiveTier(a.id) ?? 99;
      const bt = effectiveTier(b.id) ?? 99;
      return at === bt ? a.name.localeCompare(b.name) : at - bt;
    });
    return eligible.map((i) => ({
      value: i.id,
      label: i.name,
      iconId: i.id,
      group: `Tier ${effectiveTier(i.id) ?? "?"}`,
    }));
  }, [items.data, recipes.data]);

  // The pinnable list = current intermediate stages (any non-target
  // stage) ∪ items the user already pinned (so the user can keep them
  // visible even when re-derive removes their stage). For each, we
  // know the demand from the last successful plan; pinned items also
  // appear in `plan.imports` with the resolved ipm.
  const pinnableItems = useMemo(() => {
    const seen = new Map<string, { itemName: string; demand: number }>();
    if (result?.kind === "ok") {
      for (const stage of result.plan.stages) {
        if (stage.outputItemId === result.plan.targetItemId) continue;
        seen.set(stage.outputItemId, {
          itemName: items.data?.find((i) => i.id === stage.outputItemId)?.name ??
            stage.outputItemId,
          demand: stage.outputIpm,
        });
      }
      for (const imp of result.plan.imports) {
        seen.set(imp.itemId, {
          itemName: imp.itemName,
          demand: (seen.get(imp.itemId)?.demand ?? 0) + imp.resolvedIpm,
        });
      }
    }
    // Surface items the user pinned but whose demand we haven't resolved
    // yet (e.g. they pinned, then changed the target). Demand falls back
    // to 0 — the row still renders so they can remove the stale pin.
    for (const itemId of Object.keys(pins)) {
      if (!seen.has(itemId)) {
        seen.set(itemId, {
          itemName: items.data?.find((i) => i.id === itemId)?.name ?? itemId,
          demand: 0,
        });
      }
    }
    return Array.from(seen.entries()).map(([itemId, info]) => ({
      itemId,
      itemName: info.itemName,
      demand: info.demand,
    }));
  }, [result, pins, items.data]);

  const factoryOptions = useMemo(
    () =>
      (factories.data ?? [])
        .filter((f) => f.id !== factoryId)
        .map((f) => ({ value: f.id, label: f.name })),
    [factories.data, factoryId],
  );

  const derive = async (
    nextPins: PinMap = pins,
    nextRecipes: Record<string, string> = chosenRecipes,
  ) => {
    if (!target) return;
    setPending(true);
    setApplied(null);
    setApplyError(null);
    setStaleAfterTargetEdit(false);
    try {
      // Always bypass the supply gate when designing — the panel shows
      // the full chain plus warnings instead of walling the user off.
      // Real structural errors (cycles, unknown targets) still come
      // back as Err and render the strip.
      const r = await plannerApi.derive({
        targetItemId: target,
        targetIpm,
        sources: pinsToSources(nextPins),
        recipes: nextRecipes,
        bypassSupply: true,
      });
      setResult(r);
    } finally {
      setPending(false);
    }
  };

  const handleSwapRecipe = (itemId: string, recipeId: string) => {
    const next = { ...chosenRecipes, [itemId]: recipeId };
    setChosenRecipes(next);
    void derive(pins, next);
  };

  const apply = async () => {
    if (result?.kind !== "ok") return;
    setApplyPending(true);
    setApplyError(null);
    try {
      const out = await applyChain.mutateAsync({
        factoryId,
        plan: result.plan,
        defaultLinkDistanceM: 1000,
      });
      setApplied(out?.machineIds ?? []);
      // Belt-and-braces: useApplyChainToFactory invalidates the same
      // keys already, but keeping these here means a future refactor
      // doesn't silently drop the refresh.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.factory.detail(factoryId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.factory.list,
      });
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyPending(false);
    }
  };

  const addPin = (itemId: string) => {
    const next: PinMap = {
      ...pins,
      [itemId]: [...(pins[itemId] ?? []), { factoryId: "", cap: "" }],
    };
    setPins(next);
  };
  const updatePin = (itemId: string, idx: number, patch: Partial<PinRow>) => {
    const next: PinMap = {
      ...pins,
      [itemId]: (pins[itemId] ?? []).map((row, i) =>
        i === idx ? { ...row, ...patch } : row,
      ),
    };
    setPins(next);
    // Auto re-derive when a complete pin row (has a factory) is edited.
    if (patch.factoryId !== undefined || patch.cap !== undefined) {
      const rows = next[itemId] ?? [];
      if (rows.some((r) => r.factoryId)) {
        void derive(next);
      }
    }
  };
  const removePin = (itemId: string, idx: number) => {
    const remaining = (pins[itemId] ?? []).filter((_, i) => i !== idx);
    const next: PinMap = { ...pins };
    if (remaining.length === 0) {
      delete next[itemId];
    } else {
      next[itemId] = remaining;
    }
    setPins(next);
    void derive(next);
  };

  /**
   * The plan-as-warning pattern — derive_chain is always called with
   * bypass_supply: true so we get a full ChainPlan; here we compute
   * the diagnostics the user needs to see.
   */
  const warnings = useMemo(() => {
    if (result?.kind !== "ok") return null;
    const rawGaps: Array<{ itemId: string; itemName: string; gap: number }> = [];
    const claimedSupply = new Map<string, number>();
    for (const n of nodes.data ?? []) {
      if (!n.claim) continue;
      claimedSupply.set(
        n.resourceItemId,
        (claimedSupply.get(n.resourceItemId) ?? 0) + n.itemsPerMinute,
      );
    }
    for (const [itemId, demand] of Object.entries(result.plan.rawDemand)) {
      const supplied = claimedSupply.get(itemId) ?? 0;
      if (demand > supplied + 1e-3) {
        const itemName = items.data?.find((i) => i.id === itemId)?.name ?? itemId;
        rawGaps.push({ itemId, itemName, gap: demand - supplied });
      }
    }
    const importGaps: Array<{ itemId: string; itemName: string; gap: number }> = [];
    for (const [itemId, demand] of Object.entries(result.plan.pinnedDemand)) {
      const allocated = result.plan.imports
        .filter((i) => i.itemId === itemId)
        .reduce((sum, i) => sum + i.resolvedIpm, 0);
      if (demand > allocated + 1e-3) {
        const itemName =
          items.data?.find((i) => i.id === itemId)?.name ?? itemId;
        importGaps.push({ itemId, itemName, gap: demand - allocated });
      }
    }
    if (rawGaps.length === 0 && importGaps.length === 0) return null;
    return { rawGaps, importGaps };
  }, [result, nodes.data, items.data]);

  const factoryNameFor = (id: string) =>
    factories.data?.find((f) => f.id === id)?.name;

  return (
    <Card className="border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-primary">
            <Sparkles className="h-4 w-4" />
            Build to target
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            "I want N of <em>x</em>/min in this factory" → derive the chain
            back to raw, pin any inputs you'd rather import from another
            factory, then apply.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close target panel"
          className="rounded-md p-1 text-fg-muted hover:bg-border hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Target */}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_auto]">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">Target item</span>
          <FilterSelect
            options={targetOptions}
            value={target}
            onChange={(next) => {
              setTarget(next);
              if (result) setStaleAfterTargetEdit(true);
            }}
            placeholder="Pick an item…"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">Per minute</span>
          <input
            type="number"
            min={1}
            step={1}
            value={targetIpm}
            onChange={(e) => {
              setTargetIpm(Math.max(1, Number(e.target.value)));
              if (result) setStaleAfterTargetEdit(true);
            }}
            className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
          />
        </label>
        <div className="flex items-end">
          <Button onClick={() => derive()} disabled={!target || pending}>
            {pending ? "Deriving…" : result ? "Re-derive" : "Derive"}
          </Button>
        </div>
      </div>

      {staleAfterTargetEdit && (
        <p className="mt-2 text-xs text-amber-500">
          Target changed — click <strong>Re-derive</strong> to refresh the
          preview.
        </p>
      )}

      {/* Items, Input */}
      {result && pinnableItems.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Items, Input
          </h3>
          <p className="mt-1 text-xs text-fg-muted">
            Default: produce here. Pin a factory to cut the upstream tree at
            that item and add a logistics link from there into this factory.
          </p>
          <ul className="mt-2 space-y-2">
            {pinnableItems.map(({ itemId, itemName, demand }) => {
              const pinRows = pins[itemId] ?? [];
              const gap =
                warnings?.importGaps.find((g) => g.itemId === itemId)?.gap ?? 0;
              return (
                <li
                  key={itemId}
                  className="rounded-md border border-border bg-bg/40 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon itemId={itemId} className="h-4 w-4" />
                      <span className="font-medium">{itemName}</span>
                      <span className="text-xs text-fg-muted tabular-nums">
                        needs {Math.ceil(demand)}/min
                      </span>
                    </div>
                    {pinRows.length === 0 && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => addPin(itemId)}
                        disabled={factoryOptions.length === 0}
                      >
                        <Plus className="h-3 w-3" />
                        Pin source
                      </Button>
                    )}
                  </div>
                  {pinRows.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {pinRows.map((row, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-[1fr_100px_auto] items-center gap-2"
                        >
                          <FilterSelect
                            ariaLabel={`Source factory for ${itemName}`}
                            compact
                            options={factoryOptions}
                            value={row.factoryId || null}
                            onChange={(next) =>
                              updatePin(itemId, idx, { factoryId: next ?? "" })
                            }
                            placeholder="Pick a factory…"
                          />
                          <input
                            type="number"
                            min={0}
                            step={1}
                            placeholder="cap"
                            value={row.cap}
                            onChange={(e) => {
                              const raw = e.target.value;
                              updatePin(itemId, idx, {
                                cap: raw === "" ? "" : Math.max(0, Number(raw)),
                              });
                            }}
                            className="h-8 rounded-md border border-border bg-bg px-2 text-xs text-fg outline-none focus:border-primary tabular-nums"
                            aria-label={`Cap for ${itemName} from ${
                              factoryNameFor(row.factoryId) ?? "source"
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => removePin(itemId, idx)}
                            aria-label={`Remove pin row ${idx + 1} for ${itemName}`}
                            className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => addPin(itemId)}
                      >
                        <Plus className="h-3 w-3" />
                        Add another source
                      </Button>
                    </div>
                  )}
                  {gap > 0 && (
                    <p className="mt-1 text-xs text-amber-500">
                      Heads up — short by {gap.toFixed(1)}/min. Raise a cap,
                      pin another source, or apply anyway and source the
                      rest later.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Structural errors (cycles, unknown target) still wall off — there's
          no plan to show. Supply/import gaps are surfaced as warnings
          alongside the full preview below. */}
      {result?.kind === "err" && <PlannerErrorStrip error={result.error} />}

      {result?.kind === "ok" && warnings && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-semibold text-amber-500">
            Heads up — this build isn't fully supplied yet
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            The chain below is what the planner derived. You can swap
            recipes, pin sources, and apply anyway — these are gaps to
            close, not blockers.
          </p>
          {warnings.rawGaps.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {warnings.rawGaps.map(({ itemId, itemName, gap }) => (
                <li key={itemId} className="tabular-nums">
                  {itemName} — short {Math.ceil(gap)}/min raw supply (claim
                  more nodes)
                </li>
              ))}
            </ul>
          )}
          {warnings.importGaps.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {warnings.importGaps.map(({ itemId, itemName, gap }) => (
                <li key={itemId} className="tabular-nums">
                  {itemName} — pinned sources short {gap.toFixed(1)}/min
                  (raise a cap or pin another source)
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result?.kind === "ok" && (
        <div className="mt-4">
          <ChainPreview
            plan={result.plan}
            nodes={nodes.data ?? []}
            showHeader
            factoryName={factoryNameFor}
            recipes={recipes.data ?? []}
            unlockedAlts={unlockedAlts.data}
            onSwapRecipe={handleSwapRecipe}
          />
        </div>
      )}

      {/* Apply */}
      {result?.kind === "ok" && (
        <div className="mt-4 flex items-center justify-between gap-3">
          {applied ? (
            <p className="text-sm text-success">
              ✓ Added {applied.length} machines + {result.plan.imports.length}{" "}
              logistics link
              {result.plan.imports.length === 1 ? "" : "s"} to this factory.
            </p>
          ) : (
            <p className="text-xs text-fg-muted">
              Apply will add {result.plan.totalMachines} machines and{" "}
              {result.plan.imports.length} logistics link
              {result.plan.imports.length === 1 ? "" : "s"} to this factory.
            </p>
          )}
          {!applied && (
            <Button onClick={apply} disabled={applyPending}>
              {applyPending ? "Applying…" : "Apply to this factory"}
            </Button>
          )}
        </div>
      )}
      {applyError && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {applyError}
        </p>
      )}
    </Card>
  );
}

function PlannerErrorStrip({ error }: { error: PlannerError }) {
  return (
    <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
      {error.kind === "unknownTarget" && (
        <p>Unknown target item: {error.itemId}</p>
      )}
      {error.kind === "noRecipeForTarget" && (
        <p>
          No recipe produces {error.itemId} — it's a raw resource (claim a
          node) or out of dataset.
        </p>
      )}
      {error.kind === "cycleDetected" && (
        <p>Recipe graph has a cycle involving {error.itemId} — please report.</p>
      )}
      {error.kind === "insufficient" && (
        <div>
          <p className="font-semibold text-danger">Insufficient supply</p>
          {Object.keys(error.missing).length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {Object.entries(error.missing).map(([id, ipm]) => (
                <li key={id} className="tabular-nums">
                  {id.replace(/^Desc_/, "").replace(/_C$/, "")} — short{" "}
                  {Math.ceil(ipm)}/min raw supply (claim more nodes)
                </li>
              ))}
            </ul>
          )}
          {Object.keys(error.imports).length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {Object.entries(error.imports).map(([id, ipm]) => (
                <li key={id} className="tabular-nums">
                  {id.replace(/^Desc_/, "").replace(/_C$/, "")} — pinned
                  source short {ipm.toFixed(1)}/min
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
