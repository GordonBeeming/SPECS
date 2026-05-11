import { invoke } from "@/shared/tauri/invoke";
import type {
  AmplifierInventory,
  CreatePlaythroughInput,
  PlaythroughDetail,
  PlaythroughSummary,
  SetAmplifierInventoryInput,
} from "./types";

export const playthroughApi = {
  list: () => invoke<PlaythroughSummary[]>("list_playthroughs"),
  current: () => invoke<PlaythroughDetail | null>("current_playthrough"),
  create: (input: CreatePlaythroughInput) =>
    invoke<PlaythroughDetail>("create_playthrough", { input }),
  open: (id: string) => invoke<PlaythroughDetail>("open_playthrough", { id }),
  close: () => invoke<void>("close_playthrough"),
  setCurrentTier: (tier: number) =>
    invoke<PlaythroughDetail>("set_current_tier", { tier }),
  delete: (id: string) => invoke<void>("delete_playthrough", { id }),
  export: (destinationPath: string) =>
    invoke<string>("export_playthrough", { destinationPath }),
  import: (sourcePath: string, displayName: string) =>
    invoke<PlaythroughSummary>("import_playthrough", { sourcePath, displayName }),
  getAmplifierInventory: () =>
    invoke<AmplifierInventory>("get_amplifier_inventory"),
  setAmplifierInventory: (input: SetAmplifierInventoryInput) =>
    invoke<AmplifierInventory>("set_amplifier_inventory", { input }),
};
