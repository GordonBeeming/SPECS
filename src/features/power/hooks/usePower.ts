import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { powerApi } from "../api";
import type { CreatePowerGenInput, UpdatePowerGenInput } from "../types";

// Power rows live in the active playthrough's `.specsdb`. Scope every
// cache key by playthrough id and gate the fetch on having one open,
// so switching playthroughs doesn't briefly serve the previous run's
// generator list (especially after import / share copies that can
// reuse factory ids across playthroughs).
export function usePowerGens(factoryId: string | null) {
  const playthrough = useCurrentPlaythrough();
  const ptId = playthrough.data?.id ?? null;
  return useQuery({
    queryKey: factoryId
      ? ([...queryKeys.power.list(factoryId), ptId] as const)
      : (["power", "list", "none", ptId] as const),
    queryFn: () => powerApi.list(factoryId ?? ""),
    enabled: !!factoryId && !!playthrough.data,
  });
}

export function useAllPowerGens() {
  const playthrough = useCurrentPlaythrough();
  const ptId = playthrough.data?.id ?? null;
  return useQuery({
    queryKey: ["power", "list-all", ptId] as const,
    queryFn: () => powerApi.listAll(),
    enabled: !!playthrough.data,
  });
}

export function usePowerBalance(factoryId: string | null) {
  const playthrough = useCurrentPlaythrough();
  const ptId = playthrough.data?.id ?? null;
  return useQuery({
    queryKey: factoryId
      ? ([...queryKeys.power.balance(factoryId), ptId] as const)
      : (["power", "balance", "none", ptId] as const),
    queryFn: () => powerApi.balance(factoryId ?? ""),
    enabled: !!factoryId && !!playthrough.data,
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
