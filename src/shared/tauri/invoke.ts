import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

/** Broadcast fired after any data-mutating command so other windows refetch. */
export const DATA_CHANGED_EVENT = "data:changed";

/**
 * Read-only commands never change persisted state, so they don't broadcast.
 * This is a denylist, not an allowlist: anything not matched here is treated
 * as a mutation, so a new write command is covered automatically — the cost of
 * a false positive is one wasted refetch in the other windows, which is cheap.
 */
function isReadOnly(command: string): boolean {
  return (
    command.startsWith("list_") ||
    command.startsWith("get_") ||
    command.startsWith("library_") ||
    command.endsWith("_compute") ||
    command.endsWith("_get") ||
    command.endsWith("_ledger") ||
    command.endsWith("_balance") ||
    command === "current_playthrough" ||
    command === "health_check" ||
    command === "plan_logistics" ||
    command === "validate_playthrough" ||
    command === "elevator_overview" ||
    command === "pop_out_factory"
  );
}

/**
 * Typed wrapper around Tauri's `invoke`. All slices call into Rust through
 * this function so error mapping and instrumentation live in one place (the
 * structured error envelope is in src-tauri/src/shared/error.rs).
 *
 * After a successful mutation it emits `data:changed` so any other open window
 * (a popped-out factory, the main window) refetches — every window has its own
 * TanStack Query cache, but they share one Rust backend + SQLite.
 */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await tauriInvoke<T>(command, args);
  if (!isReadOnly(command)) {
    // Fire-and-forget — a broadcast failure must never fail the command, and
    // outside a Tauri webview (e.g. unit tests) `emit` is simply unavailable.
    try {
      void emit(DATA_CHANGED_EVENT).catch(() => {});
    } catch {
      /* not running in a Tauri window */
    }
  }
  return result;
}
