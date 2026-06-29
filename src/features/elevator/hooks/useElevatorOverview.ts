import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { elevatorApi } from "../api";

/**
 * Gated on an active playthrough — the Rust command returns
 * `Invalid("no active playthrough")` with none open, and the production
 * numbers are per-playthrough, so the id is part of the key (switching
 * playthroughs refetches rather than showing the previous run's output).
 */
export function useElevatorOverview() {
  const playthrough = useCurrentPlaythrough();
  return useQuery({
    queryKey: [...queryKeys.elevator.overview, playthrough.data?.id ?? null] as const,
    queryFn: elevatorApi.overview,
    enabled: !!playthrough.data,
  });
}
