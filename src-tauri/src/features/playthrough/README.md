# `playthrough` slice (Rust)

Owns the playthrough lifecycle: create, list, open, close, delete, current,
set-current-tier. Pairs with `src/features/playthrough/`.

## Public surface

| Command                | Args                                  | Returns / Notes                                    |
| ---------------------- | ------------------------------------- | -------------------------------------------------- |
| `create_playthrough`   | `{ displayName, startingTier }`       | `PlaythroughDetail` — also sets it as active       |
| `list_playthroughs`    | none                                  | `PlaythroughSummary[]` from the App DB registry    |
| `open_playthrough`     | `id`                                  | `PlaythroughDetail` — sets it as active            |
| `close_playthrough`    | none                                  | drops the in-memory handle (file stays on disk)    |
| `delete_playthrough`   | `id`                                  | closes if active, removes from registry + disk     |
| `current_playthrough`  | none                                  | `PlaythroughDetail?` — `null` if none open         |
| `set_current_tier`     | `tier` (0–9)                          | `PlaythroughDetail` (refreshed)                    |

## Storage

- App DB: `playthrough_registry` row per playthrough (id, display_name,
  file_path, created_at, last_opened_at, schema_version).
- Per-playthrough `.specsdb` file under `<app-data>/playthroughs/<uuid>.specsdb`.
- Owned tables (in the playthrough DB): `meta`, `progress`,
  `unlocked_milestone`, `unlocked_alt_recipe`. See
  `migrations/playthrough/V0001__shared__init.sql`.

## Active state

`tauri::State<ActivePlaythrough>` holds the currently-open `PlaythroughDb`
behind a `parking_lot::RwLock<Option<…>>`. Reads (the Library milestone
overlay every paint) take the read lock; lifecycle commands take the write
lock.

## Tests

- `repo` module — registry insert/list/touch/delete + meta upsert + progress
  init/set round-trips against in-memory App DB and Playthrough DB.
- `commands` module — input validators (name + tier).
- Phase 4+ slices that read playthrough state get integration coverage when
  they land.
