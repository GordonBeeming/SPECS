# S.P.E.C.S

**Satisfactory Production Efficiency and Control System** — a desktop app for
planning whole-playthrough Satisfactory factory networks: cross-factory
logistics with belt/pipe/vehicle/train/drone planning, milestone-aware unlock
gating, alternate-recipe tracking, and per-playthrough state.

Built with Tauri 2, React 19, and a Rust core. Each playthrough is its own
SQLite file you can share with friends.

## Status

Phase 1 — scaffolding. Tauri shell, Vertical Slice Architecture, brand theme,
canonical `health` slice end-to-end. See the plan at
`~/.claude/plans/i-m-building-a-satisfactpory-snoopy-pebble.md` for the rest.

## Architecture

Read [`docs/vsa/`](./docs/vsa/) before adding code. Visual decisions live in
[`DESIGN.md`](./DESIGN.md).

## Develop

See [`docs/development.md`](./docs/development.md) for prerequisites,
scripts, and troubleshooting.

```sh
bun install
bun run tauri dev
```
