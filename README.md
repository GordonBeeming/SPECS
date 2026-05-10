# S.P.E.C.S

**Satisfactory Production Efficiency and Control System** — a desktop app for
planning whole-playthrough Satisfactory factory networks: cross-factory
logistics with belt/pipe/vehicle/train/drone planning, milestone-aware unlock
gating, alternate-recipe tracking, and per-playthrough state.

Built with Tauri 2, React 19, and a Rust core. Each playthrough is its own
SQLite file you can share with friends.

## Status

Early access — building toward the full plan one phase at a time.

Done:

- **Phase 1** — Tauri 2 + React 19 + Vertical Slice Architecture scaffold,
  brand theme (light + dark), canonical `health` slice, dev/prod bundle
  isolation (`com.gordonbeeming.specs.dev` vs `com.gordonbeeming.specs`).
- **Phase 2** — Two-DB SQLite infrastructure (App DB + per-playthrough
  `.specsdb`) with refinery migrations, bundled game-data loader, read-only
  Library view (items, buildings, recipes, milestones, belt/pipe tiers).
- **Phase 3** — Playthrough CRUD: create / open / close / delete, header
  switcher with create modal, milestone gating overlay on Library entries
  whose tier exceeds the active playthrough.
- **Phase 4** — Factories with per-machine config (building + recipe + count
  + clock 1–250%), tier-gated type-to-filter recipe picker, per-item ledger
  (produced / consumed / net) and aggregate power readout.

Next:

- Phase 5 — cross-factory logistics links + transport planner (the
  differentiator: ranked belt/pipe/vehicle/train/drone plans).
- Phase 6 — train routes; Phase 7 — React Flow network view; Phase 8 —
  alternate recipes + Somersloop (opt-in); Phase 9 — power planner;
  Phase 10 — undo/redo + import/export; Phase 11 — branding + game icons;
  Phase 12 — signed CI bundles.

See [`docs/vsa/`](./docs/vsa/) for the architecture and
[`DESIGN.md`](./DESIGN.md) for visual standards.

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
