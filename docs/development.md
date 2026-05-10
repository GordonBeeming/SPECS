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
bun run tauri dev
```

The Tauri shell launches with the Vite dev server. First boot takes a few
minutes — Cargo compiles ~400 crates from cold. Subsequent boots are fast.

You should see SPECS with a green health badge in the header showing the Rust
core version and host triple. That confirms IPC is working.

## Scripts

| Command                                              | What it does                                         |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `bun run tauri dev`                                  | Tauri shell + Vite dev server (the daily driver)     |
| `bun run dev`                                        | Vite only — browser, no Rust core                    |
| `bun run build`                                      | Vite production build                                |
| `bun run tauri build -- --no-default-features`       | Full bundle (.dmg / .msi / .AppImage), MCP bridge OFF |
| `bun run typecheck`                                  | `tsc --noEmit`                                       |
| `bun run test`                                       | Vitest watch mode                                    |
| `bun run test:run`                                   | Vitest single run (CI)                               |
| `cd src-tauri && cargo check`                        | Rust type-check                                      |
| `cd src-tauri && cargo test`                         | Rust unit + integration tests                        |

> **Production builds must pass `--no-default-features`** so the MCP bridge
> plugin is not compiled in. CI does this automatically; manual
> `bun run tauri build` on its own would ship a debugging hole.

## Tauri MCP server (development)

The `dev-mcp` Cargo feature (default-on) registers
[`tauri-plugin-mcp-bridge`](https://crates.io/crates/tauri-plugin-mcp-bridge)
so the [`@hypothesi/tauri-mcp-server`](https://github.com/hypothesi/mcp-server-tauri)
MCP can screenshot the running Tauri window, capture IPC traffic, and drive
the UI from an AI coding client.

The MCP is registered in this repo's local Claude Code config — no per-session
setup needed. Other clients can install it via
`npx -y install-mcp @hypothesi/tauri-mcp-server --client <client>`.

The bridge is **never** compiled into release builds because production builds
pass `--no-default-features`.

## Troubleshooting

- **Stuck on first compile**: don't kill it. Cargo first run on Tauri is 3–5
  minutes on Apple Silicon. `RUST_LOG=info` will surface progress.
- **`bun: command not found`**: `brew install oven-sh/bun/bun` and reopen the
  shell.
- **Port 1420 in use**: kill the stray `vite` or `tauri` process; the port is
  pinned by `vite.config.ts` so Tauri can find it.
- **WebView2 missing on Windows**: install from
  [microsoft.com/webview2](https://developer.microsoft.com/microsoft-edge/webview2/).

## Next steps

- Architecture rules: [`vsa/README.md`](./vsa/README.md)
- Visual standards: [`../DESIGN.md`](../DESIGN.md)
- Implementation plan: `~/.claude/plans/i-m-building-a-satisfactpory-snoopy-pebble.md`
