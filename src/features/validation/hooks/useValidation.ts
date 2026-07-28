import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
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
 *
 * The report is scoped to whichever playthrough is open in the backend,
 * so the cache key is too — same pattern every other per-playthrough
 * hook uses — otherwise switching playthroughs can briefly serve the
 * previous run's report.
 */
export function useValidation(enabled = true) {
  const playthrough = useCurrentPlaythrough();
  const ptId = playthrough.data?.id ?? null;
  return useQuery({
    queryKey: [...queryKeys.validation.sweep, ptId] as const,
    queryFn: validationApi.validate,
    enabled: enabled && !!playthrough.data,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}
