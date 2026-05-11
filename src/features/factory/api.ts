import { invoke } from "@/shared/tauri/invoke";
import type {
  AddMachineInput,
  CreateFactoryInput,
  Factory,
  FactoryDetail,
  FactoryLedger,
  FactoryMachine,
  RenameFactoryInput,
  SetFactoryIconInput,
  UpdateMachineInput,
} from "./types";

export const factoryApi = {
  list: () => invoke<Factory[]>("list_factories"),
  detail: (id: string) => invoke<FactoryDetail>("get_factory_detail", { id }),
  ledger: (factoryId: string) => invoke<FactoryLedger>("factory_ledger", { factoryId }),
  create: (input: CreateFactoryInput) => invoke<Factory>("create_factory", { input }),
  rename: (input: RenameFactoryInput) => invoke<Factory>("rename_factory", { input }),
  setIcon: (input: SetFactoryIconInput) => invoke<Factory>("set_factory_icon", { input }),
  delete: (id: string) => invoke<void>("delete_factory", { id }),
  addMachine: (input: AddMachineInput) => invoke<FactoryMachine>("add_factory_machine", { input }),
  updateMachine: (input: UpdateMachineInput) => invoke<void>("update_factory_machine", { input }),
  removeMachine: (id: string) => invoke<void>("remove_factory_machine", { id }),
};
