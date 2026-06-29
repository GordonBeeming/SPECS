# Space Elevator slice

Answers "what does the Space Elevator still need, and is my network making it?"
for the whole playthrough. It pairs the fixed Project Assembly phase
requirements with live production so you can see, per part, how much each
phase wants delivered, how much you currently make, and — per producing
factory — how much of that output is free versus already consumed or shipped
elsewhere.

## Storage

None. The slice owns no tables.

- Phase requirements are bundled game data (`shared/gamedata`,
  `spaceElevatorPhases`), hand-authored from the official wiki's "Initial
  phase requirements" table and validated at load (every part id must resolve
  to a known item).
- Production is read through other slices' public functions, never their
  internals: `factory::repo` + `factory::commands::compose_ledger` for what
  each factory makes and consumes, and `logistics::repo::link_list` for what's
  shipped onward.

## Surface

| Command             | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `elevator_overview` | Every phase, each required part's quantity, the network's total output for it, and the per-factory split of produced / consumed-internally / synced-out / free |

`available = produced − consumed_internally − synced_out`. A negative value
means the factory is promising more than it makes.

## Tests

`commands.rs` covers the zero-production default (every phase listed, nothing
made yet) and the join that splits a factory's output into consumed, shipped
onward, and free. Loader validation lives in `shared/gamedata/loader.rs`.
