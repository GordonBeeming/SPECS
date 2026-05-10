# `library` slice (React)

Read-only browser over the bundled Satisfactory game data. Pairs with
`src-tauri/src/features/library/`.

## Public surface

- `<LibraryView />` — drop into the app shell. Renders a tabbed view over
  items, buildings, recipes, milestones, and transport (belt + pipe) tiers.
- Hooks (`useItems`, `useBuildings`, `useRecipes`, `useMilestones`,
  `useBeltTiers`, `usePipeTiers`, `useLibrarySummary`) — TanStack Query
  wrappers callable from any other slice. Cache forever (`staleTime:
  Infinity`) because the dataset is bundled in the binary.

## File map

```
features/library/
├── api.ts                          # Tauri invoke wrappers
├── types.ts                        # DTO mirrors of shared/gamedata/types.rs
├── hooks/useLibrary.ts             # one TanStack Query hook per surface
└── components/
    ├── LibraryView.tsx             # tabbed shell — the public component
    ├── LibraryTable.tsx            # generic table primitive used by the rest
    ├── ItemsTable.tsx
    ├── BuildingsTable.tsx
    ├── RecipesTable.tsx
    ├── MilestonesTable.tsx
    └── TransportTable.tsx          # belts + pipes side-by-side
```

## Tests

`LibraryView.test.tsx` covers tab switching and summary rendering with the
slice's `api.ts` mocked, so the contract surface stays small.
