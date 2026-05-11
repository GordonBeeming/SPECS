#!/usr/bin/env bun
/**
 * Fetch SCIM's zoom-4 game-layer tiles (10×10 of 256 px = 2560×2560),
 * stitch them, and bundle as `src/assets/map/satisfactory-map.webp`.
 *
 * Why zoom-4 specifically: the resource-node catalog in
 * `nodes.json` carries Unreal world coords, and SCIM's leaflet
 * config (sniffed from their bundle) pins
 *     west=-324698.832031, east=425301.832031,
 *     north=-375000,       south=375000
 * to the zoom-3 5×5 tile grid. Zoom-4 is the same coordinate space
 * scaled 2× — same bounds, sharper image. Anything higher would
 * align too but adds bundle weight (zoom 5 = 20×20 = 5120 px,
 * ~3 MB after WebP compression).
 *
 * Re-running overwrites. The map url version pin (`?v=…`) is the
 * SCIM bundle's cache buster; the tile content doesn't change with
 * each version, so bumping the pin only affects new releases.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const OUT = resolve(REPO, "src/assets/map/satisfactory-map.webp");
const ZOOM = 4;
// SCIM's leaflet tile grid: dimensions = 5 * 2^(zoom-3).
const SIDE = 5 * 2 ** (ZOOM - 3);

const tmp = resolve(tmpdir(), `specs-map-tiles-${Date.now()}`);
mkdirSync(tmp, { recursive: true });

console.log(`Fetching ${SIDE * SIDE} tiles (zoom ${ZOOM}) into ${tmp}…`);
for (let y = 0; y < SIDE; y++) {
  for (let x = 0; x < SIDE; x++) {
    const url = `https://static.satisfactory-calculator.com/imgMap/gameLayer/Stable/${ZOOM}/${x}/${y}.png`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (SPECS map-stitch)" },
    });
    if (!res.ok) throw new Error(`tile ${x}/${y} → ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(resolve(tmp, `${y}-${x}.png`), buf);
  }
  process.stdout.write(".");
}
process.stdout.write("\n");

mkdirSync(dirname(OUT), { recursive: true });

const stitched = resolve(tmp, "stitched.png");
const rowPaths: string[] = [];
for (let y = 0; y < SIDE; y++) {
  const row = resolve(tmp, `row-${y}.png`);
  const rowTiles = Array.from({ length: SIDE }, (_, x) => resolve(tmp, `${y}-${x}.png`));
  const res = spawnSync("magick", [...rowTiles, "+append", row], { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`row ${y} stitch failed`);
  rowPaths.push(row);
}
const stack = spawnSync("magick", [...rowPaths, "-append", stitched], {
  stdio: "inherit",
});
if (stack.status !== 0) throw new Error("row stack failed");

const webp = spawnSync(
  "magick",
  [stitched, "-quality", "78", "-define", "webp:lossless=false", OUT],
  { stdio: "inherit" },
);
if (webp.status !== 0) throw new Error("webp convert failed");

rmSync(tmp, { recursive: true, force: true });

console.log(`wrote ${OUT}`);
