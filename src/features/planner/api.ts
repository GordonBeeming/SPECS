import { invoke } from "@/shared/tauri/invoke";
import type {
  ApplyChainPlanInput,
  ApplyChainPlanResult,
  DeriveChainInput,
  DeriveChainResult,
} from "./types";

export const plannerApi = {
  derive: (input: DeriveChainInput) =>
    invoke<DeriveChainResult>("planner_derive_chain", { input }),
  apply: (input: ApplyChainPlanInput) =>
    invoke<ApplyChainPlanResult>("apply_chain_plan", { input }),
};
