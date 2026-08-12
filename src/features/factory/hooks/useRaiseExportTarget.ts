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
 * The tail of each exporter's chain of in-flight raises.
 *
 * Keyed by exporter because that is the width of the write: a raise
 * reads the exporter's whole plan, rewrites the one target being raised
 * and saves every target back, so two against the same exporter means
 * the second save carries the first's stale targets and silently drops
 * it. Two against *different* exporters touch different plans and are
 * free to overlap, which is why this is a map and not one queue.
 *
 * Module-level, rather than a ref or a context, because the writers
 * that need ordering do not share a React tree: the graph's "import
 * instead" and the Sources panel's "Raise target" are separate hook
 * instances reachable on screen at the same time. Anything React-scoped
 * hands each of them its own queue and leaves exactly the race the
 * queue exists to close.
 *
 * Module scope is as wide as this goes, and it is not the whole of the
 * race. A popped-out factory loads the app again in its own webview, so
 * it gets its own copy of this map and can raise against an exporter
 * the main window is already raising. Closing that needs the backend to
 * hold the read-modify-write under one lock; a JS queue cannot reach
 * across realms.
 */
const raiseQueues = new Map<string, Promise<void>>();

function enqueueRaise(
  exporterFactoryId: string,
  raise: () => Promise<RaiseExportTargetResult>,
): Promise<RaiseExportTargetResult> {
  const tail = raiseQueues.get(exporterFactoryId) ?? Promise.resolve();
  const result = tail.then(raise);
  // Whatever queues behind this one chains onto a promise that cannot
  // reject, so a raise that fails hands its error to its own caller
  // without wedging every later raise against that exporter.
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  raiseQueues.set(exporterFactoryId, settled);
  void settled.then(() => {
    // Only the last raise clears the entry. Anything that queued up
    // while this one ran is the tail now and still has to be waited on,
    // and dropping it would let the next click run alongside it.
    if (raiseQueues.get(exporterFactoryId) === settled) {
      raiseQueues.delete(exporterFactoryId);
    }
  });
  return result;
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
 *
 * Raises against one exporter run one at a time however fast they are
 * asked for, and the gate is the mutation itself so no caller can go
 * round it. Clicks are still accepted while one is running: they queue,
 * the caller sees the mutation as pending the whole time, and an offer
 * from an unrelated factory is never walled off waiting on it.
 */
export function useRaiseExportTarget(beneficiaryFactoryId: string) {
  const queryClient = useQueryClient();
  return useMutation<RaiseExportTargetResult, Error, RaiseExportTargetVars>({
    mutationFn: (vars) =>
      enqueueRaise(vars.exporterFactoryId, () =>
        plannerApi.raiseExportTarget(
          vars.exporterFactoryId,
          vars.itemId,
          vars.neededIpm,
          beneficiaryFactoryId,
        ),
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
