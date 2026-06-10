import { useMemo } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { useItems, useRecipes } from "@/features/library/hooks/useLibrary";
import { useUnlockedAlts } from "@/features/alts/hooks/useAlts";
import { buildRecipesByOutput } from "@/features/planner/options";
import type { PlanImportSpec } from "@/features/planner/types";

import { useFactoryDetail, useFactoryList } from "../../hooks/useFactories";
import { usePlanDesigner } from "../../hooks/usePlanDesigner";
import { PlanGraphCanvas } from "./PlanGraphCanvas";
import { PlanTargetsBar } from "./PlanTargetsBar";
import { errorLine, PlanWarningsBanner } from "./PlanWarningsBanner";

export interface PlanDesignerViewProps {
  factoryId: string;
  onBack: () => void;
}

/**
 * The full-screen production-plan designer. Outcome-first: pick what
 * the factory should make, the graph computes itself; the only verb
 * is "Save plan".
 */
export function PlanDesignerView({ factoryId, onBack }: PlanDesignerViewProps) {
  const detail = useFactoryDetail(factoryId);
  const factories = useFactoryList();
  const items = useItems();
  const recipes = useRecipes();
  const unlockedAlts = useUnlockedAlts();
  const designer = usePlanDesigner(factoryId);

  const itemNames = useMemo(
    () => new Map(items.data?.map((i) => [i.id, i.name]) ?? []),
    [items.data],
  );
  const factoryNames = useMemo(
    () => new Map(factories.data?.map((f) => [f.id, f.name]) ?? []),
    [factories.data],
  );
  const factoryOptions = useMemo(
    () =>
      (factories.data ?? [])
        .filter((f) => f.id !== factoryId)
        .map((f) => ({ value: f.id, label: f.name })),
    [factories.data, factoryId],
  );
  const recipesByOutput = useMemo(
    () => buildRecipesByOutput(recipes.data, unlockedAlts.data),
    [recipes.data, unlockedAlts.data],
  );
  const importsByItem = useMemo(() => {
    const map = new Map<string, PlanImportSpec[]>();
    for (const imp of designer.working?.imports ?? []) {
      const arr = map.get(imp.itemId) ?? [];
      arr.push(imp);
      map.set(imp.itemId, arr);
    }
    return map;
  }, [designer.working]);

  const graph = designer.compute?.kind === "ok" ? designer.compute.graph : null;
  const computeError = designer.compute?.kind === "err" ? designer.compute.error : null;
  const working = designer.working;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" onClick={onBack} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h2 className="text-lg font-semibold text-fg">
          {detail.data?.factory.name ?? "…"}
          <span className="ml-2 text-sm font-normal text-fg-muted">Production plan</span>
        </h2>
        <div className="ml-auto flex items-center gap-3 text-sm tabular-nums text-fg-muted">
          {graph && graph.nodes.length > 0 && (
            <span>
              {graph.totalMachines} machines · {graph.totalPowerMw.toFixed(1)} MW
            </span>
          )}
          {designer.computing && <Loader2 className="h-4 w-4 animate-spin" aria-label="Computing" />}
          <Button
            onClick={() => void designer.save()}
            disabled={!designer.dirty || designer.saving || !working}
          >
            <Save className="h-4 w-4" />
            {designer.saving ? "Saving…" : designer.dirty ? "Save plan" : "Saved"}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        {working ? (
          <PlanTargetsBar
            targets={working.targets}
            itemNames={itemNames}
            onAddTarget={designer.addTarget}
            onRemoveTarget={designer.removeTarget}
            onSetTargetIpm={designer.setTargetIpm}
          />
        ) : (
          <div className="text-sm text-fg-muted">Loading plan…</div>
        )}
        {designer.saveError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            Couldn't save: {designer.saveError}
          </div>
        )}
        {computeError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {errorLine(computeError)}
          </div>
        )}
        {graph && <PlanWarningsBanner warnings={graph.warnings} />}
      </div>

      <div className="min-h-0 flex-1">
        {working && working.targets.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-md text-center">
              <h3 className="text-lg font-semibold text-fg">What should this factory make?</h3>
              <p className="mt-2 text-sm text-fg-muted">
                Add a product above and the production graph builds itself — swap recipes on
                any step, or mark a step as supplied from another factory (now or later).
              </p>
            </div>
          </div>
        ) : graph ? (
          <PlanGraphCanvas
            factoryId={factoryId}
            graph={graph}
            layout={designer.layout}
            recipesByOutput={recipesByOutput}
            factoryOptions={factoryOptions}
            factoryNames={factoryNames}
            importsByItem={importsByItem}
            onSwapRecipe={designer.setRecipeOverride}
            onSupplyFromElsewhere={designer.cutToImport}
            onBuildHere={designer.buildHere}
            onSetImportSource={designer.setImportSource}
            onSetImportCap={designer.setImportCap}
            onAddImportSource={designer.addImportSource}
            onRemoveImportSource={designer.removeImportSource}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            {designer.planQuery.isError
              ? "Couldn't load this factory's plan."
              : "Computing the production graph…"}
          </div>
        )}
      </div>
    </div>
  );
}
