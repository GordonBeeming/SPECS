import { create } from "zustand";

/**
 * Tiny shared "navigation intent" store. Lets one slice request that
 * another slice select a specific record on its next mount —
 * specifically: the Home view's recent-factories tile asking the
 * Factories tab to open with that factory selected, instead of
 * landing on the empty "pick a factory" panel.
 *
 * Consumers `take()` the value to atomically read + clear it, so a
 * later remount doesn't accidentally re-open the same factory.
 */
interface NavState {
  pendingFactoryId: string | null;
  /** Set the next factory to select. Pair with a route change. */
  selectFactory: (id: string) => void;
  /** Atomic read + clear. Returns the id (or null) and resets state. */
  takePendingFactoryId: () => string | null;
  /**
   * Route the user wants the shell to switch to next render. AppShell
   * subscribes and clears after applying. Lets a deep-link from the
   * network view land directly on the factory graph without prop
   * drilling through every intermediate component.
   */
  pendingRoute: string | null;
  goTo: (route: string) => void;
  takePendingRoute: () => string | null;
}

export const useNavStore = create<NavState>((set, get) => ({
  pendingFactoryId: null,
  selectFactory: (id) => set({ pendingFactoryId: id }),
  takePendingFactoryId: () => {
    const id = get().pendingFactoryId;
    if (id) set({ pendingFactoryId: null });
    return id;
  },
  pendingRoute: null,
  goTo: (route) => set({ pendingRoute: route }),
  takePendingRoute: () => {
    const r = get().pendingRoute;
    if (r) set({ pendingRoute: null });
    return r;
  },
}));

interface PlanIntentState {
  planFirstRun: boolean;
}

// Module-level because zustand's NavState is already shaped — a tiny
// side-channel flag the shell takes (read + clear) alongside the
// pending factory id.
const planIntent: PlanIntentState = { planFirstRun: false };

export function takePlanFirstRunFlag(): boolean {
  const v = planIntent.planFirstRun;
  planIntent.planFirstRun = false;
  return v;
}

/**
 * Open the full-screen production-plan designer for a factory from
 * anywhere (factory detail, factories list, map pin popovers).
 * `firstRun` marks a just-created factory: the designer auto-opens
 * the product picker and offers "Cancel & delete".
 */
export function openPlanDesigner(factoryId: string, firstRun = false) {
  planIntent.planFirstRun = firstRun;
  useNavStore.getState().selectFactory(factoryId);
  useNavStore.getState().goTo("plan");
}
