import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // CI exports SPECS_COMMIT_SHA / SPECS_BRANCH / SPECS_BUILD_TIME before
  // calling `bun run build` so the About modal can show the exact build
  // a user is running. Locally those env vars are unset and we fall back
  // to the "dev" sentinel — `isDevBuild` in `src/shared/build-info.ts`
  // keys off this so the modal can render "(local build)" instead of
  // a meaningless SHA.
  define: {
    __SPECS_COMMIT__: JSON.stringify(process.env.SPECS_COMMIT_SHA ?? "dev"),
    __SPECS_BRANCH__: JSON.stringify(process.env.SPECS_BRANCH ?? "dev"),
    __SPECS_BUILD_TIME__: JSON.stringify(
      process.env.SPECS_BUILD_TIME ?? new Date().toISOString(),
    ),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/shared/testing/setup.ts"],
    css: false,
    // Playwright owns the `tests/e2e/` tree — Vitest must not try to
    // load those specs (it'd error on the @playwright/test import).
    exclude: ["node_modules", "dist", "tests/e2e/**"],
  },
}));
