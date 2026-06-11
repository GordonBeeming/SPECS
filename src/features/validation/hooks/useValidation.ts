import { useMutation } from "@tanstack/react-query";

import { validationApi } from "../api";

/**
 * On-demand sweep — a mutation, not a query: the report is a snapshot
 * the user explicitly asks for, never background-refreshed (it walks
 * every factory's plan, so polling it would be rude).
 */
export function useValidation() {
  return useMutation({ mutationFn: validationApi.validate });
}
