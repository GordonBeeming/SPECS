import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useUndoStore } from "@/shared/undo/store";
import { logisticsApi } from "@/features/logistics/api";
import { plannerApi } from "@/features/planner/api";
import type {
  ApplyChainToFactoryInput,
  ApplyChainToFactoryResult,
} from "@/features/planner/types";
import { factoryApi } from "../api";
import type {
  AddMachineInput,
  CreateFactoryInput,
  FactoryDetail,
  FactoryMachine,
  RenameFactoryInput,
  SetFactoryIconInput,
  UpdateMachineInput,
} from "../types";

/**
 * Factory queries are gated on an active playthrough — the Rust commands
 * return `Invalid("no active playthrough")` when none is open, and an
 * eager unconditional query would land that error in the cache and stick
 * there until the next manual refetch. Including the playthrough id in the
 * query key also makes the cache per-playthrough, so switching wipes the
 * previous run's factories rather than showing them under the new name.
 */
export function useFactoryList() {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [...queryKeys.factory.list, playthrough.data?.id ?? null] as const,
    queryFn: factoryApi.list,
    enabled: !!playthrough.data,
  });
}

export function useMachineLayouts(factoryId: string | null | undefined) {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: ["factory", "machine-layouts", factoryId ?? "", playthrough.data?.id ?? null] as const,
    queryFn: () => factoryApi.listMachineLayouts(factoryId!),
    enabled: !!factoryId && !!playthrough.data,
  });
}

export function useFactoryDetail(id: string | null | undefined) {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [...queryKeys.factory.detail(id ?? ""), playthrough.data?.id ?? null] as const,
    queryFn: () => factoryApi.detail(id!),
    enabled: !!id && !!playthrough.data,
  });
}

function invalidateAll(client: ReturnType<typeof useQueryClient>, factoryId?: string) {
  client.invalidateQueries({ queryKey: queryKeys.factory.list });
  if (factoryId) {
    client.invalidateQueries({ queryKey: queryKeys.factory.detail(factoryId) });
    client.invalidateQueries({ queryKey: queryKeys.factory.ledger(factoryId) });
  } else {
    client.invalidateQueries({ queryKey: ["factory"] });
  }
}

export function useCreateFactory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFactoryInput) => factoryApi.create(input),
    onSuccess: (factory) => invalidateAll(client, factory.id),
  });
}

export function useRenameFactory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RenameFactoryInput) => factoryApi.rename(input),
    onSuccess: (factory) => invalidateAll(client, factory.id),
  });
}

export function useSetFactoryIcon() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SetFactoryIconInput) => factoryApi.setIcon(input),
    onSuccess: (factory) => invalidateAll(client, factory.id),
  });
}

export function useDeleteFactory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => factoryApi.delete(id),
    onSuccess: () => invalidateAll(client),
  });
}

export function useAddMachine() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddMachineInput) => {
      let created: FactoryMachine | null = null;
      await useUndoStore.getState().push({
        apply: async () => {
          created = await factoryApi.addMachine(input);
          invalidateAll(client, input.factoryId);
        },
        reverse: async () => {
          if (created) {
            await factoryApi.removeMachine(created.id);
            invalidateAll(client, input.factoryId);
          }
        },
        label: "Add machine",
      });
      // Some callers (e.g. tests, status surfaces) want the returned
      // machine — surface it after push resolves.
      return created as FactoryMachine | null;
    },
  });
}

export function useUpdateMachine(factoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMachineInput) => {
      // Capture the pre-update machine row from the FactoryDetail cache
      // so the reverse closure can restore exactly the same fields the
      // backend update_machine command edits. Probe the cache first;
      // if it's empty fall back to a fresh detail fetch.
      const cached = client
        .getQueriesData<FactoryDetail>({
          queryKey: queryKeys.factory.detail(factoryId),
        })
        .map(([, data]) => data)
        .find((d): d is FactoryDetail => !!d);
      const prev =
        cached?.machines.find((m) => m.id === input.id) ??
        (await factoryApi
          .detail(factoryId)
          .then((d) => d.machines.find((m) => m.id === input.id) ?? null));
      await useUndoStore.getState().push({
        apply: async () => {
          await factoryApi.updateMachine(input);
          invalidateAll(client, factoryId);
        },
        reverse: async () => {
          if (!prev) return;
          await factoryApi.updateMachine({
            id: prev.id,
            // Only restore the recipe/building when the original swap
            // changed it — the backend's update_factory_machine handles
            // both paths but the cheap one is preferred when nothing
            // structural changed.
            recipeId: input.recipeId !== undefined ? prev.recipeId : undefined,
            buildingId:
              input.buildingId !== undefined ? prev.buildingId : undefined,
            count: prev.count,
            clockPct: prev.clockPct,
            useSomersloop: prev.useSomersloop,
            somersloopSlotsFilled: prev.somersloopSlotsFilled,
            powerShardCount: prev.powerShardCount,
          });
          invalidateAll(client, factoryId);
        },
        label: input.recipeId !== undefined ? "Swap recipe" : "Edit machine",
      });
    },
  });
}

export function useRemoveMachine(factoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => factoryApi.removeMachine(id),
    onSuccess: () => invalidateAll(client, factoryId),
  });
}

/**
 * Apply a planner-derived chain into the named factory. Push the entire
 * apply as one grouped undoable action — a single ⌘Z reverses every
 * machine + logistics link that landed.
 */
export function useApplyChainToFactory(factoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApplyChainToFactoryInput) => {
      let result: ApplyChainToFactoryResult | null = null;
      await useUndoStore.getState().push({
        apply: async () => {
          result = await plannerApi.applyToFactory(input);
          invalidateAll(client, factoryId);
        },
        reverse: async () => {
          if (!result) return;
          // Delete links first so any FK that joins via factory_id is
          // released before the machines vanish; the schema only
          // strictly requires the from/to factory FK but ordering this
          // way also matches the cross-factory undo pattern.
          for (const id of result.linkIds) {
            try {
              await logisticsApi.delete(id);
            } catch {
              // Best-effort: a stale link from concurrent edits isn't a
              // reason to halt the undo; the user's intent is "put me
              // back" and partial success beats none.
            }
          }
          for (const id of result.machineIds) {
            try {
              await factoryApi.removeMachine(id);
            } catch {
              // same: tolerate already-removed rows
            }
          }
          invalidateAll(client, factoryId);
        },
        label: "Apply chain plan",
      });
      return result as ApplyChainToFactoryResult | null;
    },
  });
}
