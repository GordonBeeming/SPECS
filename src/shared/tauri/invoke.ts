import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Typed wrapper around Tauri's `invoke`. All slices call into Rust through
 * this function so error mapping and instrumentation can be added in one
 * place when needed (currently a passthrough — the structured error envelope
 * lives in src-tauri/src/shared/error.rs).
 */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args);
}
