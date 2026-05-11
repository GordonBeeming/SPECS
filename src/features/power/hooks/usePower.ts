import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { powerApi } from "../api";
import type { CreatePowerGenInput, UpdatePowerGenInput } from "../types";

export function usePowerGens(factoryId: string | null) {
  return useQuery({
    queryKey: factoryId ? queryKeys.power.list(factoryId) : ["power", "list", "none"],
    queryFn: () => powerApi.list(factoryId ?? ""),
    enabled: !!factoryId,
  });
}

export function usePowerBalance(factoryId: string | null) {
  return useQuery({
    queryKey: factoryId ? queryKeys.power.balance(factoryId) : ["power", "balance", "none"],
    queryFn: () => powerApi.balance(factoryId ?? ""),
    enabled: !!factoryId,
  });
}

function invalidate(client: ReturnType<typeof useQueryClient>, factoryId: string) {
  client.invalidateQueries({ queryKey: queryKeys.power.list(factoryId) });
  client.invalidateQueries({ queryKey: queryKeys.power.balance(factoryId) });
  // The factory ledger surfaces the consumed-MW figure that
  // factory_power_balance compares against — keep it in sync.
  client.invalidateQueries({ queryKey: ["factory", "detail", factoryId] });
}

export function useAddPowerGen(factoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePowerGenInput) => powerApi.add(input),
    onSuccess: () => invalidate(client, factoryId),
  });
}

export function useUpdatePowerGen(factoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePowerGenInput) => powerApi.update(input),
    onSuccess: () => invalidate(client, factoryId),
  });
}

export function useRemovePowerGen(factoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => powerApi.remove(id),
    onSuccess: () => invalidate(client, factoryId),
  });
}
