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
