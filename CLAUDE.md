# SPECS

SPECS is a desktop app for planning whole-playthrough Satisfactory factory
networks. Tauri 2 + React 19 + Rust core + bundled SQLite.

This project uses **Vertical Slice Architecture (VSA)**. Before adding any new
feature or modifying an existing one, read these docs:

- `docs/vsa/README.md` — what a slice is and the cross-slice rules
- `docs/vsa/rust/slice-template.md` — how to add a Rust slice
- `docs/vsa/react/slice-template.md` — how to add a React slice
- `docs/vsa/rust/examples.md` and `docs/vsa/react/examples.md` — canonical examples

Do **not** add code to a layer-shaped folder (e.g. `src/components/`,
`src-tauri/src/db/`) unless it is genuinely shared by 2+ slices and documented
in `docs/vsa/README.md` under "Shared".

## Design system

Visual decisions live in `DESIGN.md`. Update that file before changing brand
tokens, typography, spacing, component standards, or icon usage. Pair every
visual change with a check of the reference screenshots committed alongside.

## Commands

Full reference in [`docs/development.md`](./docs/development.md). Quick:

- `bun run tauri dev` — Tauri shell + Vite (the daily driver)
- `bun run typecheck` — TS type-check
- `bun run test` — Vitest watch mode
- From `src-tauri/`: `cargo check`, `cargo test`

## Plan

The full implementation plan is at
`~/.claude/plans/i-m-building-a-satisfactpory-snoopy-pebble.md`.
