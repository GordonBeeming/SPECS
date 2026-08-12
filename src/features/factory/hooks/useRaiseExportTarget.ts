import { useMutation, useQueryClient } from "@tanstack/react-query";

import { plannerApi } from "@/features/planner/api";
import type { RaiseExportTargetResult } from "@/features/planner/types";
import { queryKeys } from "@/shared/query/keys";

export interface RaiseExportTargetVars {
  /** The factory being asked to open or widen its export slice. */
  exporterFactoryId: string;
  itemId: string;
  /** The spare the caller wants to exist *for itself* — not a delta. */
  neededIpm: number;
}

/**
 * Ask another factory to export enough of an item for this one.
 *
 * A raise moves the exporter's plan, its machines and every link out of
 * it, so the whole derived surface has to be invalidated — the offer
 * list, both factories' plans, the ledger and the link list. Shared
 * because the graph's "import instead" and the Sources panel's "Raise
 * target" are the same write, and an invalidation the two copies
 * disagree on shows up as a panel quoting a number that moved.
 *
 * `beneficiaryFactoryId` is the factory asking; the backend discounts
 * its own existing draw, so topping up a source already supplying you
 * is asked for as the total you want, not the difference.
 */
export function useRaiseExportTarget(beneficiaryFactoryId: string) {
  const queryClient = useQueryClient();
  return useMutation<RaiseExportTargetResult, Error, RaiseExportTargetVars>({
    mutationFn: (vars) =>
      plannerApi.raiseExportTarget(
        vars.exporterFactoryId,
        vars.itemId,
        vars.neededIpm,
        beneficiaryFactoryId,
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.exportOffers });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.plan(result.factoryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.detail(result.factoryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.ledger(result.factoryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.list });
      queryClient.invalidateQueries({ queryKey: queryKeys.factory.unsourcedInputs });
      queryClient.invalidateQueries({ queryKey: queryKeys.logistics.list });
    },
  });
}
