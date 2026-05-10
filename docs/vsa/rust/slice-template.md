# Adding a Rust slice

Checklist for adding a new slice under `src-tauri/src/features/<slice>/`.
Read [`../README.md`](../README.md) first if you haven't already.

## Files

```
src-tauri/src/features/<slice>/
├── mod.rs           # re-exports the slice's modules
├── commands.rs      # #[tauri::command] handlers — ALL public IPC entry points
├── dto.rs           # serde request/response structs (rename_all = "camelCase")
├── repo.rs          # SQLite queries (added when the slice persists data)
├── domain.rs        # non-trivial pure logic (added when the slice has it)
├── migrations/      # slice-owned .sql files (added when the slice owns tables)
│   └── V<NNNN>__<slice>__<description>.sql
└── README.md        # the slice's contract — what it does, what it exposes
```

Not every slice needs every file. A read-only slice may have only `mod.rs`,
`commands.rs`, `dto.rs`, and `README.md`. Add the rest when you reach for them.

## Steps

1. **Create the folder** with `mod.rs` re-exporting `commands` and `dto`.
2. **Add a parent re-export** in `src-tauri/src/features/mod.rs`
   (`pub mod <slice>;`).
3. **Define DTOs** in `dto.rs`. Always `#[derive(Serialize, Deserialize)]` and
   `#[serde(rename_all = "camelCase")]` so the React side gets idiomatic JS.
4. **Write the command handlers** in `commands.rs`. Each is
   `#[tauri::command]` and returns `crate::shared::error::AppResult<T>`.
5. **Register the commands** in `src-tauri/src/lib.rs` inside the
   `tauri::generate_handler![...]` macro.
6. **(If the slice persists data)** add an entry in `repo.rs` and a migration
   file. Migrations are versioned across the whole app — pick the next free
   number and prefix the filename with the slice name.
7. **(If the slice does non-trivial pure logic)** put it in `domain.rs` with
   unit tests inline (`#[cfg(test)] mod tests`).
8. **Write `README.md`** describing the slice's contract: commands, args,
   returns, errors, and which tables (if any) it owns.
9. **Run `cargo check`** from `src-tauri/` and `cargo test` to verify.

## Naming conventions

- Slice folder: `snake_case` (`logistics`, `train_routes`).
- DTOs: `<Verb>Request` / `<Verb>Response` or domain noun (`HealthStatus`,
  `Factory`, `LogisticsLink`).
- Commands: `<verb>_<thing>` (`create_factory`, `plan_logistics`,
  `list_factories`).

## Don'ts

- ❌ Don't import another slice's `repo.rs`, `domain.rs`, or internal modules.
- ❌ Don't put queries in `commands.rs` — push them down to `repo.rs`.
- ❌ Don't add anything to `shared/` unless 2+ slices need it.
- ❌ Don't `unwrap()` in command handlers — return `AppError`.
