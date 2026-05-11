import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Reference-screenshot suite. Captures both light and dark variants
 * of each route at 1280×800 to `docs/screens/`. Run locally with:
 *
 *   bun run e2e:screenshots
 *
 * Anything that needs `invoke` to resolve before first paint (the
 * playthrough switcher's dropdown, anything inside the
 * factory/logistics/power slices) is screenshot'd in its initial
 * empty state — capturing real data flows is deferred to a packaged-
 * binary E2E pass.
 */

const OUT = resolve(import.meta.dirname, "../../docs/screens");
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { id: "home", nav: "Home" },
  { id: "library", nav: "Library" },
  { id: "alts", nav: "Alts" },
  { id: "factories", nav: "Factories" },
  { id: "power", nav: "Power" },
  { id: "network", nav: "Network" },
] as const;

for (const route of ROUTES) {
  for (const theme of ["light", "dark"] as const) {
    test(`${route.id} — ${theme}`, async ({ page }) => {
      await page.goto("/");
      // Theme toggle. The shell defaults to whichever mode `prefers-color-
      // scheme` resolves to in the test browser; force the explicit one
      // we want by clicking the toggle if needed.
      const html = page.locator("html");
      const currentMode = await html.evaluate((el) =>
        el.classList.contains("dark") ? "dark" : "light",
      );
      if (currentMode !== theme) {
        await page.getByRole("button", { name: "Toggle theme" }).click();
      }
      await page.getByRole("button", { name: route.nav }).click();
      // Settle in case TanStack Query is still in flight (it
      // resolves to empty data without a Tauri backend, so this
      // is short).
      await page.waitForTimeout(500);
      await page.screenshot({
        path: resolve(OUT, `${route.id}-${theme}.png`),
        fullPage: false,
      });
    });
  }
}
