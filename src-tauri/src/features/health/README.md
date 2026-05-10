# `health` slice (Rust)

Trivial slice that returns whether the Rust core is reachable, what version
shipped, the host triple, and a server-side timestamp. The frontend half lives
at `src/features/health/`.

This slice exists as the canonical example for VSA in SPECS. When you add a new
slice, copy its shape:

- `mod.rs` — module re-exports
- `commands.rs` — `#[tauri::command]` handlers, registered in `lib.rs`
- `dto.rs` — `serde` request/response structs (camelCase to React)
- (later, when needed) `repo.rs`, `domain.rs`, `migrations/`

## Contract

| Command        | Args | Returns                                       |
| -------------- | ---- | --------------------------------------------- |
| `health_check` | none | `HealthStatus { ok, appVersion, rustTarget, timestamp }` |

Errors: never — health intentionally does no I/O.
