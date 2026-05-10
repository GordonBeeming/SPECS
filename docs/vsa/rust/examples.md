# Worked example — `health` slice (Rust)

The `health` slice is the simplest possible slice. It exists to prove the IPC
plumbing works and as a copy-paste starting point.

## Files

- [`src-tauri/src/features/health/mod.rs`](../../../src-tauri/src/features/health/mod.rs)
- [`src-tauri/src/features/health/commands.rs`](../../../src-tauri/src/features/health/commands.rs)
- [`src-tauri/src/features/health/dto.rs`](../../../src-tauri/src/features/health/dto.rs)
- [`src-tauri/src/features/health/README.md`](../../../src-tauri/src/features/health/README.md)

## What it does

One Tauri command, `health_check`, returns a small struct describing the Rust
core's state. Pure function — no DB, no I/O.

## What to copy from it

- The `mod.rs` shape — `pub mod commands; pub mod dto;`
- The `dto.rs` shape — `Serialize/Deserialize` + `rename_all = "camelCase"`.
- The command signature — `pub fn <name>(...) -> AppResult<T>`.
- The registration line in `src-tauri/src/lib.rs`:
  `features::<slice>::commands::<name>` inside `generate_handler!`.

## What to add when your slice grows

- A `repo.rs` if it touches SQLite. Take a `&Connection` parameter and keep
  query strings inside the function.
- A `domain.rs` if it has non-trivial logic. Pure functions, unit-tested
  inline.
- A `migrations/` folder if it owns tables. Filename
  `V<NNNN>__<slice>__<description>.sql`.

## Wire-up flow

```
React component
  └── slice hook (TanStack Query)
        └── slice api.ts
              └── shared invoke<T>("command_name", args)
                    ├─[ipc]─►  Tauri runtime
                                └── commands.rs handler
                                      └── (optional) repo.rs / domain.rs
                                            └── returns AppResult<DTO>
                          ◄─[ipc]─┘
React renders the data.
```
