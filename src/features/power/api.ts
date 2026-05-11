import { invoke } from "@/shared/tauri/invoke";
import type {
  CreatePowerGenInput,
  FactoryPowerBalance,
  PowerGen,
  UpdatePowerGenInput,
} from "./types";

export const powerApi = {
  list: (factoryId: string) =>
    invoke<PowerGen[]>("list_power_gens", { factoryId }),
  add: (input: CreatePowerGenInput) =>
    invoke<PowerGen>("add_power_gen", { input }),
  update: (input: UpdatePowerGenInput) =>
    invoke<void>("update_power_gen", { input }),
  remove: (id: string) => invoke<void>("remove_power_gen", { id }),
  balance: (factoryId: string) =>
    invoke<FactoryPowerBalance>("factory_power_balance", { factoryId }),
};
