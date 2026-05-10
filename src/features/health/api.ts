import { invoke } from "@/shared/tauri/invoke";
import type { HealthStatus } from "./types";

export const healthApi = {
  check: () => invoke<HealthStatus>("health_check"),
};
