import { invoke } from "@/shared/tauri/invoke";
import type {
  ApplyChainPlanInput,
  ApplyChainPlanResult,
  ApplyChainToFactoryInput,
  ApplyChainToFactoryResult,
  ComputePlanInput,
  ComputePlanResult,
  DeriveChainInput,
  DeriveChainResult,
  FactoryPlan,
  SavePlanInput,
  SavePlanResult,
  UnsourcedInput,
} from "./types";

export const plannerApi = {
  derive: (input: DeriveChainInput) =>
    invoke<DeriveChainResult>("planner_derive_chain", { input }),
  apply: (input: ApplyChainPlanInput) =>
    invoke<ApplyChainPlanResult>("apply_chain_plan", { input }),
  applyToFactory: (input: ApplyChainToFactoryInput) =>
    invoke<ApplyChainToFactoryResult>("apply_chain_to_factory", { input }),
  getPlan: (factoryId: string) =>
    invoke<FactoryPlan>("factory_plan_get", { factoryId }),
  computePlan: (input: ComputePlanInput) =>
    invoke<ComputePlanResult>("factory_plan_compute", { input }),
  savePlan: (input: SavePlanInput) =>
    invoke<SavePlanResult>("factory_plan_save", { input }),
  setPlanLayout: (factoryId: string, nodeKey: string, x: number, y: number) =>
    invoke<void>("factory_plan_layout_set", { factoryId, nodeKey, x, y }),
  listUnsourcedInputs: () =>
    invoke<UnsourcedInput[]>("list_unsourced_inputs"),
  assignImportSource: (importId: string, sourceFactoryId: string) =>
    invoke<SavePlanResult>("factory_plan_assign_import_source", {
      importId,
      sourceFactoryId,
    }),
};
