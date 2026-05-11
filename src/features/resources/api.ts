import { invoke } from "@/shared/tauri/invoke";
import type { ResourceNodeRow, SetNodeClaimInput } from "./types";

export const resourcesApi = {
  list: () => invoke<ResourceNodeRow[]>("list_resource_nodes"),
  setClaim: (input: SetNodeClaimInput) =>
    invoke<void>("set_node_claim", { input }),
  clearClaim: (nodeId: string) =>
    invoke<void>("clear_node_claim", { nodeId }),
};
