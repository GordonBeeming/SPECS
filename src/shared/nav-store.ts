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
}

export const useNavStore = create<NavState>((set, get) => ({
  pendingFactoryId: null,
  selectFactory: (id) => set({ pendingFactoryId: id }),
  takePendingFactoryId: () => {
    const id = get().pendingFactoryId;
    if (id) set({ pendingFactoryId: null });
    return id;
  },
}));
