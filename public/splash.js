// Pre-React theme hint for the splash screen. The app stores the
// chosen theme under `specs.theme-mode`; mirroring it onto <html>
// before first paint lets the splash colours match the app exactly
// (the CSS falls back to prefers-color-scheme when nothing is
// stored). Lives in its own file because the production CSP is
// `script-src 'self'` — inline scripts never run there.
(() => {
  try {
    const stored = window.localStorage.getItem("specs.theme-mode");
    if (stored === "dark" || stored === "light") {
      document.documentElement.classList.add(stored);
    }
  } catch {
    // localStorage unavailable — the prefers-color-scheme fallback applies.
  }
})();
