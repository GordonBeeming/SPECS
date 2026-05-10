import { create } from "zustand";

type Mode = "light" | "dark";

const STORAGE_KEY = "specs.theme-mode";

const detectInitial = (): Mode => {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const apply = (mode: Mode) => {
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
};

interface ThemeStore {
  mode: Mode;
  setMode: (mode: Mode) => void;
  toggle: () => void;
}

export const useThemeMode = create<ThemeStore>((set, get) => ({
  mode: detectInitial(),
  setMode: (mode) => {
    window.localStorage.setItem(STORAGE_KEY, mode);
    apply(mode);
    set({ mode });
  },
  toggle: () => {
    const next: Mode = get().mode === "dark" ? "light" : "dark";
    get().setMode(next);
  },
}));

export const bootstrapTheme = () => {
  apply(useThemeMode.getState().mode);
};
