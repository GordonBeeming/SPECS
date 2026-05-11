import { invoke } from "@/shared/tauri/invoke";
import type {
  CreatePowerGenInput,
  FactoryPowerBalance,
  PowerGen,
  SetPowerGenPositionInput,
  UpdatePowerGenInput,
} from "./types";

export const powerApi = {
  list: (factoryId: string) =>
    invoke<PowerGen[]>("list_power_gens", { factoryId }),
  listAll: () => invoke<PowerGen[]>("list_all_power_gens"),
  add: (input: CreatePowerGenInput) =>
    invoke<PowerGen>("add_power_gen", { input }),
  update: (input: UpdatePowerGenInput) =>
    invoke<void>("update_power_gen", { input }),
  remove: (id: string) => invoke<void>("remove_power_gen", { id }),
  balance: (factoryId: string) =>
    invoke<FactoryPowerBalance>("factory_power_balance", { factoryId }),
  setPosition: (input: SetPowerGenPositionInput) =>
    invoke<void>("set_power_gen_position", { input }),
};
