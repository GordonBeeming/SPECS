/**
 * Build-time identity. Vite's `define` block in `vite.config.ts` rewrites
 * these globals at build time from the CI environment:
 *
 *   SPECS_COMMIT_SHA  — full git SHA the build was cut from
 *   SPECS_BRANCH      — branch name (or tag)
 *   SPECS_BUILD_TIME  — ISO timestamp when `bun run build` ran
 *
 * Locally (when nothing in CI ever set those env vars) the defaults
 * land here so the About modal still has something to render — see
 * vite.config.ts for the fallbacks.
 */

// Declared as module-level `const` (not `let`) so Vite/TS treat the
// usage as a plain compile-time constant. The values come from the
// global identifiers defined in `vite.config.ts` (`define` block).
declare const __SPECS_COMMIT__: string;
declare const __SPECS_BRANCH__: string;
declare const __SPECS_BUILD_TIME__: string;

export const buildInfo = {
  commit: __SPECS_COMMIT__,
  branch: __SPECS_BRANCH__,
  buildTime: __SPECS_BUILD_TIME__,
} as const;

/** Trimmed-to-7-character commit for the About modal. */
export const shortCommit = buildInfo.commit.slice(0, 7);

/** "dev" sentinel — true when no CI ever stamped the build. */
export const isDevBuild = buildInfo.commit === "dev";
