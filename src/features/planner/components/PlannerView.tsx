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
import { ChainPreview } from "./ChainPreview";
import { ClaimMissingModal } from "./ClaimMissingModal";

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
        <PlannerErrorPanel
          error={result.error}
          items={items.data ?? []}
          nodes={nodes.data ?? []}
          onAfterClaim={async () => {
            await nodes.refetch();
            // Auto-rederive so the player sees the chain unlock as soon
            // as their newly-claimed supply covers the gap, without a
            // second manual "Derive" click.
            await derive();
          }}
        />
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
  nodes,
  onAfterClaim,
}: {
  error: PlannerError;
  items: { id: string; name: string }[];
  nodes: import("@/features/resources/types").ResourceNodeRow[];
  onAfterClaim: () => void;
}) {
  const [claimingFor, setClaimingFor] = useState<{
    id: string;
    name: string;
    ipm: number;
  } | null>(null);
  if (error.kind === "insufficient") {
    return (
      <>
        <Card>
          <h2 className="text-base font-semibold text-danger">
            Insufficient supply
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            The chain needs more raw supply than you've claimed. Claim more
            nodes inline — no need to leave the planner:
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {Object.entries(error.missing).map(([id, ipm]) => {
              const name = items.find((i) => i.id === id)?.name ?? id;
              const unclaimedCount = nodes.filter(
                (n) => n.resourceItemId === id && !n.claim,
              ).length;
              return (
                <li
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg/40 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon itemId={id} alt={name} className="h-4 w-4" />
                    <span className="font-medium">{name}</span>
                    <span className="text-xs text-fg-muted">
                      needs {Math.ceil(ipm)} more ipm
                    </span>
                  </div>
                  {unclaimedCount > 0 ? (
                    <Button
                      onClick={() =>
                        setClaimingFor({ id, name, ipm })
                      }
                      className="px-3 py-1 text-xs"
                    >
                      Claim a node ({unclaimedCount} left)
                    </Button>
                  ) : (
                    <span className="text-xs text-fg-muted">
                      none unclaimed
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
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
      </>
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

      <div className="mt-4">
        <ChainPreview plan={plan} nodes={nodes} />
      </div>
    </Card>
  );
}
