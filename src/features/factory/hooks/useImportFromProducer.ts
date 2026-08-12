import { useCallback, useEffect, useRef, useState } from "react";

import type { ExistingProducerSource, RaiseExportTargetResult } from "@/features/planner/types";

import { planImportFromProducer } from "../importOffer";
import { useRaiseExportTarget } from "./useRaiseExportTarget";

export interface UseImportFromProducerOptions {
  /** The factory doing the importing. */
  factoryId: string;
  /** `usePlanDesigner`'s source-row writer. */
  addExternalSource: (
    itemId: string,
    sourceFactoryId: string | null,
    ipmCap: number | null,
  ) => void;
  /** Told about every raise this made, for the designer's running tally. */
  onRaised: (result: RaiseExportTargetResult) => void;
}

const NO_PENDING: ReadonlySet<string> = new Set();

/**
 * The graph's one-click "import instead", end to end.
 *
 * Taking a producer up on its offer is two writes in two different
 * factories, in one order: the producer's export slice has to exist
 * before this plan's uncapped source row is added, because the row
 * resolves to whatever the producer currently offers. Adding first
 * lands a row supplying 0/min, which leaves the local line building
 * everything and the screen byte-identical to before the click — and a
 * logistics link the exporter never agreed to, which the validation
 * sweep reports as "exports cover 0.0" from the other side.
 *
 * Raises run one at a time, however fast the offers are clicked. A
 * raise is a read-modify-write of the exporter's whole plan — it reads
 * every target, rewrites the one being raised and saves the lot — so
 * two in flight against the same producer means the second one's save
 * carries the first one's stale targets and silently drops it. Clicks
 * are still accepted while one is running: they queue, and an offer
 * from an unrelated factory is never walled off just because some
 * other raise hasn't come back yet.
 */
export function useImportFromProducer({
  factoryId,
  addExternalSource,
  onRaised,
}: UseImportFromProducerOptions) {
  const raise = useRaiseExportTarget(factoryId);
  // Held by ref so a caller passing an inline handler (the common case)
  // doesn't re-create the click handler on every render of the graph.
  const onRaisedRef = useRef(onRaised);
  useEffect(() => {
    onRaisedRef.current = onRaised;
  }, [onRaised]);

  const [pendingItemIds, setPendingItemIds] = useState<ReadonlySet<string>>(NO_PENDING);
  // Owned here rather than read off the mutation: the mutation only
  // remembers its latest call, so a queued raise starting would wipe
  // the message from the one that just failed before it was read.
  const [error, setError] = useState<Error | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const { mutateAsync } = raise;
  const importFromProducer = useCallback(
    (itemId: string, source: ExistingProducerSource, localIpm: number) => {
      const { raiseIpm } = planImportFromProducer(source, localIpm);
      if (raiseIpm == null) {
        addExternalSource(itemId, source.factoryId, null);
        return;
      }
      setError(null);
      setPendingItemIds((prev) => new Set(prev).add(itemId));
      // The queue only ever grows by chaining onto a promise that
      // cannot reject, so one failed raise can't strand the ones behind
      // it. What each raise asks for was decided from the offer as it
      // read at click time; that stays right while it waits, because
      // `neededIpm` is this factory's own demand and the backend
      // re-measures the producer's spare when the raise actually runs.
      queueRef.current = queueRef.current.then(async () => {
        try {
          const result = await mutateAsync({
            exporterFactoryId: source.factoryId,
            itemId,
            neededIpm: raiseIpm,
          });
          onRaisedRef.current(result);
          addExternalSource(itemId, source.factoryId, null);
        } catch (e) {
          setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
          setPendingItemIds((prev) => {
            const next = new Set(prev);
            next.delete(itemId);
            return next;
          });
        }
      });
    },
    [mutateAsync, addExternalSource],
  );

  return {
    importFromProducer,
    /** Items mid-raise or waiting behind one, so their offers can show it. */
    pendingItemIds,
    error,
  };
}
