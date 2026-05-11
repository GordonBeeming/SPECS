import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { factoryApi } from "../api";
import type {
  AddMachineInput,
  CreateFactoryInput,
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
    mutationFn: (input: AddMachineInput) => factoryApi.addMachine(input),
    onSuccess: (m) => invalidateAll(client, m.factoryId),
  });
}

export function useUpdateMachine(factoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMachineInput) => factoryApi.updateMachine(input),
    onSuccess: () => invalidateAll(client, factoryId),
  });
}

export function useRemoveMachine(factoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => factoryApi.removeMachine(id),
    onSuccess: () => invalidateAll(client, factoryId),
  });
}
