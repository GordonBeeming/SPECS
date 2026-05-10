import { invoke } from "@/shared/tauri/invoke";
import type {
  AttachLinkToRouteInput,
  CreateTrainRouteInput,
  TrainRoute,
  TrainRouteDetail,
  UpdateTrainRouteInput,
} from "./types";

export const trainsApi = {
  list: () => invoke<TrainRoute[]>("list_train_routes"),
  detail: (id: string) => invoke<TrainRouteDetail>("get_train_route", { id }),
  create: (input: CreateTrainRouteInput) =>
    invoke<TrainRouteDetail>("create_train_route", { input }),
  update: (input: UpdateTrainRouteInput) =>
    invoke<TrainRouteDetail>("update_train_route", { input }),
  delete: (id: string) => invoke<void>("delete_train_route", { id }),
  attachLink: (input: AttachLinkToRouteInput) =>
    invoke<void>("attach_link_to_route", { input }),
  detachLink: (linkId: string) => invoke<void>("detach_link_from_route", { linkId }),
};
