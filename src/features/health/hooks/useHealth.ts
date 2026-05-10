import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/query/keys";
import { healthApi } from "../api";

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: healthApi.check,
  });
}
