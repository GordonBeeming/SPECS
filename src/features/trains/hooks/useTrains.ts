import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { queryKeys } from "@/shared/query/keys";

import { trainsApi } from "../api";
import type {
  AttachLinkToRouteInput,
  CreateTrainRouteInput,
  UpdateTrainRouteInput,
} from "../types";

export function useTrainRoutes() {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [...queryKeys.trains.list, playthrough.data?.id ?? null] as const,
    queryFn: trainsApi.list,
    enabled: !!playthrough.data,
  });
}

export function useTrainRoute(id: string | null | undefined) {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [...queryKeys.trains.detail(id ?? ""), playthrough.data?.id ?? null] as const,
    queryFn: () => trainsApi.detail(id!),
    enabled: !!id && !!playthrough.data,
  });
}

function invalidate(client: ReturnType<typeof useQueryClient>, id?: string) {
  client.invalidateQueries({ queryKey: queryKeys.trains.list });
  if (id) {
    client.invalidateQueries({ queryKey: queryKeys.trains.detail(id) });
  }
  // Attaching a link to a route doesn't change the link itself, but the
  // logistics list shows attached-route info next to each link, so
  // invalidate it too whenever an attach mutation runs.
  client.invalidateQueries({ queryKey: queryKeys.logistics.list });
}

export function useCreateTrainRoute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTrainRouteInput) => trainsApi.create(input),
    onSuccess: (detail) => invalidate(client, detail.route.id),
  });
}

export function useUpdateTrainRoute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTrainRouteInput) => trainsApi.update(input),
    onSuccess: (detail) => invalidate(client, detail.route.id),
  });
}

export function useDeleteTrainRoute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => trainsApi.delete(id),
    onSuccess: () => invalidate(client),
  });
}

export function useAttachLinkToRoute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AttachLinkToRouteInput) => trainsApi.attachLink(input),
    onSuccess: (_, vars) => invalidate(client, vars.routeId),
  });
}

export function useDetachLinkFromRoute() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => trainsApi.detachLink(linkId),
    onSuccess: () => invalidate(client),
  });
}
