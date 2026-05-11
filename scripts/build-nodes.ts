#!/usr/bin/env bun
/**
 * Convert satisfactory-calculator.com's interactive-map JSON dump into the
 * SPECS resource-node catalog under `src-tauri/game-data/nodes.json`.
 *
 * Source: https://satisfactory-calculator.com/en/interactive-map — the page
 * loads `static.satisfactory-calculator.com/data/json/mapData/en-Stable.json`,
 * which we've snapshotted under `scripts/fixtures/`. Re-fetching is a manual
 * step (Cloudflare gates non-browser UAs) — drop the latest copy into the
 * fixture path and re-run.
 *
 * Attribution: satisfactory-calculator.com map data. Cited in About modal +
 * DESIGN.md. Counts and coordinates are factual game data; we redistribute
 * the per-node list (id/purity/coords) only — none of their UI or icons.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const FIXTURE = resolve(REPO, "scripts/fixtures/satisfactory-calculator-mapdata.json");
const OUT = resolve(REPO, "src-tauri/game-data/nodes.json");

if (!existsSync(FIXTURE)) {
  console.error(`fixture missing: ${FIXTURE}`);
  console.error(
    "fetch a fresh copy from https://static.satisfactory-calculator.com/data/json/mapData/en-Stable.json and drop it at the path above.",
  );
  process.exit(1);
}

import { convertMapData } from "./build-nodes.lib";

const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
const out = convertMapData(raw);

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");

const summary: Record<string, Record<string, number>> = {};
for (const n of out) {
  summary[n.resourceItemId] ??= { Impure: 0, Normal: 0, Pure: 0 };
  summary[n.resourceItemId][n.purity]++;
}
console.log(`wrote ${out.length} nodes → ${OUT}`);
for (const [item, counts] of Object.entries(summary)) {
  console.log(`  ${item.padEnd(28)} I:${counts.Impure}  N:${counts.Normal}  P:${counts.Pure}`);
}
