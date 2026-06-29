import { invoke } from "@/shared/tauri/invoke";
import type { ElevatorOverview } from "./types";

export const elevatorApi = {
  overview: () => invoke<ElevatorOverview>("elevator_overview"),
};
