# Adding a React slice

Checklist for adding a new slice under `src/features/<slice>/`.
Read [`../README.md`](../README.md) first.

## Files

```
src/features/<slice>/
├── api.ts                  # invoke wrappers — one function per Tauri command
├── types.ts                # DTO mirrors (until ts-rs/specta codegen lands)
├── hooks/                  # TanStack Query / mutation hooks
│   └── use<Thing>.ts
├── components/             # UI bound to the hooks
│   └── <Thing>.tsx
└── README.md               # the slice's contract — what it renders, what it exposes
```

Not every slice needs every folder. A purely view-layer slice (e.g. a panel
that composes several other slices' hooks) may skip `api.ts` and `types.ts`.

## Steps

1. **Create the folder** with `api.ts` (if the slice calls Rust) and a
   `README.md`.
2. **Mirror the DTOs** from the Rust side in `types.ts`. Generated types
   (Phase later) will replace this file — keep the surface area small.
3. **Add Tauri call wrappers** in `api.ts`. Group them under a single
   `<slice>Api` object:
   ```ts
   export const factoryApi = {
     list: () => invoke<Factory[]>("list_factories"),
     create: (input: CreateFactory) => invoke<Factory>("create_factory", { input }),
   };
   ```
4. **Add the slice's query key** to `src/shared/query/keys.ts`:
   ```ts
   factories: ["factories"] as const,
   ```
   For parameterised keys, use a function returning the array.
5. **Write hooks** under `hooks/`. One file per hook. Use TanStack Query for
   reads, `useMutation` for writes. Invalidate the slice's query key on
   successful mutations.
6. **Write components** under `components/`. They consume the hooks and the
   shared UI primitives. Components import from `@/shared/ui/*` for primitives
   and `@/features/<other-slice>/...` for cross-slice public surfaces — never
   from another slice's `components/internal/` or `hooks/internal/`.
7. **Write `README.md`** describing what the slice renders and which hooks
   /components it exports.
8. **Tests**: place `<Thing>.test.tsx` next to the component. Mock the slice's
   `api.ts` rather than the global `invoke` so the contract surface stays
   small.

## Naming conventions

- Slice folder: `kebab-case` only if needed; otherwise lowercase
  (`factory`, `logistics`, `train-routes`).
- Hooks: `use<Thing>` (`useFactories`, `usePlanLogistics`).
- Components: `<Thing>` (`FactoryCard`, `TransportPlanPicker`).

## Don'ts

- ❌ Don't reach into another slice's internals. Use its public hook/component.
- ❌ Don't put `invoke` calls inside components. Always go through `api.ts`.
- ❌ Don't add a primitive to `shared/ui/` until 2+ slices use it.
- ❌ Don't hard-code colours. Use Tailwind utilities backed by brand tokens.
