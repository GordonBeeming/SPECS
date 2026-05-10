/**
 * Query-key registry. Each slice adds its root key here so all keys live in
 * one place and slices can't collide. Keep keys flat — for parameterised
 * keys, export a function from this file that returns the array.
 */

export const queryKeys = {
  health: ["health"] as const,
  library: {
    summary: ["library", "summary"] as const,
    items: ["library", "items"] as const,
    buildings: ["library", "buildings"] as const,
    recipes: ["library", "recipes"] as const,
    milestones: ["library", "milestones"] as const,
    beltTiers: ["library", "belt-tiers"] as const,
    pipeTiers: ["library", "pipe-tiers"] as const,
  },
  playthrough: {
    list: ["playthrough", "list"] as const,
    current: ["playthrough", "current"] as const,
  },
  factory: {
    list: ["factory", "list"] as const,
    detail: (id: string) => ["factory", "detail", id] as const,
    ledger: (id: string) => ["factory", "ledger", id] as const,
  },
};
