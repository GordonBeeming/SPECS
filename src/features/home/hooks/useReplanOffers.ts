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

/**
 * Take one factory's offer. Rebuilds that factory's machines, so
 * everything downstream of a plan save has to be refreshed the same way
 * the designer's own save refreshes it — a stale ledger here would show
 * the old power figure next to the new plan.
 */
export function useApplyReplanOffer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (factoryId: string) => plannerApi.reoptimize(factoryId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["factory"] });
      client.invalidateQueries({ queryKey: queryKeys.logistics.list });
      client.invalidateQueries({ queryKey: queryKeys.planner.replanOffers });
    },
  });
}
