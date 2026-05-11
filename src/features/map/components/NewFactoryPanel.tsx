import { useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";

import { useItems, useRecipes } from "@/features/library/hooks/useLibrary";
import { useAddMachine, useCreateFactory, useFactoryList } from "@/features/factory/hooks/useFactories";
import { useResourceNodes } from "@/features/resources/hooks/useResources";
import { plannerApi } from "@/features/planner/api";
import type {
  ChainPlan,
  DeriveChainResult,
  PlannerError,
} from "@/features/planner/types";
import { ClaimMissingModal } from "@/features/planner/components/ClaimMissingModal";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Icon } from "@/shared/ui/Icon";

interface NewFactoryPanelProps {
  onClose: () => void;
  /** Refetched after a successful apply so the new pins land. */
  onApplied: () => void;
}

/**
 * Map-overlay version of the standalone Planner page. Same derive →
 * preview → apply flow, but anchored top-left on the map canvas so
 * the player can:
 *
 *   1. Pick a target (item + ipm)
 *   2. See the chain + raw shortfall inline
 *   3. Claim missing supply right here (re-uses the planner's
 *      ClaimMissingModal)
 *   4. Apply — the chain materialises as factory pins on the map,
 *      ready to be dragged into position.
 *
 * The standalone Planner tab is gone; this is the only way in.
 */
export function NewFactoryPanel({ onClose, onApplied }: NewFactoryPanelProps) {
  const items = useItems();
  const recipes = useRecipes();
  const factories = useFactoryList();
  const nodes = useResourceNodes();
  const createFactory = useCreateFactory();
  const addMachine = useAddMachine();

  const [target, setTarget] = useState<string | null>(null);
  const [targetIpm, setTargetIpm] = useState(60);
  const [namingPrefix, setNamingPrefix] = useState("");
  // Default = single factory. The chain mode (one factory per stage)
  // is overkill when the player just wants 'a Rotor factory I can
  // drag supply into' and was producing 4-stage stacks for things
  // like Rotor that overwhelmed the canvas.
  const [buildFullChain, setBuildFullChain] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DeriveChainResult | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const [applied, setApplied] = useState<string[] | null>(null);
  const [singleError, setSingleError] = useState<string | null>(null);

  // Build the same tier-grouped, supply-aware target-item list the
  // standalone planner used — keeps the picker behaviour identical
  // so the rework is purely about positioning, not functionality.
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
    const effectiveTier = (id: string) =>
      standardTier.get(id) ?? altTier.get(id);
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

  const derive = async (bypassSupply = false) => {
    if (!target) return;
    setPending(true);
    setResult(null);
    setApplied(null);
    try {
      const r = await plannerApi.derive({
        targetItemId: target,
        targetIpm,
        bypassSupply,
      });
      setResult(r);
    } finally {
      setPending(false);
    }
  };

  const apply = async (plan: ChainPlan) => {
    setApplyPending(true);
    try {
      const r = await plannerApi.apply({
        plan,
        namingPrefix: namingPrefix.trim() || plan.targetItemName,
        defaultLinkDistanceM: 1000,
      });
      setApplied(r.factoryIds);
      await factories.refetch();
      onApplied();
    } finally {
      setApplyPending(false);
    }
  };

  /**
   * Single-factory placement — picks the best recipe for the target
   * (non-alt preferred, highest output rate) and creates one factory
   * with one machine row sized to hit the target ipm. No chain. The
   * player wires inputs in afterwards by dragging nodes / factories.
   */
  const placeSingle = async () => {
    if (!target || !items.data || !recipes.data) return;
    setApplyPending(true);
    setSingleError(null);
    try {
      const item = items.data.find((i) => i.id === target);
      const candidates = recipes.data
        .filter(
          (r) =>
            !r.id.startsWith("Recipe_Unpackage") &&
            r.outputs.some((o) => o.itemId === target),
        )
        .map((r) => {
          const out = r.outputs.find((o) => o.itemId === target);
          return { r, rate: out?.perMinute ?? 0 };
        })
        .filter(({ rate }) => rate > 0)
        .sort((a, b) => {
          if (a.r.isAlt !== b.r.isAlt) return a.r.isAlt ? 1 : -1;
          return b.rate - a.rate;
        });
      const chosen = candidates[0];
      if (!chosen) {
        setSingleError("No recipe produces this item.");
        return;
      }
      const perMachine = chosen.rate;
      let machineCount = Math.max(1, Math.ceil(targetIpm / perMachine));
      let clockPct = (targetIpm / (machineCount * perMachine)) * 100;
      if (clockPct < 1) clockPct = 1;
      while (clockPct > 250 && machineCount < 10000) {
        machineCount += 1;
        clockPct = (targetIpm / (machineCount * perMachine)) * 100;
      }
      const factoryName =
        namingPrefix.trim() ||
        `${item?.name ?? target} factory`;
      const f = await createFactory.mutateAsync({ name: factoryName });
      await addMachine.mutateAsync({
        factoryId: f.id,
        buildingId: chosen.r.buildingId,
        recipeId: chosen.r.id,
        count: machineCount,
        clockPct,
        useSomersloop: false,
        somersloopSlotsFilled: 0,
        powerShardCount: 0,
      });
      setApplied([f.id]);
      await factories.refetch();
      onApplied();
    } catch (e) {
      setSingleError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyPending(false);
    }
  };

  const placeAnyway = async () => {
    if (!target) return;
    setApplyPending(true);
    try {
      // Re-derive with bypass so we get a full ChainPlan (the
      // Insufficient result the user is staring at doesn't carry
      // the plan), then apply it. Net effect: pins land on the
      // map immediately and the user binds nodes in via drag-to-
      // link to satisfy the gap.
      const r = await plannerApi.derive({
        targetItemId: target,
        targetIpm,
        bypassSupply: true,
      });
      if (r.kind === "ok") {
        const a = await plannerApi.apply({
          plan: r.plan,
          namingPrefix: namingPrefix.trim() || r.plan.targetItemName,
          defaultLinkDistanceM: 1000,
        });
        setApplied(a.factoryIds);
        await factories.refetch();
        onApplied();
      }
    } finally {
      setApplyPending(false);
    }
  };

  return (
    <Card className="w-[380px] p-4 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Sparkles className="h-4 w-4" />
          New factory chain
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-fg-muted">
        Pick what to make. The chain materialises as factory pins on
        the map — drag them where you want, then drag claimed nodes
        in as inputs.
      </p>

      <div className="mt-3 grid gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">Target item</span>
          <FilterSelect
            options={targetOptions}
            value={target}
            onChange={setTarget}
            placeholder="Pick an item…"
            compact
          />
        </label>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">Per minute</span>
            <input
              type="number"
              min={1}
              step={1}
              value={targetIpm}
              onChange={(e) => setTargetIpm(Math.max(1, Number(e.target.value)))}
              className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">Naming prefix</span>
            <input
              type="text"
              value={namingPrefix}
              placeholder="(target name)"
              onChange={(e) => setNamingPrefix(e.target.value)}
              className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
            />
          </label>
        </div>
        <label className="mt-1 flex items-center gap-2 text-[11px] text-fg-muted">
          <input
            type="checkbox"
            checked={buildFullChain}
            onChange={(e) => {
              setBuildFullChain(e.target.checked);
              setResult(null);
              setApplied(null);
              setSingleError(null);
            }}
          />
          Auto-build supply chain (one factory per stage)
        </label>
        {buildFullChain ? (
          <Button
            onClick={() => void derive()}
            disabled={!target || pending}
            className="mt-1 w-full"
          >
            {pending ? "Deriving…" : "Derive chain"}
          </Button>
        ) : (
          <Button
            onClick={() => void placeSingle()}
            disabled={!target || applyPending}
            className="mt-1 w-full"
          >
            {applyPending ? "Placing…" : "Place factory"}
          </Button>
        )}
        {singleError && (
          <div role="alert" className="mt-2 text-xs text-danger">
            {singleError}
          </div>
        )}
        {applied && !buildFullChain && (
          <div className="mt-2 text-xs text-success">
            ✓ Factory placed — drag the pin where you want it, then drag
            claimed nodes onto it.
          </div>
        )}
      </div>

      {buildFullChain && result?.kind === "err" && (
        <PanelError
          error={result.error}
          items={items.data ?? []}
          nodes={nodes.data ?? []}
          onAfterClaim={async () => {
            await nodes.refetch();
            await derive();
          }}
          onPlaceAnyway={placeAnyway}
          placeAnywayPending={applyPending}
        />
      )}
      {buildFullChain && result?.kind === "ok" && (
        <PanelPreview
          plan={result.plan}
          onApply={() => apply(result.plan)}
          applyPending={applyPending}
          applied={applied}
        />
      )}
    </Card>
  );
}

function PanelError({
  error,
  items,
  nodes,
  onAfterClaim,
  onPlaceAnyway,
  placeAnywayPending,
}: {
  error: PlannerError;
  items: { id: string; name: string }[];
  nodes: import("@/features/resources/types").ResourceNodeRow[];
  onAfterClaim: () => void;
  onPlaceAnyway: () => void;
  placeAnywayPending: boolean;
}) {
  const [claimingFor, setClaimingFor] = useState<{
    id: string;
    name: string;
    ipm: number;
  } | null>(null);
  if (error.kind === "insufficient") {
    return (
      <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 p-2 text-xs">
        <div className="font-semibold text-danger">Insufficient supply</div>
        <ul className="mt-2 space-y-1">
          {Object.entries(error.missing).map(([id, ipm]) => {
            const name = items.find((i) => i.id === id)?.name ?? id;
            const unclaimed = nodes.filter(
              (n) => n.resourceItemId === id && !n.claim,
            ).length;
            return (
              <li key={id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon itemId={id} alt={name} className="h-3.5 w-3.5" />
                  <span className="truncate">{name}</span>
                  <span className="text-fg-muted">
                    needs {Math.ceil(ipm)}/min
                  </span>
                </span>
                {unclaimed > 0 ? (
                  <Button
                    onClick={() => setClaimingFor({ id, name, ipm })}
                    className="px-2 py-0.5 text-[10px]"
                  >
                    Claim ({unclaimed})
                  </Button>
                ) : (
                  <span className="text-fg-muted">none unclaimed</span>
                )}
              </li>
            );
          })}
        </ul>
        {claimingFor && (
          <ClaimMissingModal
            resourceItemId={claimingFor.id}
            resourceItemName={claimingFor.name}
            shortfallIpm={claimingFor.ipm}
            nodes={nodes}
            onClose={() => setClaimingFor(null)}
            onClaimed={onAfterClaim}
          />
        )}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-2">
          <span className="text-[10px] text-fg-muted">
            Or place the pins now and bind supply by dragging nodes onto them.
          </span>
          <Button
            variant="ghost"
            onClick={onPlaceAnyway}
            disabled={placeAnywayPending}
            className="px-2 py-1 text-[10px]"
          >
            {placeAnywayPending ? "Placing…" : "Place anyway"}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
      {error.kind === "unknownTarget" && `Unknown target: ${error.itemId}`}
      {error.kind === "noRecipeForTarget" &&
        `No recipe makes ${error.itemId} — claim a node or pick a different target.`}
      {error.kind === "cycleDetected" &&
        `Cycle in recipe graph at ${error.itemId} — please report.`}
    </div>
  );
}

function PanelPreview({
  plan,
  onApply,
  applyPending,
  applied,
}: {
  plan: ChainPlan;
  onApply: () => void;
  applyPending: boolean;
  applied: string[] | null;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-fg">
          {plan.targetIpm}/min {plan.targetItemName}
        </span>
        <span className="text-fg-muted">
          {plan.stages.length} stages · {plan.totalMachines} machines ·{" "}
          {Math.round(plan.totalPowerMw)} MW
        </span>
      </div>
      <ul className="mt-2 max-h-44 space-y-1 overflow-auto text-[11px]">
        {plan.stages.map((s, i) => (
          <li
            key={`${s.recipeId}-${i}`}
            className="flex items-center justify-between gap-2 rounded border border-border/60 bg-bg/40 px-2 py-1"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                {i + 1}
              </span>
              <Icon itemId={s.outputItemId} alt="" className="h-3.5 w-3.5" />
              <span className="truncate font-medium">{s.recipeName}</span>
            </span>
            <span className="tabular-nums text-fg-muted">
              {s.machineCount}× @ {s.clockPct.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        {applied ? (
          <div className="text-xs text-success">
            ✓ {applied.length} factories materialised
          </div>
        ) : (
          <Button onClick={onApply} disabled={applyPending}>
            {applyPending ? "Applying…" : "Materialise on map"}
          </Button>
        )}
      </div>
    </div>
  );
}
