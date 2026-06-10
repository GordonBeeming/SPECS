#!/usr/bin/env bash
# Run the SPECS dev app, cleaning up any stale dev processes first.
# A previous run that didn't shut down cleanly leaves vite holding
# port 1420, which kills `tauri dev` before it starts — this script
# clears that up so `./run.sh` always works.
set -euo pipefail

cd "$(dirname "$0")"

VITE_PORT=1420

# Anything still holding the vite port is a leftover dev server.
stale=$(lsof -ti ":${VITE_PORT}" || true)
if [[ -n "${stale}" ]]; then
  echo "Killing stale process(es) on port ${VITE_PORT}: ${stale}"
  kill -9 ${stale} 2>/dev/null || true
fi

# Leftover app binary or tauri-dev wrapper from a crashed session.
pkill -9 -f "target/debug/specs$" 2>/dev/null || true
pkill -9 -f "tauri dev --config src-tauri/tauri.conf.dev.json" 2>/dev/null || true

exec bun run tauri:dev
