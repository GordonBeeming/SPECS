# Running SPECS locally

## Prerequisites

- **Bun** ≥ 1.3 — `brew install oven-sh/bun/bun`
- **Rust** ≥ 1.80 — `rustup install stable`
- Platform toolchain for Tauri 2 — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
  - macOS: Xcode Command Line Tools
  - Windows: WebView2 + MSVC build tools
  - Linux: webkit2gtk + the Tauri system deps

## First run

```sh
bun install
bun run tauri:dev
```

The Tauri shell launches with the Vite dev server. First boot takes a few
minutes — Cargo compiles ~400 crates from cold. Subsequent boots are fast.

You should see SPECS with a green health badge in the header showing the Rust
core version and host triple. That confirms IPC is working.

## Scripts

| Command                              | What it does                                                  |
| ------------------------------------ | ------------------------------------------------------------- |
| `./run.sh`                           | `bun run tauri:dev`, but kills any stale dev server holding port 1420 first |
| `bun run tauri:dev`                  | Tauri shell + Vite with the dev config overlay (the daily driver) |
| `bun run dev`                        | Vite only — browser, no Rust core                             |
| `bun run build`                      | Vite production build                                         |
| `bun run tauri build`                | Full bundle (.dmg / .msi / .AppImage), MCP bridge OFF, restrictive CSP |
| `bun run typecheck`                  | `tsc --noEmit`                                                |
| `bun run test`                       | Vitest watch mode                                             |
| `bun run test:run`                   | Vitest single run (CI)                                        |
| `cd src-tauri && cargo check`        | Rust type-check                                               |
| `cd src-tauri && cargo test`         | Rust unit + integration tests                                 |

The `tauri:dev` script bundles three dev-only choices in one place: the Cargo
feature flag (`--features dev-mcp`) that compiles in the MCP bridge, and the
config overlay (`tauri.conf.dev.json`) that loosens the CSP and enables
`withGlobalTauri` so the MCP bridge can drive the webview. `tauri build`
ignores both, so production bundles are always shipped without the bridge and
with the strict CSP.

## Tauri MCP server (development)

The `dev-mcp` Cargo feature (off by default) registers
[`tauri-plugin-mcp-bridge`](https://crates.io/crates/tauri-plugin-mcp-bridge)
so the [`@hypothesi/tauri-mcp-server`](https://github.com/hypothesi/mcp-server-tauri)
MCP can screenshot the running Tauri window, capture IPC traffic, and drive
the UI from an AI coding client.

The MCP is registered in this repo's local Claude Code config — no per-session
setup needed. Other clients can install it via
`npx -y install-mcp @hypothesi/tauri-mcp-server --client <client>`.

## Troubleshooting

- **Stuck on first compile**: don't kill it. Cargo first run on Tauri is 3–5
  minutes on Apple Silicon. `RUST_LOG=info` will surface progress.
- **`bun: command not found`**: `brew install oven-sh/bun/bun` and reopen the
  shell.
- **Port 1420 in use**: kill the stray `vite` or `tauri` process; the port is
  pinned by `vite.config.ts` so Tauri can find it.
- **WebView2 missing on Windows**: install from
  [microsoft.com/webview2](https://developer.microsoft.com/microsoft-edge/webview2/).

## Game data updates

The bundled dataset (`src-tauri/game-data/v1.2.json`) is converted from
satisfactory-calculator.com's gameData dump — the same source (and the
same attribution) as the resource-node catalog. To bump it for a new
game version:

1. Fetch a fresh copy of
   `https://static.satisfactory-calculator.com/data/json/gameData/en-Stable.json`
   in a browser (Cloudflare gates non-browser user agents) and drop it
   over `scripts/fixtures/satisfactory-calculator-gamedata-<version>.json`.
2. Update `GAME_VERSION`, the fixture path and the output path in
   `scripts/convert-game-data.ts`, then `bun run scripts/convert-game-data.ts`.
   The script validates the result (recipe counts, the SAM chain,
   referential integrity) and refuses to write a regressed dataset.
3. Point `src-tauri/src/shared/gamedata/loader.rs`'s `include_str!` at
   the new file, delete the old one, and run the full test suites — the
   planner tests pin game-truth rates, so a parse mistake shows up as a
   failing ratio, not a silent drift.

Recipe unlock tiers come from the dump's own milestone schematics
(`schematicsData` carries a tier plus the recipes each milestone
unlocks). MAM research and alternate-blueprint schematics have no tier
there, so those fall back to hand overrides for the SAM chain, then the
old scan tiers carried by recipe id from
`scripts/fixtures/recipe-tiers-v1.1.json`, then the building's unlock
tier.

**Open question (parked until after 1.2):** playthroughs persist item
and recipe ids in SQLite, so a dataset bump can orphan saved plans —
removed recipes already degrade gracefully (stale overrides drop, warn
don't block), but a real upgrade pass on playthrough open (validate
stored ids, surface what changed) is still to be designed. Not a
release blocker while the app is unreleased.

## Next steps

- Architecture rules: [`vsa/README.md`](./vsa/README.md)
- Visual standards: [`../DESIGN.md`](../DESIGN.md)
