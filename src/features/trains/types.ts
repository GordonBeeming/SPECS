/** Hand-mirrored from `src-tauri/src/features/trains/dto.rs`. */

export interface TrainRoute {
  id: string;
  name: string;
  freightCars: number;
  fluidCars: number;
  totalDistanceM?: number;
  estCycleSeconds?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrainRouteStop {
  routeId: string;
  factoryId: string;
  ordinal: number;
}

export interface TrainRouteDetail {
  route: TrainRoute;
  stops: TrainRouteStop[];
  attachedLinkIds: string[];
}

export interface CreateTrainRouteInput {
  name: string;
  freightCars: number;
  fluidCars: number;
  /** Factory IDs in visit order; ≥ 2 distinct factories. */
  stops: string[];
  totalDistanceM?: number;
  notes?: string;
}

export interface UpdateTrainRouteInput {
  id: string;
  name: string;
  freightCars: number;
  fluidCars: number;
  stops: string[];
  totalDistanceM?: number;
  notes?: string;
}

export interface AttachLinkToRouteInput {
  linkId: string;
  routeId: string;
}
