import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { queryClient } from "@/shared/query/client";
import { bootstrapTheme } from "@/shared/theme/useThemeMode";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import "@/shared/theme/brand.css";

bootstrapTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

// React owns the screen now — fade the index.html splash out and drop
// it from the DOM once the transition lands.
const splash = document.getElementById("splash");
if (splash) {
  requestAnimationFrame(() => {
    splash.classList.add("splash-done");
    window.setTimeout(() => splash.remove(), 300);
  });
}
