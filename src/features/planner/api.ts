import { invoke } from "@/shared/tauri/invoke";
import type {
  ComputePlanInput,
  ExportOffer,
  ComputePlanResult,
  FactoryPlan,
  ItemTier,
  RaiseExportTargetResult,
  SavePlanInput,
  SavePlanResult,
  UnsourcedInput,
} from "./types";

export const plannerApi = {
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
  listExportOffers: () =>
    invoke<ExportOffer[]>("list_export_offers"),
  listItemTiers: () => invoke<ItemTier[]>("list_item_tiers"),
  assignImportSource: (importId: string, sourceFactoryId: string) =>
    invoke<SavePlanResult>("factory_plan_assign_import_source", {
      importId,
      sourceFactoryId,
    }),
  /** `neededIpm` is the spare the caller wants to exist for itself, not
   * a delta — the backend recomputes the shortfall from current links
   * and discounts `beneficiaryFactoryId`'s own draw, so a stale panel,
   * a double click, or a top-up of a source you already import from
   * can't stack raises. */
  raiseExportTarget: (
    factoryId: string,
    itemId: string,
    neededIpm: number,
    beneficiaryFactoryId: string | null,
  ) =>
    invoke<RaiseExportTargetResult>("factory_plan_raise_export_target", {
      factoryId,
      itemId,
      neededIpm,
      beneficiaryFactoryId,
    }),
};
