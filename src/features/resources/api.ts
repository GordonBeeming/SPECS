import { invoke } from "@/shared/tauri/invoke";
import type {
  BudgetAssumption,
  ResourceBudget,
  ResourceNodeRow,
  SetNodeClaimInput,
} from "./types";

export const resourcesApi = {
  list: () => invoke<ResourceNodeRow[]>("list_resource_nodes"),
  budget: (assumption: BudgetAssumption) =>
    invoke<ResourceBudget>("get_resource_budget", { assumption }),
  setClaim: (input: SetNodeClaimInput) =>
    invoke<void>("set_node_claim", { input }),
  clearClaim: (nodeId: string) =>
    invoke<void>("clear_node_claim", { nodeId }),
};
