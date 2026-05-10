import { invoke } from "@/shared/tauri/invoke";
import type {
  CreateLogisticsLinkInput,
  LogisticsLink,
  PlanInput,
  TransportPlan,
  UpdateLogisticsLinkInput,
} from "./types";

export const logisticsApi = {
  list: () => invoke<LogisticsLink[]>("list_logistics_links"),
  get: (id: string) => invoke<LogisticsLink>("get_logistics_link", { id }),
  create: (input: CreateLogisticsLinkInput) =>
    invoke<LogisticsLink>("create_logistics_link", { input }),
  update: (input: UpdateLogisticsLinkInput) =>
    invoke<LogisticsLink>("update_logistics_link", { input }),
  delete: (id: string) => invoke<void>("delete_logistics_link", { id }),
  plan: (input: PlanInput) => invoke<TransportPlan[]>("plan_logistics", { input }),
};
