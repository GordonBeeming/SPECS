import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { queryKeys } from "@/shared/query/keys";

import { logisticsApi } from "../api";
import type {
  CreateLogisticsLinkInput,
  PlanInput,
  UpdateLogisticsLinkInput,
} from "../types";

/**
 * Same gating story as the factory slice: the Rust commands return
 * `Invalid("no active playthrough")` when none is open, and an eager
 * unconditional query would land that error in the cache. Including the
 * playthrough id in the query key also makes the cache per-playthrough,
 * so switching wipes the previous run's links rather than showing them
 * under the new name.
 */
export function useLogisticsLinks() {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [...queryKeys.logistics.list, playthrough.data?.id ?? null] as const,
    queryFn: logisticsApi.list,
    enabled: !!playthrough.data,
  });
}

export function useLogisticsLink(id: string | null | undefined) {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [...queryKeys.logistics.detail(id ?? ""), playthrough.data?.id ?? null] as const,
    queryFn: () => logisticsApi.get(id!),
    enabled: !!id && !!playthrough.data,
  });
}

/**
 * Live planner result for the editor. Re-runs whenever ipm or distance
 * changes; the cache key folds those in so TanStack Query dedupes any
 * in-flight requests at the same throughput. Each keystroke does still
 * mint a new key, so we set a short `gcTime` to garbage-collect stale
 * keys aggressively rather than letting the cache grow unbounded as the
 * user drags a slider or types through a number.
 */
export function usePlanLogistics(input: PlanInput | null) {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [
      ...queryKeys.logistics.plan(
        input?.itemId ?? "",
        input?.itemsPerMinute ?? 0,
        input?.distanceM ?? null,
      ),
      playthrough.data?.id ?? null,
    ] as const,
    queryFn: () => logisticsApi.plan(input!),
    enabled: !!input && !!playthrough.data && input.itemsPerMinute > 0,
    // 30s is enough to survive the user briefly looking away from a
    // half-finished form without growing the cache by hundreds of dead
    // keystroke entries during a single editor session.
    gcTime: 30_000,
  });
}

function invalidateAll(client: ReturnType<typeof useQueryClient>, id?: string) {
  client.invalidateQueries({ queryKey: queryKeys.logistics.list });
  if (id) {
    client.invalidateQueries({ queryKey: queryKeys.logistics.detail(id) });
  }
}

export function useCreateLogisticsLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLogisticsLinkInput) => logisticsApi.create(input),
    onSuccess: (link) => invalidateAll(client, link.id),
  });
}

export function useUpdateLogisticsLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLogisticsLinkInput) => logisticsApi.update(input),
    onSuccess: (link) => invalidateAll(client, link.id),
  });
}

export function useDeleteLogisticsLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => logisticsApi.delete(id),
    onSuccess: () => invalidateAll(client),
  });
}
