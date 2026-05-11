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
- **Phase 5** — Cross-factory logistics links + transport planner: ranked
  belt and pipe plans for a given (item, ipm, distance, unlocked tier),
  rendered as a radio-group picker with locked-tier callouts.
- **Phase 6** — Train routes carrying multiple links. Cycle-time math
  pinned to wiki capacities; route editor with reorderable stops.
- **Phase 7** — React Flow network canvas: factories as nodes,
  logistics links as edges with kind-coloured strokes and capacity-
  scaled widths.
- **Phase 8** — Hard Drive alt-recipe checklist + opt-in Somersloop /
  power-shard amplification per machine, with the wiki's
  `clock^1.321928` × `(1 + amp_ratio)^2` power curve.
- **Phase 9** — Power planner: per-factory generators (Biomass, Coal,
  Fuel, Nuclear) with fuel consumption and `factory_power_balance`
  cross-referencing the machine ledger.
- **Phase 10** — Export / import `.specsdb` files (WAL-safe via
  `VACUUM INTO`; validated by opening a copy + verifying the seeded
  progress row). Undo/redo deferred to a later milestone.

Next:

- **Phase 11** — Branding polish + bundled game-icon pack
  (per Coffee Stain's fan-content policy) + reference screenshots.
- **Phase 12** — CI/CD + signed macOS / Windows / Linux bundles.

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
