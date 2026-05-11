#!/usr/bin/env bun
/**
 * Fetch the 64-pixel icon for every item + building + generator in the
 * v1.1 dataset from the satisfactorytools GitHub repo into
 * `src/assets/icons/satisfactory/`.
 *
 * Naming: SF class names like `Desc_IronIngot_C` translate to the
 * file `desc-ironingot-c_64.png` in the source repo. The downloaded
 * files keep their original SPECS class-name basename
 * (`Desc_IronIngot_C.png`) so the runtime `<Icon itemId>` primitive
 * doesn't need a mapping table.
 *
 * Idempotent — skips files that already exist. Run once locally with
 * `bun run scripts/fetch-icons.ts`. Re-run any time the dataset gains
 * new ids.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const DATASET = resolve(REPO, "src-tauri/game-data/v1.1.json");
const OUT_DIR = resolve(REPO, "src/assets/icons/satisfactory");
const BASE =
  "https://raw.githubusercontent.com/greeny/SatisfactoryTools/master/www/assets/images/items";

mkdirSync(OUT_DIR, { recursive: true });

const dataset = JSON.parse(readFileSync(DATASET, "utf8"));
const ids: string[] = [];
for (const it of dataset.items ?? []) ids.push(it.id);
for (const b of dataset.buildings ?? []) ids.push(b.id);
for (const g of dataset.generators ?? []) ids.push(g.id);

// SatisfactoryTools' naming convention: every asset prefix is `desc-`
// (even for buildings, generators, recipes — the project keys
// everything off the descriptor class name internally). Strip the
// SPECS-side `Build_` / `Recipe_` prefix and the trailing `_C`, then
// rebuild as `desc-…-c_64.png`. The class names already carry their
// own `_C` suffix, so naively appending `-c` would give us `-c-c`.
// Manual aliases for SPECS-side ids whose canonical asset lives at a
// different upstream slug (purity variants share one art asset, etc).
const ALIAS: Record<string, string> = {
  Build_GeneratorGeoThermal_Impure_C: "desc-generatorgeothermal-c_64.png",
  Build_GeneratorGeoThermal_Normal_C: "desc-generatorgeothermal-c_64.png",
  Build_GeneratorGeoThermal_Pure_C: "desc-generatorgeothermal-c_64.png",
};

function urlFor(id: string): string {
  if (ALIAS[id]) return `${BASE}/${ALIAS[id]}`;
  const stripped = id
    .replace(/^(Desc_|Build_|Recipe_|BP_)/i, "")
    .replace(/_C$/i, "");
  const slug = stripped.toLowerCase().replace(/_/g, "-");
  return `${BASE}/desc-${slug}-c_64.png`;
}

let fetched = 0;
let skipped = 0;
let missing = 0;

for (const id of ids) {
  const outPath = resolve(OUT_DIR, `${id}.png`);
  if (existsSync(outPath)) {
    skipped += 1;
    continue;
  }
  const url = urlFor(id);
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      missing += 1;
      continue;
    }
    console.error(`error fetching ${id} (${url}): ${res.status}`);
    continue;
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  fetched += 1;
}

console.log(
  `fetched ${fetched} · skipped ${skipped} (already on disk) · missing ${missing}`,
);
