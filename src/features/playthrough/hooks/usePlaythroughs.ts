import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
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
      // Capture the pre-change tier *now* so the undo reverse can
      // restore it. Reading from the cache (not the server) keeps the
      // round-trip count down and matches what the user actually saw
      // in the header at the moment they bumped the selector.
      const prev =
        client.getQueryData<{ currentTier: number } | null>(
          queryKeys.playthrough.current,
        )?.currentTier ?? 0;
      const { useUndoStore } = await import("@/shared/undo/store");
      await useUndoStore.getState().push({
        apply: async () => {
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
  return useQuery({
    queryKey: queryKeys.playthrough.amplifierInventory,
    queryFn: playthroughApi.getAmplifierInventory,
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
