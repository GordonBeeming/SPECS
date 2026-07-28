import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/shared/query/keys";
import { plannerApi } from "../api";

/**
 * Every item's whole-chain tier, keyed by item id. Derived from the
 * bundled dataset alone, so it never goes stale within a session —
 * cached forever like the rest of the library reads.
 */
export function useItemTiers() {
  return useQuery({
    queryKey: queryKeys.planner.itemTiers,
    queryFn: plannerApi.listItemTiers,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
