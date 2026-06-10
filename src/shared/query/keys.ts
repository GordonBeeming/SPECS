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
    amplifierInventory: ["playthrough", "amplifier-inventory"] as const,
  },
  power: {
    list: (factoryId: string) => ["power", "list", factoryId] as const,
    balance: (factoryId: string) => ["power", "balance", factoryId] as const,
  },
  factory: {
    list: ["factory", "list"] as const,
    detail: (id: string) => ["factory", "detail", id] as const,
    ledger: (id: string) => ["factory", "ledger", id] as const,
    plan: (id: string) => ["factory", "plan", id] as const,
    unsourcedInputs: ["factory", "unsourced-inputs"] as const,
  },
  logistics: {
    list: ["logistics", "list"] as const,
    detail: (id: string) => ["logistics", "detail", id] as const,
    plan: (itemId: string, ipm: number, distanceM: number | null) =>
      ["logistics", "plan", itemId, ipm, distanceM] as const,
  },
  trains: {
    list: ["trains", "list"] as const,
    detail: (id: string) => ["trains", "detail", id] as const,
  },
  alts: {
    list: ["alts", "list"] as const,
  },
  resources: {
    list: ["resources", "list"] as const,
    budget: (assumption: string) => ["resources", "budget", assumption] as const,
  },
};
