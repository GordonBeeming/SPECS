import { invoke } from "@/shared/tauri/invoke";
import type { ValidationReport } from "./types";

export const validationApi = {
  validate: () => invoke<ValidationReport>("validate_playthrough"),
};
