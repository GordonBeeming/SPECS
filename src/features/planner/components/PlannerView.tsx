import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { useItems, useRecipes } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useResourceNodes } from "@/features/resources/hooks/useResources";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/Icon";

import { plannerApi } from "../api";
import type { ChainPlan, DeriveChainResult, PlannerError } from "../types";

export function PlannerView() {
  const playthrough = useCurrentPlaythrough();
  const items = useItems();
  const recipes = useRecipes();
  const factories = useFactoryList();
  const nodes = useResourceNodes();

  const [target, setTarget] = useState<string | null>(null);
  const [targetIpm, setTargetIpm] = useState(60);
  const [namingPrefix, setNamingPrefix] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<DeriveChainResult | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const [applied, setApplied] = useState<string[] | null>(null);

  // Only items that are produced (not raw-only) — the planner can't
  // chain "give me iron ore" because miners aren't recipes. Group by
  // the earliest *standard* unlock tier so Aluminum Ingot reads as
  // T7 (Aluminum Production milestone) rather than T0 (the
  // Classic-Battery-style alt recipes ship with unlockTier=0 in the
  // dataset because alts unlock via Hard Drive analysis, not the
  // tier system — using their tier here puts every late-game item
  // under "Tier 0" which is exactly the bug we just hit).
  const targetOptions = useMemo(() => {
    if (!items.data || !recipes.data) return [];
    const standardTier = new Map<string, number>();
    const altTier = new Map<string, number>();
    for (const r of recipes.data) {
      // Skip Unpackage_* recipes when computing the "tier" of an item.
      // They're inverse-utility recipes (you only "make" Crude Oil by
      // unpackaging Packaged Oil), all carry unlockTier=0, and using
      // them otherwise drags Empty Canister / Alumina Solution / etc.
      // back to Tier 0 because Unpackage recipes also output the
      // empty canister as a byproduct.
      if (r.id.startsWith("Recipe_Unpackage")) continue;
      const bucket = r.isAlt ? altTier : standardTier;
      for (const o of r.outputs) {
        const cur = bucket.get(o.itemId);
        if (cur === undefined || r.unlockTier < cur) {
          bucket.set(o.itemId, r.unlockTier);
        }
      }
    }
    // Effective tier: prefer the standard recipe's tier; only fall
    // back to the alt if there's no standard recipe at all for this
    // item.
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

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Planner</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to start deriving
          factory chains.
        </p>
      </Card>
    );
  }

  const derive = async () => {
    if (!target) return;
    setPending(true);
    setResult(null);
    setApplied(null);
    try {
      const r = await plannerApi.derive({
        targetItemId: target,
        targetIpm: targetIpm,
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
    } finally {
      setApplyPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
          <Sparkles className="h-4 w-4" />
          Planner
        </h1>
        <p className="text-xs text-fg-muted">
          "I want N of <em>x</em> per minute" → derive a factory chain.
          Picks the highest-throughput recipe whose inputs trace back to
          claimed nodes (Pure Iron Ingot is greyed out without water,
          etc.). On apply, materialises one factory per stage with
          logistics links between them.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_160px_auto]">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">Target item</span>
            <FilterSelect
              options={targetOptions}
              value={target}
              onChange={setTarget}
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
              onChange={(e) => setTargetIpm(Math.max(1, Number(e.target.value)))}
              className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">Naming prefix</span>
            <input
              type="text"
              value={namingPrefix}
              placeholder="(uses target name)"
              onChange={(e) => setNamingPrefix(e.target.value)}
              className="h-9 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
            />
          </label>
          <div className="flex items-end">
            <Button onClick={derive} disabled={!target || pending}>
              {pending ? "Deriving…" : "Derive"}
            </Button>
          </div>
        </div>
      </Card>

      {result?.kind === "err" && (
        <PlannerErrorPanel error={result.error} items={items.data ?? []} />
      )}

      {result?.kind === "ok" && (
        <PlannerPreview
          plan={result.plan}
          nodes={nodes.data ?? []}
          onApply={() => apply(result.plan)}
          applyPending={applyPending}
          applied={applied}
          factoryCount={factories.data?.length ?? 0}
        />
      )}
    </div>
  );
}

function PlannerErrorPanel({
  error,
  items,
}: {
  error: PlannerError;
  items: { id: string; name: string }[];
}) {
  if (error.kind === "insufficient") {
    return (
      <Card>
        <h2 className="text-base font-semibold text-danger">
          Insufficient supply
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          The chain needs more raw supply than you've claimed. Visit
          Resources and claim more nodes for:
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {Object.entries(error.missing).map(([id, ipm]) => {
            const name = items.find((i) => i.id === id)?.name ?? id;
            return (
              <li key={id} className="flex items-center gap-2">
                <Icon itemId={id} alt={name} className="h-4 w-4" />
                <span className="font-medium">{name}</span>
                <span className="text-fg-muted">
                  needs {Math.ceil(ipm)} more ipm
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="text-base font-semibold text-danger">
        Can't plan that
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {error.kind === "unknownTarget" &&
          `Unknown target item: ${error.itemId}`}
        {error.kind === "noRecipeForTarget" &&
          `No recipe produces ${error.itemId} — it's a raw resource (claim a node) or out of dataset.`}
        {error.kind === "cycleDetected" &&
          `Recipe graph has a cycle involving ${error.itemId} — please report.`}
      </p>
    </Card>
  );
}

function PlannerPreview({
  plan,
  nodes,
  onApply,
  applyPending,
  applied,
  factoryCount,
}: {
  plan: ChainPlan;
  nodes: import("@/features/resources/types").ResourceNodeRow[];
  onApply: () => void;
  applyPending: boolean;
  applied: string[] | null;
  factoryCount: number;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">
            {plan.targetIpm}/min {plan.targetItemName}
          </h2>
          <p className="text-xs text-fg-muted">
            {plan.stages.length} stages · {plan.totalMachines} machines ·{" "}
            {Math.round(plan.totalPowerMw)} MW
          </p>
        </div>
        {applied ? (
          <div className="text-sm text-success">
            ✓ Applied — {applied.length} factories created (now{" "}
            {factoryCount} total)
          </div>
        ) : (
          <Button onClick={onApply} disabled={applyPending}>
            {applyPending ? "Applying…" : "Apply to playthrough"}
          </Button>
        )}
      </div>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Stages
      </h3>
      <ol className="mt-2 flex flex-col gap-2">
        {plan.stages.map((s, i) => (
          <li
            key={`${s.recipeId}-${i}`}
            className="rounded-md border border-border bg-bg/50 p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {i + 1}
                </span>
                <Icon itemId={s.outputItemId} className="h-5 w-5" />
                <span className="font-medium">{s.recipeName}</span>
                {s.isAlt && (
                  <span className="rounded-full bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-500">
                    alt
                  </span>
                )}
              </div>
              <div className="text-xs text-fg-muted tabular-nums">
                {s.machineCount}× {s.buildingName} @{" "}
                {s.clockPct.toFixed(0)}% · {Math.round(s.powerMw)} MW
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-fg-muted">in</div>
                <ul className="mt-1 space-y-1">
                  {s.inputs.map((io) => (
                    <li key={io.itemId} className="flex items-center gap-1">
                      <Icon itemId={io.itemId} className="h-3.5 w-3.5" />
                      {io.itemName}
                      <span className="tabular-nums text-fg-muted">
                        × {io.perMinute.toFixed(1)}/min
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-fg-muted">out</div>
                <ul className="mt-1 space-y-1">
                  {s.outputs.map((io) => (
                    <li key={io.itemId} className="flex items-center gap-1">
                      <Icon itemId={io.itemId} className="h-3.5 w-3.5" />
                      {io.itemName}
                      <span className="tabular-nums text-fg-muted">
                        × {io.perMinute.toFixed(1)}/min
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {Object.keys(plan.rawDemand).length > 0 && (
        <div className="mt-4 rounded-md border border-dashed border-border p-3 text-xs">
          <div className="font-semibold uppercase tracking-wide text-fg-muted">
            Raw demand at the leaves
          </div>
          <ul className="mt-1 grid grid-cols-2 gap-1 md:grid-cols-3">
            {Object.entries(plan.rawDemand).map(([id, ipm]) => {
              const supplied = nodes
                .filter((n) => n.resourceItemId === id && n.claim)
                .reduce((s, n) => s + n.itemsPerMinute, 0);
              const ok = supplied >= ipm - 0.5;
              return (
                <li
                  key={id}
                  className="flex items-center gap-1 tabular-nums"
                  title={`Need ${Math.ceil(ipm)} ipm — claimed supply: ${Math.round(supplied)}`}
                >
                  <Icon itemId={id} className="h-3.5 w-3.5" />
                  <span className="truncate">{id.replace(/^Desc_/, "").replace(/_C$/, "")}</span>
                  <span className={ok ? "text-success" : "text-danger"}>
                    {Math.ceil(ipm)}/{Math.round(supplied)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
