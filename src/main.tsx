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
