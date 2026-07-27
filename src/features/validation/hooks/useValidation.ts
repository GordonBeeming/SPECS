import { useQuery } from "@tanstack/react-query";

import { validationApi } from "../api";

/**
 * On-demand sweep. A query (not a mutation fired from an effect) so
 * Strict Mode's double-mount dedupes into one backend sweep; `gcTime: 0`
 * drops the cached report once the last subscriber unmounts, so a fresh
 * Validate-panel open is always a fresh sweep — the report is a
 * snapshot, never background-refreshed (it walks every factory's plan,
 * so polling it would be rude). `enabled` lets a caller that only wants
 * *some* findings (e.g. Resources' port-capacity flag) skip the sweep
 * until it actually has something to read it against, such as an
 * active playthrough.
 */
export function useValidation(enabled = true) {
  return useQuery({
    queryKey: ["validation-sweep"],
    queryFn: validationApi.validate,
    enabled,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}
