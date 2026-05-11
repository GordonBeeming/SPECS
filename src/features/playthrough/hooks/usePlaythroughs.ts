import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { useUndoStore } from "@/shared/undo/store";
import { playthroughApi } from "../api";
import type { CreatePlaythroughInput, SetAmplifierInventoryInput } from "../types";

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
    mutationFn: async (tier: number) => {
      // Capture `prev` from the server *inside* the apply closure so
      // back-to-back tier changes can't undo to a stale value (if the
      // cache hadn't refreshed between mutations, the previous version
      // read a stale tier and the undo would land on the wrong level).
      // The undo store's `apply` runs once at push-time; we record
      // `prev` then and close over it for `reverse`.
      let prev = 0;
      await useUndoStore.getState().push({
        apply: async () => {
          const detail = await playthroughApi.current();
          prev = detail?.currentTier ?? 0;
          await playthroughApi.setCurrentTier(tier);
          invalidatePlaythroughs(client);
        },
        reverse: async () => {
          await playthroughApi.setCurrentTier(prev);
          invalidatePlaythroughs(client);
        },
        label: `Set tier to ${tier}`,
      });
    },
  });
}

export function useDeletePlaythrough() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => playthroughApi.delete(id),
    onSuccess: () => invalidatePlaythroughs(client),
  });
}

export function useExportPlaythrough() {
  // Export is read-only — no need to invalidate caches; the
  // playthrough list / current selection don't change.
  return useMutation({
    mutationFn: (destinationPath: string) => playthroughApi.export(destinationPath),
  });
}

export function useImportPlaythrough() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: { sourcePath: string; displayName: string }) =>
      playthroughApi.import(vars.sourcePath, vars.displayName),
    onSuccess: () => invalidatePlaythroughs(client),
  });
}

export function useAmplifierInventory() {
  // Scope the cache by active playthrough id and gate the fetch on
  // having one open — same pattern factory/logistics use — so
  // switching playthroughs doesn't briefly show the previous run's
  // somersloop count, and an "no active playthrough" error never
  // sticks in the cache.
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [
      ...queryKeys.playthrough.amplifierInventory,
      playthrough.data?.id ?? null,
    ] as const,
    queryFn: playthroughApi.getAmplifierInventory,
    enabled: !!playthrough.data,
  });
}

export function useSetAmplifierInventory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SetAmplifierInventoryInput) =>
      playthroughApi.setAmplifierInventory(input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.playthrough.amplifierInventory });
    },
  });
}
