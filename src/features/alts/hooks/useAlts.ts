import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { queryKeys } from "@/shared/query/keys";

import { altsApi } from "../api";
import type { ToggleAltRecipeInput } from "../types";

/**
 * Set of unlocked alt-recipe IDs for the active playthrough. Stored as a
 * Set in the cache so the recipe picker can do `O(1)` membership tests
 * without re-walking the array on every render.
 */
export function useUnlockedAlts() {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [...queryKeys.alts.list, playthrough.data?.id ?? null] as const,
    queryFn: async () => {
      const list = await altsApi.list();
      return new Set(list.map((row) => row.recipeId));
    },
    enabled: !!playthrough.data,
  });
}

export function useToggleAlt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ToggleAltRecipeInput) => altsApi.toggle(input),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.alts.list });
      // The recipe picker filters by unlocked-alts, so factory detail
      // caches need a kick too — the new toggle changes the visible
      // recipe set on AddMachineForm.
      client.invalidateQueries({ queryKey: queryKeys.factory.list });
    },
  });
}
