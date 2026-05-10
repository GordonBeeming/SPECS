# Power slice

Per-factory generators with fuel consumption and clock-aware MW
totals. Pairs with `factory::commands::compose_ledger` to give the
React side a "net MW" reading.

## Storage

`power_gen` (per-playthrough DB):

| Column            | Notes                                              |
| ----------------- | -------------------------------------------------- |
| `id`              | uuid                                               |
| `factory_id`      | FK → `factory(id)`, ON DELETE CASCADE              |
| `generator_id`    | game-data ref (no FK; dataset is in-memory)        |
| `fuel_item_id`    | which fuel of the generator's fuel list            |
| `count`           | `>= 1` (CHECK)                                     |
| `clock_pct_x100`  | 1..250% via x100 storage (same trick as machines)  |
| `notes`           | optional                                           |
| timestamps        | ISO 8601 UTC                                       |

## Surface

| Command                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `list_power_gens`        | All generators on a factory                          |
| `add_power_gen`          | Insert; validates generator + fuel exist in dataset  |
| `update_power_gen`       | Edit count / clock / fuel / notes                    |
| `remove_power_gen`       | Delete; NotFound on missing id                       |
| `factory_power_balance`  | Generated − consumed + per-fuel demand               |

`factory_power_balance` calls `factory::compose_ledger` for consumption
so the same amplification curve drives both sides — no double counting
or formula drift.

## Tests

- 7 domain tests pinning the linear scaling, override fuel
  power, and supplemental flows.
- 3 repo tests covering insert/list round-trip, factory delete
  cascade, and update affected-row counts.
- 2 command-validator tests for count + clock.
