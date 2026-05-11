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
      // Only the alts cache changes — factory rows + their machine
      // configs are unaffected by toggling an alt's lock state. The
      // recipe picker reads `useUnlockedAlts()` directly so it
      // re-renders when this query refreshes; no need to bust the
      // factory caches.
      client.invalidateQueries({ queryKey: queryKeys.alts.list });
    },
  });
}
