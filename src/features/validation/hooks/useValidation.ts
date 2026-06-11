import { useQuery } from "@tanstack/react-query";

import { validationApi } from "../api";

/**
 * On-demand sweep. A query (not a mutation fired from an effect) so
 * Strict Mode's double-mount dedupes into one backend sweep; `gcTime: 0`
 * drops the cached report when the panel closes, so every open is a
 * fresh sweep — the report is a snapshot, never background-refreshed
 * (it walks every factory's plan, so polling it would be rude).
 */
export function useValidation() {
  return useQuery({
    queryKey: ["validation-sweep"],
    queryFn: validationApi.validate,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}
