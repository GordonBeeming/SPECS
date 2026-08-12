import { useCallback, useEffect, useRef } from "react";

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

  const { mutate } = raise;
  const importFromProducer = useCallback(
    (itemId: string, source: ExistingProducerSource, localIpm: number) => {
      const { raiseIpm } = planImportFromProducer(source, localIpm);
      if (raiseIpm == null) {
        addExternalSource(itemId, source.factoryId, null);
        return;
      }
      mutate(
        { exporterFactoryId: source.factoryId, itemId, neededIpm: raiseIpm },
        {
          onSuccess: (result) => {
            onRaisedRef.current(result);
            addExternalSource(itemId, source.factoryId, null);
          },
        },
      );
    },
    [mutate, addExternalSource],
  );

  return {
    importFromProducer,
    /** The item mid-raise, so its offer can show it's working. */
    pendingItemId: raise.isPending ? raise.variables?.itemId ?? null : null,
    error: raise.error,
  };
}
