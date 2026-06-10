import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useUndoStore } from "@/shared/undo/store";
import { resourcesApi } from "../api";
import type { BudgetAssumption, ResourceNodeRow, SetNodeClaimInput } from "../types";

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

export function useResourceBudget(assumption: BudgetAssumption) {
  const playthrough = useCurrentPlaythrough();
  const ptId = playthrough.data?.id ?? null;
  return useQuery({
    queryKey: [...queryKeys.resources.budget(assumption), ptId] as const,
    queryFn: () => resourcesApi.budget(assumption),
    enabled: !!playthrough.data,
  });
}

function invalidate(client: ReturnType<typeof useQueryClient>) {
  // Prefix match wipes the node list AND the budget (every assumption
  // variant) — a claim change moves both.
  client.invalidateQueries({ queryKey: ["resources"] });
  // Available-supply readers (planner, factory ledger, factory detail
  // popover on the map) need to see the claim change immediately.
  // Invalidating the `factory` prefix covers list + detail(id) +
  // ledger(id) in one go, so the map popover auto-refreshes the
  // moment a node is bound or released without the user having to
  // re-click the factory.
  client.invalidateQueries({ queryKey: ["factory"] });
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
      // The undo store reads `label` eagerly at push() time, so we
      // can't derive it from `prev` (which is captured inside apply).
      // Probe the cache up-front: if a claim row exists for this node
      // right now, we're updating; otherwise it's a fresh claim. The
      // probe is best-effort — a missed cache just falls back to the
      // 'Claim node' label, which is harmless in the undo log.
      // The list query key includes the active playthrough id
      // (`[...resources.list, ptId]`), so do a prefix match — first
      // hit wins, the user only has one playthrough loaded at a time.
      const cached = client
        .getQueriesData<ResourceNodeRow[]>({ queryKey: queryKeys.resources.list })
        .map(([, data]) => data)
        .find((d): d is ResourceNodeRow[] => Array.isArray(d));
      const wasClaimed = cached?.find((n) => n.id === input.nodeId)?.claim != null;
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
        label: wasClaimed ? "Update node claim" : "Claim node",
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
