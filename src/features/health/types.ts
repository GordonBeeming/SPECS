/**
 * Mirror of `src-tauri/src/features/health/dto.rs::HealthStatus`.
 * Once `ts-rs`/`specta` is wired in (later phase) this file is generated.
 */
export interface HealthStatus {
  ok: boolean;
  appVersion: string;
  rustTarget: string;
  timestamp: string;
}
