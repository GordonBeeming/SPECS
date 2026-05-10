# `library` slice (Rust)

Read-only browser over the bundled Satisfactory game data. Pairs with
`src/features/library/`.

## Public surface

| Command                | Args | Returns                                     |
| ---------------------- | ---- | ------------------------------------------- |
| `library_summary`      | none | `{ datasetVersion, gameVersion, itemCount, buildingCount, recipeCount, milestoneCount }` |
| `library_items`        | none | `Item[]`                                    |
| `library_buildings`    | none | `Building[]`                                |
| `library_recipes`      | none | `Recipe[]`                                  |
| `library_milestones`   | none | `Milestone[]` (sorted by tier ascending)    |
| `library_belt_tiers`   | none | `BeltTier[]` (sorted by mark ascending)     |
| `library_pipe_tiers`   | none | `PipeTier[]` (sorted by mark ascending)     |

DTO types live in `src-tauri/src/shared/gamedata/types.rs`. The slice does
not own any tables — game data is `include_str!`-baked into the binary and
loaded once at startup into `tauri::State<GameData>`.

## Tests

`commands.rs` carries unit tests that exercise the same functions without the
Tauri `State` wrapper. The Rust-side `gamedata::loader` and `gamedata::store`
modules cover validation and indexing in their own test modules. Phase 3 will
add integration coverage for the milestone-gating overlay.
