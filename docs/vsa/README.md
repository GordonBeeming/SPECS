# Vertical Slice Architecture in SPECS

SPECS is organised by **feature slice**, not by layer. Each slice owns
everything it needs to deliver one user-facing capability end-to-end.

## A slice in SPECS

A slice has two halves that pair up by name:

- `src-tauri/src/features/<slice>/` — Rust IPC commands, DTOs, repository
  queries, domain logic, slice-owned migrations.
- `src/features/<slice>/` — React components, hooks, Tauri API wrappers, types.

Both halves carry a `README.md` describing the slice's contract: what commands
it exposes, what UI it renders, what it owns in the database.

## Cross-slice rules

1. **Slices do not import each other's internals.** If slice A needs data from
   slice B, A calls B's public Tauri command (Rust side) or imports B's
   exported hook/type (React side). Never reach into B's `repo.rs` or
   `components/internal/`.

2. **Shared code is intentional, not accidental.** Something earns a slot under
   `shared/` only if 2+ slices use it. List the shared files in the
   "Shared layer" section below — anything there is on the contract.

3. **Each slice owns its tables.** Migrations go in
   `features/<slice>/migrations/` and are named with a slice prefix
   (`V0001__factory__create_factory.sql`). The runner concatenates them across
   slices in version order.

4. **Cross-slice references go through stable IDs**, not joins across slice
   boundaries. The shared ID newtypes in `src-tauri/src/shared/types.rs`
   (today: `ItemId`, `RecipeId`, `BuildingId`) exist for exactly this. New
   IDs land here as the slices that need them are built (`FactoryId` in
   Phase 4, `LogisticsLinkId` in Phase 5, etc.).

5. **The frontend half mirrors the backend half by name.** No frontend slice
   exists without a backend slice (or a stated "no Rust needed" note in its
   README).

## Shared layer

Things that genuinely cross slices:

### Rust (`src-tauri/src/shared/`)

- `db/` — connection pools for App DB and Playthrough DB; migration runner.
  _(Added in Phase 2.)_
- `gamedata/` — bundled game-data JSON loader + validation. _(Phase 2.)_
- `error.rs` — `AppError` IPC envelope.
- `types.rs` — primitive ID newtypes shared across slices.

### React (`src/shared/`)

- `tauri/` — typed `invoke<T>` wrapper, generated TS types _(later)_.
- `query/` — TanStack Query client + key factory.
- `theme/` — brand tokens, dark-mode store.
- `ui/` — branded primitives (`Button`, `Card`, `Badge`).
- `testing/` — Vitest setup.

If you find yourself wanting to add anything else to `shared/`, prove that 2+
slices need it first. When in doubt, leave it inside the slice.

## Adding a new slice

- Rust side: see [`rust/slice-template.md`](./rust/slice-template.md).
- React side: see [`react/slice-template.md`](./react/slice-template.md).
- Worked example: [`rust/examples.md`](./rust/examples.md) and
  [`react/examples.md`](./react/examples.md) walk through the `health` slice.

## Why VSA here

- Features are the natural axis of change ("add drone planning", "add power
  budget", "add Somersloop toggle"). Each lands in one folder, not five.
- Minimises cross-slice coupling so the codebase grows without compounding
  pain.
- Plays well with both Rust modules and React feature folders.
- Easy for future contributors (and AI agents) to follow: each slice's README
  describes its contract.
