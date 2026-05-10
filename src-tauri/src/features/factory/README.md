# `factory` slice (Rust)

Per-playthrough factory CRUD + per-machine config + a per-item ledger that
turns a factory's machines into a net inputs/outputs view. Pairs with
`src/features/factory/`.

## Public surface

| Command                  | Args                                    | Returns |
| ------------------------ | --------------------------------------- | ------- |
| `list_factories`         | none                                    | `Factory[]` (sorted by name)
| `get_factory_detail`     | `id`                                    | `{ factory, machines, ledger }`
| `create_factory`         | `{ name, notes?, color? }`              | `Factory`
| `rename_factory`         | `{ id, name }`                          | `Factory`
| `delete_factory`         | `id`                                    | void (cascades to machines)
| `add_factory_machine`    | `{ factoryId, buildingId, recipeId, count, clockPct }` | `FactoryMachine`
| `update_factory_machine` | `{ id, count, clockPct }`               | void
| `remove_factory_machine` | `id`                                    | void
| `factory_ledger`         | `factoryId`                             | `FactoryLedger`

All commands require an active playthrough — the `factory` and
`factory_machine` tables live in the playthrough DB.

## Storage

- `factory` — id (uuid), name, world_x/y, color, notes, timestamps.
- `factory_machine` — id, factory_id (FK CASCADE), building_id, recipe_id,
  count (≥1), `clock_pct_x100` (100–25000, i.e. 1.00%–250.00%), timestamps.
  Storing clock as `i64 × 100` keeps the round-trip exact (no f32 drift on
  values like 247.5%).

## Math

`domain.rs` carries the pure functions:

- `machine_throughput_per_minute(recipe_per_minute, count, clock_pct)` —
  linear on count and clock.
- `machine_power_mw(base_power_mw, count, clock_pct)` — Phase 4 uses the
  linear approximation; Phase 8 will swap in the wiki's
  `power × clock^1.321928` curve when overclock + Somersloop unify.
- `recipe_io_flows(recipe, count, clock_pct)` — multiplies through.

`commands::compose_ledger` aggregates across a factory's machines into a
`FactoryLedger { flows, power_mw }`. `flows` are `(item, produced,
consumed, net)` triples sorted by item_id.

## Tests

- `domain` — 8 unit tests including a wiki-pinned regression
  (Mk3 miner on Pure at 250% = 1200 ipm).
- `repo` — 5 round-trip tests against an in-memory playthrough DB
  (insert/list/cascade/clock-precision/CHECK-constraint).
- `commands` — 7 tests covering ledger composition (self-contained
  factory nets to 0 on its intermediate item, overclock scales both sides,
  unknown-recipe machines skip flows but still draw power) plus three
  validators (name, count, clock).
