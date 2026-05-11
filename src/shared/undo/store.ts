import { create } from "zustand";

/**
 * One reversible operation. `apply` is the forward action (does the work
 * the user just clicked); `reverse` is the inverse (puts the world back).
 * Both are async so they can dispatch Tauri commands.
 *
 * `label` shows up in the undo toast / menu — keep it short and noun-y
 * ("Add machine", "Toggle alt", "Set tier"), never a sentence.
 */
export interface UndoableAction {
  apply: () => Promise<unknown> | unknown;
  reverse: () => Promise<unknown> | unknown;
  label: string;
}

interface UndoState {
  /** Past actions, top = most recent. `undo()` pops from here. */
  past: UndoableAction[];
  /** Future actions stacked by `undo()`, top = most recently undone. */
  future: UndoableAction[];
  /** Most-recent toast message; consumed by the header overlay. */
  toast: { kind: "undo" | "redo"; label: string } | null;
  /**
   * Run `apply` then record the action so it can be undone. If `apply`
   * throws we don't push, so a failed mutation never lands on the stack.
   */
  push: (action: UndoableAction) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearToast: () => void;
  /**
   * Wipe both stacks. Call when the active playthrough changes so an
   * undo doesn't reverse an action against a different DB.
   */
  reset: () => void;
}

const HISTORY_CAP = 50;

export const useUndoStore = create<UndoState>((set, get) => ({
  past: [],
  future: [],
  toast: null,
  push: async (action) => {
    // Run the forward action first. If it throws we propagate and let the
    // caller surface the error — the failed action never enters history.
    await action.apply();
    set((s) => ({
      past: [...s.past.slice(-(HISTORY_CAP - 1)), action],
      // Forward history is invalidated as soon as the user does a fresh
      // action — standard undo-stack semantics, mirrors VS Code et al.
      future: [],
      toast: null,
    }));
  },
  undo: async () => {
    const top = get().past[get().past.length - 1];
    if (!top) return;
    await top.reverse();
    set((s) => ({
      past: s.past.slice(0, -1),
      future: [top, ...s.future],
      toast: { kind: "undo", label: top.label },
    }));
  },
  redo: async () => {
    const top = get().future[0];
    if (!top) return;
    await top.apply();
    set((s) => ({
      past: [...s.past, top],
      future: s.future.slice(1),
      toast: { kind: "redo", label: top.label },
    }));
  },
  clearToast: () => set({ toast: null }),
  reset: () => set({ past: [], future: [], toast: null }),
}));
