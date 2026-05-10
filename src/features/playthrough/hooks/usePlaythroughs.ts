import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { playthroughApi } from "../api";
import type { CreatePlaythroughInput } from "../types";

export function usePlaythroughList() {
  return useQuery({
    queryKey: queryKeys.playthrough.list,
    queryFn: playthroughApi.list,
  });
}

export function useCurrentPlaythrough() {
  return useQuery({
    queryKey: queryKeys.playthrough.current,
    queryFn: playthroughApi.current,
  });
}

function invalidatePlaythroughs(client: ReturnType<typeof useQueryClient>) {
  client.invalidateQueries({ queryKey: queryKeys.playthrough.list });
  client.invalidateQueries({ queryKey: queryKeys.playthrough.current });
}

export function useCreatePlaythrough() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlaythroughInput) => playthroughApi.create(input),
    onSuccess: () => invalidatePlaythroughs(client),
  });
}

export function useOpenPlaythrough() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => playthroughApi.open(id),
    onSuccess: () => invalidatePlaythroughs(client),
  });
}

export function useClosePlaythrough() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => playthroughApi.close(),
    onSuccess: () => invalidatePlaythroughs(client),
  });
}

export function useSetCurrentTier() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (tier: number) => playthroughApi.setCurrentTier(tier),
    onSuccess: () => invalidatePlaythroughs(client),
  });
}

export function useDeletePlaythrough() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => playthroughApi.delete(id),
    onSuccess: () => invalidatePlaythroughs(client),
  });
}
