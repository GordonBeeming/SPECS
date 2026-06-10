import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { plannerApi } from "@/features/planner/api";
import type {
  ComputePlanResult,
  FactoryPlan,
  PlanImportSpec,
  PlanTargetSpec,
  PlannerError,
  SavePlanResult,
} from "@/features/planner/types";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";

/** Compute is debounced so slider scrubs / fast typing don't queue a
 * Tauri round-trip per keystroke. 250 ms keeps the graph feeling live. */
const COMPUTE_DEBOUNCE_MS = 250;

export interface PlanWorkingState {
  targets: PlanTargetSpec[];
  imports: PlanImportSpec[];
  recipeOverrides: Record<string, string>;
}

function workingFromPlan(plan: FactoryPlan): PlanWorkingState {
  return {
    targets: plan.targets.map((t) => ({ ...t })),
    imports: plan.imports.map((i) => ({
      itemId: i.itemId,
      sourceFactoryId: i.sourceFactoryId,
      ipmCap: i.ipmCap,
    })),
    recipeOverrides: { ...plan.recipeOverrides },
  };
}

function statesEqual(a: PlanWorkingState, b: PlanWorkingState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The designer's brain: loads the saved plan, holds the working copy,
 * recomputes the graph (debounced) on every edit, and saves with a
 * grouped undo (reverse = re-save the previously persisted inputs).
 */
export function usePlanDesigner(factoryId: string) {
  const playthrough = useCurrentPlaythrough();
  const queryClient = useQueryClient();

  const planQuery = useQuery({
    queryKey: [...queryKeys.factory.plan(factoryId), playthrough.data?.id ?? null] as const,
    queryFn: () => plannerApi.getPlan(factoryId),
    enabled: !!playthrough.data,
  });

  const [working, setWorking] = useState<PlanWorkingState | null>(null);
  const [compute, setCompute] = useState<ComputePlanResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the working copy from the persisted plan exactly once per
  // factory load — later refetches (e.g. after save) must not clobber
  // in-flight edits.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!planQuery.data) return;
    if (seededFor.current === factoryId) return;
    seededFor.current = factoryId;
    setWorking(workingFromPlan(planQuery.data));
  }, [planQuery.data, factoryId]);
  useEffect(() => {
    // Switching factories resets the seed gate so the new plan loads.
    if (seededFor.current !== factoryId) {
      seededFor.current = null;
      setWorking(null);
      setCompute(null);
    }
  }, [factoryId]);

  // Debounced recompute on every working-state change.
  useEffect(() => {
    if (!working) return;
    if (working.targets.length === 0) {
      setCompute({
        kind: "ok",
        graph: {
          nodes: [],
          edges: [],
          totalMachines: 0,
          totalPowerMw: 0,
          rawDemand: {},
          warnings: [],
        },
      });
      return;
    }
    setComputing(true);
    // The cleanup cancels both the pending timeout AND any in-flight
    // response — switching factories mid-compute must not paint the
    // previous factory's graph over the new one.
    let cancelled = false;
    const handle = window.setTimeout(() => {
      plannerApi
        .computePlan({
          factoryId,
          targets: working.targets,
          imports: working.imports,
          recipeOverrides: working.recipeOverrides,
        })
        .then((r) => {
          if (!cancelled) setCompute(r);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          // Transport-level failure (not a PlannerError) — surface it
          // like a structural error so the banner shows something.
          console.error("plan compute failed:", err);
          setCompute({
            kind: "err",
            error: { kind: "unknownTarget", itemId: String(err) } as PlannerError,
          });
        })
        .finally(() => {
          if (!cancelled) setComputing(false);
        });
    }, COMPUTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [working, factoryId]);

  const persisted = planQuery.data;
  const dirty = useMemo(() => {
    if (!working || !persisted) return false;
    return !statesEqual(working, workingFromPlan(persisted));
  }, [working, persisted]);

  const update = useCallback((fn: (prev: PlanWorkingState) => PlanWorkingState) => {
    setWorking((prev) => (prev ? fn(prev) : prev));
  }, []);

  const addTarget = useCallback(
    (itemId: string, ipm = 60) =>
      update((prev) =>
        prev.targets.some((t) => t.itemId === itemId)
          ? prev
          : { ...prev, targets: [...prev.targets, { itemId, ipm, exportIpm: null }] },
      ),
    [update],
  );

  const removeTarget = useCallback(
    (itemId: string) =>
      update((prev) => ({
        ...prev,
        targets: prev.targets.filter((t) => t.itemId !== itemId),
      })),
    [update],
  );

  const setTargetIpm = useCallback(
    (itemId: string, ipm: number) =>
      update((prev) => ({
        ...prev,
        targets: prev.targets.map((t) => (t.itemId === itemId ? { ...t, ipm } : t)),
      })),
    [update],
  );

  /** Set / clear how much of a target is offered for export. */
  const setTargetExport = useCallback(
    (itemId: string, exportIpm: number | null) =>
      update((prev) => ({
        ...prev,
        targets: prev.targets.map((t) =>
          t.itemId === itemId ? { ...t, exportIpm } : t,
        ),
      })),
    [update],
  );

  /**
   * Add an external source for an item. The first external also adds
   * the self row ("build it here") so local production continues —
   * external caps reduce what the local line builds.
   */
  const addExternalSource = useCallback(
    (itemId: string, sourceFactoryId: string | null, ipmCap: number | null) =>
      update((prev) => {
        const hasAny = prev.imports.some((i) => i.itemId === itemId);
        const selfRow = { itemId, sourceFactoryId: factoryId, ipmCap: null };
        const next = [...prev.imports];
        if (!hasAny) next.push(selfRow);
        next.push({ itemId, sourceFactoryId, ipmCap });
        return { ...prev, imports: next };
      }),
    [update, factoryId],
  );

  /** Remove the local line — everything imports (the full cut). */
  const removeLocalSource = useCallback(
    (itemId: string) =>
      update((prev) => ({
        ...prev,
        imports: prev.imports.filter(
          (i) => !(i.itemId === itemId && i.sourceFactoryId === factoryId),
        ),
      })),
    [update, factoryId],
  );

  /** Bring the local line back ("build it here"). */
  const addLocalSource = useCallback(
    (itemId: string) =>
      update((prev) =>
        prev.imports.some(
          (i) => i.itemId === itemId && i.sourceFactoryId === factoryId,
        )
          ? prev
          : {
              ...prev,
              imports: [
                ...prev.imports,
                { itemId, sourceFactoryId: factoryId, ipmCap: null },
              ],
            },
      ),
    [update, factoryId],
  );

  /** Drop every source row for the item — pure local production. */
  const clearSources = useCallback(
    (itemId: string) =>
      update((prev) => ({
        ...prev,
        imports: prev.imports.filter((i) => i.itemId !== itemId),
      })),
    [update],
  );

  const setImportSource = useCallback(
    (itemId: string, index: number, sourceFactoryId: string | null) =>
      update((prev) => {
        let n = -1;
        return {
          ...prev,
          imports: prev.imports.map((imp) => {
            if (imp.itemId !== itemId) return imp;
            n += 1;
            return n === index ? { ...imp, sourceFactoryId } : imp;
          }),
        };
      }),
    [update],
  );

  const setImportCap = useCallback(
    (itemId: string, index: number, ipmCap: number | null) =>
      update((prev) => {
        let n = -1;
        return {
          ...prev,
          imports: prev.imports.map((imp) => {
            if (imp.itemId !== itemId) return imp;
            n += 1;
            return n === index ? { ...imp, ipmCap } : imp;
          }),
        };
      }),
    [update],
  );

  const removeImportSource = useCallback(
    (itemId: string, index: number) =>
      update((prev) => {
        let n = -1;
        return {
          ...prev,
          imports: prev.imports.filter((imp) => {
            if (imp.itemId !== itemId) return true;
            n += 1;
            return n !== index;
          }),
        };
      }),
    [update],
  );

  const setRecipeOverride = useCallback(
    (itemId: string, recipeId: string) =>
      update((prev) => ({
        ...prev,
        recipeOverrides: { ...prev.recipeOverrides, [itemId]: recipeId },
      })),
    [update],
  );

  const invalidateAfterSave = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.factory.plan(factoryId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.factory.detail(factoryId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.factory.list });
    queryClient.invalidateQueries({ queryKey: queryKeys.factory.ledger(factoryId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.factory.unsourcedInputs });
    queryClient.invalidateQueries({ queryKey: queryKeys.logistics.list });
    queryClient.invalidateQueries({ queryKey: ["factory", "machine-layouts", factoryId] });
  }, [queryClient, factoryId]);

  const save = useCallback(async (): Promise<SavePlanResult | null> => {
    if (!working) return null;
    const next = working;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await plannerApi.savePlan({
        factoryId,
        targets: next.targets,
        imports: next.imports,
        recipeOverrides: next.recipeOverrides,
      });
      invalidateAfterSave();
      return result;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, [working, factoryId, invalidateAfterSave]);

  // Background autosave: once edits settle (and the graph computed
  // without a structural error), persist — leaving the screen can't
  // lose work. The save itself re-runs compute server-side.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    if (!dirty || saving) return;
    if (!compute || compute.kind !== "ok") return;
    const handle = window.setTimeout(() => {
      void saveRef.current();
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [dirty, saving, compute]);

  /** Awaitable flush for navigation (Back). */
  const flush = useCallback(async () => {
    if (dirty) {
      await saveRef.current();
    }
  }, [dirty]);

  return {
    planQuery,
    working,
    compute,
    computing,
    dirty,
    saving,
    saveError,
    layout: planQuery.data?.layout ?? [],
    addTarget,
    removeTarget,
    setTargetIpm,
    setTargetExport,
    addExternalSource,
    removeLocalSource,
    addLocalSource,
    clearSources,
    setImportSource,
    setImportCap,
    removeImportSource,
    setRecipeOverride,
    save,
    flush,
  };
}
