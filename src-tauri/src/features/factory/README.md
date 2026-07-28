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

- `machine_multiplier(count, clock_pct)` — linear on count and clock,
  floored at zero.
- `machine_power_mw_amp(base_power_mw, count, clock_pct, amp_filled,
  amp_total_slots)` — the wiki's `base × (1 + amp_ratio)² ×
  (clock/100)^1.321928` curve. **The only power formula for anything that
  isn't a generator.** Linear power is wrong from 101% clock upwards; a
  linear copy of this once had the planner under-reporting an overclocked
  factory by a quarter.
- `recipe_io_flows_amp(recipe, count, clock_pct, amp_filled,
  amp_total_slots)` — multiplies both sides through. Pass `0, 0` for an
  unamplified bank.

`commands::compose_ledger` aggregates across a factory's machines into a
`FactoryLedger { flows, power_mw }`. `flows` are `(item, produced,
consumed, net)` triples sorted by item_id.

## Tests

- `domain` — unit tests including a wiki-pinned power regression
  (100 MW machine at 250% with a full amplifier ≈ 1343 MW).
- `repo` — 5 round-trip tests against an in-memory playthrough DB
  (insert/list/cascade/clock-precision/CHECK-constraint).
- `commands` — 7 tests covering ledger composition (self-contained
  factory nets to 0 on its intermediate item, overclock scales both sides,
  unknown-recipe machines skip flows but still draw power) plus three
  validators (name, count, clock).
