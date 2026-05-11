import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useUndoStore } from "@/shared/undo/store";
import { resourcesApi } from "../api";
import type { ResourceNodeRow, SetNodeClaimInput } from "../types";

// Node claims live in the active playthrough's `.specsdb`; the bundled
// catalog (608 nodes) is identical across playthroughs but the
// claim-augmented rows the UI consumes change per playthrough, so the
// query key is scoped on `playthrough.id` like every other per-pt
// hook.
export function useResourceNodes() {
  const playthrough = useCurrentPlaythrough();
  const ptId = playthrough.data?.id ?? null;
  return useQuery({
    queryKey: [...queryKeys.resources.list, ptId] as const,
    queryFn: () => resourcesApi.list(),
    enabled: !!playthrough.data,
  });
}

function invalidate(client: ReturnType<typeof useQueryClient>) {
  client.invalidateQueries({ queryKey: queryKeys.resources.list });
  // Available-supply readers (planner, factory ledger) need to see the
  // claim change immediately.
  client.invalidateQueries({ queryKey: queryKeys.factory.list });
}

export function useSetNodeClaim() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetNodeClaimInput) => {
      // For undo we need the *previous* claim row (if any) — capture it
      // inside the apply closure so a fresh-from-server snapshot isn't
      // raced by a stale react-query cache. Mirror of the `setCurrentTier`
      // pattern in usePlaythroughs.ts.
      let prev: ResourceNodeRow | undefined;
      await useUndoStore.getState().push({
        apply: async () => {
          const list = await resourcesApi.list();
          prev = list.find((n) => n.id === input.nodeId);
          await resourcesApi.setClaim(input);
          invalidate(client);
        },
        reverse: async () => {
          if (prev?.claim) {
            await resourcesApi.setClaim({
              nodeId: input.nodeId,
              minerId: prev.claim.minerId ?? null,
              clockPct: prev.claim.clockPct,
              factoryId: prev.claim.factoryId ?? null,
              notes: prev.claim.notes ?? null,
            });
          } else {
            await resourcesApi.clearClaim(input.nodeId);
          }
          invalidate(client);
        },
        label: prev?.claim ? "Update node claim" : "Claim node",
      });
    },
  });
}

export function useClearNodeClaim() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (nodeId: string) => {
      let prev: ResourceNodeRow | undefined;
      await useUndoStore.getState().push({
        apply: async () => {
          const list = await resourcesApi.list();
          prev = list.find((n) => n.id === nodeId);
          await resourcesApi.clearClaim(nodeId);
          invalidate(client);
        },
        reverse: async () => {
          if (prev?.claim) {
            await resourcesApi.setClaim({
              nodeId,
              minerId: prev.claim.minerId ?? null,
              clockPct: prev.claim.clockPct,
              factoryId: prev.claim.factoryId ?? null,
              notes: prev.claim.notes ?? null,
            });
            invalidate(client);
          }
        },
        label: "Release node",
      });
    },
  });
}
