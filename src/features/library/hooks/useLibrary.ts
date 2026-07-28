import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { libraryApi } from "../api";

const STATIC = {
  // Game data is read-only and bundled in the binary, so the cache never
  // goes stale. Cache forever — first paint is the only fetch.
  staleTime: Infinity,
  gcTime: Infinity,
};

export function useLibrarySummary() {
  return useQuery({
    queryKey: queryKeys.library.summary,
    queryFn: libraryApi.summary,
    ...STATIC,
  });
}

export function useItems() {
  return useQuery({
    queryKey: queryKeys.library.items,
    queryFn: libraryApi.items,
    ...STATIC,
  });
}

export function useBuildings() {
  return useQuery({
    queryKey: queryKeys.library.buildings,
    queryFn: libraryApi.buildings,
    ...STATIC,
  });
}

export function useRecipes() {
  return useQuery({
    queryKey: queryKeys.library.recipes,
    queryFn: libraryApi.recipes,
    ...STATIC,
  });
}

export function useMilestones() {
  return useQuery({
    queryKey: queryKeys.library.milestones,
    queryFn: libraryApi.milestones,
    ...STATIC,
  });
}

export function useBeltTiers() {
  return useQuery({
    queryKey: queryKeys.library.beltTiers,
    queryFn: libraryApi.beltTiers,
    ...STATIC,
  });
}

export function usePipeTiers() {
  return useQuery({
    queryKey: queryKeys.library.pipeTiers,
    queryFn: libraryApi.pipeTiers,
    ...STATIC,
  });
}

export function useGenerators() {
  return useQuery({
    queryKey: ["library", "generators"] as const,
    queryFn: libraryApi.generators,
    ...STATIC,
  });
}

export function useTransportVehicles() {
  return useQuery({
    queryKey: ["library", "transport-vehicles"] as const,
    queryFn: libraryApi.transportVehicles,
    ...STATIC,
  });
}

/**
 * The item ids a chain walk terminates on — what the game mines rather
 * than manufactures. Comes from Rust so a client-side trace grounds out
 * on exactly the set the planner grounds out on.
 */
export function useExtractedResources() {
  return useQuery({
    queryKey: queryKeys.library.extractedResources,
    queryFn: libraryApi.extractedResources,
    ...STATIC,
  });
}

/**
 * `Desc_*_C` / `Build_*_C` id → display name, covering every item and
 * building in one lookup. `IconPicker` (a `shared/ui` branded primitive)
 * needs this to search and label its grid, but doesn't fetch game data
 * itself — this is the library-slice side of that split, for any caller
 * that shows the full bundled icon set rather than a narrower pool.
 */
export function useIconDisplayNames(): Map<string, string> {
  const items = useItems();
  const buildings = useBuildings();
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items.data ?? []) m.set(i.id, i.name);
    for (const b of buildings.data ?? []) m.set(b.id, b.name);
    return m;
  }, [items.data, buildings.data]);
}
