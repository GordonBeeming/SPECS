/**
 * Query-key factories live here so each slice can register its own root key
 * without colliding with others. New slices add their root in `keys/<slice>.ts`
 * and re-export it from this file, then import from `@/shared/query/keys`.
 */

export const queryKeys = {
  health: ["health"] as const,
};
