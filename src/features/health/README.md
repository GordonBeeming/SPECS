# `health` slice (React)

Renders a small status badge showing whether the Rust core responds, the app
version, and the host triple. Pairs with `src-tauri/src/features/health/`.

This slice exists as the canonical example for VSA in SPECS. When you add a new
slice, copy its shape:

- `api.ts` — Tauri invoke calls (one per command, thin wrappers)
- `types.ts` — DTO mirror until `ts-rs`/`specta` codegen lands
- `hooks/useThing.ts` — TanStack Query hooks
- `components/Thing.tsx` — UI bound to the hooks; only this folder imports React
- `README.md` — what the slice does and what its public hooks/components are

## Public surface

- `<HealthBadge />` — drop into the app shell.
- `useHealth()` — exposes `{ data, isPending, isError }` for any UI that needs the same info.
