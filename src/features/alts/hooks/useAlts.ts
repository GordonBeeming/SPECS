import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { queryKeys } from "@/shared/query/keys";
import { useUndoStore } from "@/shared/undo/store";

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
  // Route the mutation through the undo store so ⌘Z reverses it. The
  // store handles the apply; if it throws (rejected by Rust), the
  // action never lands on the past stack — same semantics as calling
  // `altsApi.toggle` directly would have. The cache invalidation runs
  // inside `apply` / `reverse` so an undo refreshes the alts query
  // even though it bypasses the TanStack onSuccess hook.
  const invalidate = () =>
    client.invalidateQueries({ queryKey: queryKeys.alts.list });
  return useMutation({
    mutationFn: async (input: ToggleAltRecipeInput) => {
      await useUndoStore.getState().push({
        apply: async () => {
          await altsApi.toggle(input);
          invalidate();
        },
        reverse: async () => {
          await altsApi.toggle({
            recipeId: input.recipeId,
            unlocked: !input.unlocked,
          });
          invalidate();
        },
        label: input.unlocked ? "Unlock alt recipe" : "Lock alt recipe",
      });
    },
  });
}
