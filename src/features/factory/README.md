# `factory` slice (React)

Factory CRUD + per-machine config + per-item ledger view. Pairs with
`src-tauri/src/features/factory/`.

## Public surface

- `<FactoryListView />` — drop into the app shell. Side list of factories
  + main panel showing the selected factory's machines and ledger. Empty
  state prompts the user to open or create a playthrough first.
- Hooks: `useFactoryList`, `useFactoryDetail`, `useCreateFactory`,
  `useRenameFactory`, `useDeleteFactory`, `useAddMachine`,
  `useUpdateMachine`, `useRemoveMachine`. Mutations invalidate the
  appropriate factory keys (and the per-factory detail / ledger when the
  affected id is known).

## File map

```
features/factory/
├── api.ts
├── types.ts
├── hooks/useFactories.ts
└── components/
    ├── FactoryListView.tsx       # the public component
    ├── CreateFactoryModal.tsx
    ├── FactoryDetail.tsx
    ├── AddMachineForm.tsx        # tier-gated recipe picker
    └── FactoryLedgerTable.tsx
```

The `AddMachineForm` only offers recipes whose `unlockTier` is at or below
the current playthrough's tier (and whose building is also unlocked) so
players can't accidentally place a machine they haven't researched.

## Tests

Vitest covers the create modal validation, the ledger table's net-positive
/ net-negative styling, and the `AddMachineForm` tier-gating. The Rust
side carries the bulk of the math + repo round-trip coverage.
