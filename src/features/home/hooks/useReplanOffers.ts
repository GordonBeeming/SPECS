import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { plannerApi } from "@/features/planner/api";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { queryKeys } from "@/shared/query/keys";

/**
 * Factories whose plan would come out different if it were re-solved at
 * the current tier. Keyed on the tier as well as the playthrough,
 * because reaching a tier is exactly what creates and retires these.
 */
export function useReplanOffers() {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [
      ...queryKeys.planner.replanOffers,
      playthrough.data?.id ?? null,
      playthrough.data?.currentTier ?? null,
    ] as const,
    queryFn: plannerApi.listReplanOffers,
    enabled: !!playthrough.data,
  });
}

/** Rebuilding a factory's machines moves everything a plan save moves,
 * so both directions of the offer have to refresh what the designer's
 * own save refreshes — a stale ledger would show the old power figure
 * next to the new plan. */
function invalidateAfterReplan(client: ReturnType<typeof useQueryClient>) {
  client.invalidateQueries({ queryKey: ["factory"] });
  client.invalidateQueries({ queryKey: queryKeys.logistics.list });
  client.invalidateQueries({ queryKey: queryKeys.planner.replanOffers });
}

/**
 * Take one factory's offer. Returns the recipes the re-solve dropped,
 * which is what the Undo beside it hands to `useUndoReplanOffer`.
 */
export function useApplyReplanOffer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (factoryId: string) => plannerApi.reoptimize(factoryId),
    onSuccess: () => invalidateAfterReplan(client),
  });
}

/**
 * Put a taken offer back. The recipes come from the apply that dropped
 * them rather than from a fresh solve, because re-solving is exactly
 * what produced the plan being undone.
 */
export function useUndoReplanOffer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { factoryId: string; recipes: Record<string, string> }) =>
      plannerApi.restorePlanRecipes(vars.factoryId, vars.recipes),
    onSuccess: () => invalidateAfterReplan(client),
  });
}
