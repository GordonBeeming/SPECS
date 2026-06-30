import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryClient } from "@/shared/query/client";
import { DATA_CHANGED_EVENT } from "./invoke";

/**
 * Keeps this window's TanStack Query cache fresh when another window edits the
 * shared backend. Every window emits `data:changed` after a mutation (see
 * `invoke`); here we listen and invalidate, debounced so a burst of edits
 * (plan autosave, node drags) coalesces into one refetch pass. Self-emits are
 * harmless — the editing window just refetches data it already has.
 */
export function useCrossWindowSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = listen(DATA_CHANGED_EVENT, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries();
      }, 250);
    }).catch(() => () => {
      // Not in a Tauri window (or the event API is unavailable) — no-op.
    });

    return () => {
      if (timer) clearTimeout(timer);
      void unlisten.then((off) => off());
    };
  }, []);
}
