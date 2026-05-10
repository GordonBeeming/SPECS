import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Typed wrapper around Tauri's `invoke`. All slices call into Rust via this
 * function so the error envelope and instrumentation live in one place.
 */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args);
}
