import { invoke } from "@/shared/tauri/invoke";
import type {
  BudgetAssumption,
  ResourceBudget,
  ResourceNodeRow,
  SetNodeClaimInput,
  SetWaterExtractorGroupInput,
  WaterExtractorGroup,
} from "./types";

export const resourcesApi = {
  list: () => invoke<ResourceNodeRow[]>("list_resource_nodes"),
  budget: (assumption: BudgetAssumption) =>
    invoke<ResourceBudget>("get_resource_budget", { assumption }),
  setClaim: (input: SetNodeClaimInput) =>
    invoke<void>("set_node_claim", { input }),
  clearClaim: (nodeId: string) =>
    invoke<void>("clear_node_claim", { nodeId }),
  listWaterGroups: () =>
    invoke<WaterExtractorGroup[]>("list_water_extractor_groups"),
  setWaterGroup: (input: SetWaterExtractorGroupInput) =>
    invoke<WaterExtractorGroup>("set_water_extractor_group", { input }),
  deleteWaterGroup: (id: string) =>
    invoke<void>("delete_water_extractor_group", { id }),
};
