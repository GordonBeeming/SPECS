/**
 * Query-key registry. Each slice adds its root key here so all keys live in
 * one place and slices can't collide. Keep keys flat — for parameterised
 * keys, export a function from this file that returns the array.
 */

export const queryKeys = {
  health: ["health"] as const,
};
