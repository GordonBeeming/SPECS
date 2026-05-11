import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright reference-screenshot config.
 *
 * Targets the Vite dev server (the same one `tauri:dev` boots) so the
 * suite can run in CI without packaging a real Tauri shell. The
 * downside is that Tauri `invoke` calls won't resolve under the
 * browser context — the specs cover routes whose first paint doesn't
 * depend on backend data (Home, About) and the catch-all empty
 * states that render before TanStack Query settles. Anything that
 * actually drives the Rust backend in CI lives in a follow-up
 * once a packaged binary is reachable.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: {
    command: "bun run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
