# Trains slice (frontend)

Pairs with `src-tauri/src/features/trains/`. Surfaces the Trains tab in
the AppShell so the player can plan shared routes that carry multiple
logistics links.

- `hooks/useTrains.ts` — TanStack wrappers (list / detail / create /
  update / delete + attach/detach a link to a route). Per-playthrough
  cache key, same pattern as the factory + logistics slices.
- `components/TrainRoutesView.tsx` — list view; opens the editor on
  create or edit. Shows freight/fluid car counts and the cached
  cycle-time estimate (or "no estimate yet" when distance is missing).
- `components/TrainRouteEditor.tsx` — modal handling create + edit.
  Stops are reorderable in place via up/down buttons; validation
  mirrors the Rust command layer (≥ 2 distinct stops, no consecutive
  duplicates, ≥ 1 car total).
