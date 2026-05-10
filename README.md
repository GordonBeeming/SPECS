# S.P.E.C.S

**Satisfactory Production Efficiency and Control System** — a desktop app for
planning whole-playthrough Satisfactory factory networks: cross-factory
logistics with belt/pipe/vehicle/train/drone planning, milestone-aware unlock
gating, alternate-recipe tracking, and per-playthrough state.

Built with Tauri 2, React 19, and a Rust core. Each playthrough is its own
SQLite file you can share with friends.

## Status

Phase 1 — scaffolding. Tauri shell, Vertical Slice Architecture, brand theme,
canonical `health` slice end-to-end. See [`docs/vsa/`](./docs/vsa/) for the
architecture and [`DESIGN.md`](./DESIGN.md) for visual standards. Next phases
add the playthrough store, game-data library, factories, logistics, and the
network view.

## Architecture

Read [`docs/vsa/`](./docs/vsa/) before adding code. Visual decisions live in
[`DESIGN.md`](./DESIGN.md).

## Develop

See [`docs/development.md`](./docs/development.md) for prerequisites,
scripts, and troubleshooting.

```sh
bun install
bun run tauri:dev
```
