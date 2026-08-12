import { useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";

import { factoryApi } from "@/features/factory/api";
import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useExtractedResources, useRecipes } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { queryKeys } from "@/shared/query/keys";
import type { FactoryLedger } from "@/features/factory/types";

import { rawRequirements, shortfallsByItem, type ShortfallsByItem } from "../shortfalls";

export interface FactoryShortfalls {
  byItem: ShortfallsByItem;
  /** True until every ledger has answered. "Nobody wants this ore" and
   * "we haven't looked yet" are different answers, and only one of them
   * justifies falling back to distance alone. */
  pending: boolean;
}

/**
 * Which factories are still short of which raw resource, across the
 * whole playthrough.
 *
 * The map's factory card answers this for the one factory it has open,
 * off that factory's ledger. The claim popup has to answer it for a
 * node the player just clicked, before any card is open, so it needs
 * every factory's ledger rather than one. `factory_ledger` is the cheap
 * half of `get_factory_detail` (no machine rows), the queries key off
 * the same `queryKeys.factory.ledger` a plan save already invalidates,
 * and they load with the rest of the map — long before a marker gets
 * clicked.
 */
export function useFactoryShortfalls(): FactoryShortfalls {
  const playthrough = useCurrentPlaythrough();
  const factories = useFactoryList();
  const recipes = useRecipes();
  const extracted = useExtractedResources();

  const factoryIds = useMemo(
    () => (factories.data ?? []).map((f) => f.id),
    [factories.data],
  );

  const ledgers = useQueries({
    queries: factoryIds.map((id) => ({
      queryKey: [...queryKeys.factory.ledger(id), playthrough.data?.id ?? null] as const,
      queryFn: () => factoryApi.ledger(id),
      enabled: !!playthrough.data,
    })),
  });

  // `useQueries` hands back a fresh array on every render, so a memo
  // keyed on it would re-walk the recipe graph on every pan and zoom of
  // the map. `dataUpdatedAt` moves only when a ledger actually lands,
  // which is the one moment the rollup can change — `settledRef` then
  // carries the data itself past the dependency check.
  const settledRef = useRef<FactoryLedger[]>([]);
  settledRef.current = ledgers.flatMap((q) => (q.data ? [q.data] : []));
  const dataStamp = ledgers.map((q) => q.dataUpdatedAt).join("|");
  const anyLedgerPending = ledgers.some((q) => q.isPending);

  const byItem = useMemo(() => {
    if (!recipes.data || !extracted.data) return new Map<string, Set<string>>();
    const extractedSet = new Set(extracted.data);
    return shortfallsByItem(
      settledRef.current.map((ledger) => ({
        factoryId: ledger.factoryId,
        requirements: rawRequirements(ledger, recipes.data, extractedSet),
      })),
    );
  }, [dataStamp, recipes.data, extracted.data]);

  return {
    byItem,
    pending:
      factories.isPending || recipes.isPending || extracted.isPending || anyLedgerPending,
  };
}
