# Test scenarios

Agent-run end-to-end tests that exercise SPECS the way a player would: boot the
real dev app, drive the actual UI, and plan factories under the game's real
constraints. They exist to answer two questions at once — does the app still
work after a big change, and does it actually help someone plan a factory they
could go build in the game?

Each scenario is a folder with everything an agent needs to run it cold:

```
docs/test-scenarios/
  <scenario-name>/
    README.md        — goal, run protocol, links to the detail pages
    constraints.md   — the rules the run must respect
    tiers/ or steps/ — the work, broken into ordered chunks
    templates/       — artifact templates the run fills in
    runs/            — committed outputs, one folder per run
```

## How an agent runs a scenario

1. Start the dev app with `./run.sh` (Vite + Tauri with the MCP bridge).
2. Connect over the Tauri MCP tools (`driver_session` start, then the
   `webview_*` and `ipc_*` tools).
3. Follow the scenario README top to bottom. **Drive the UI** — click through
   the real screens with `webview_interact`. Use `ipc_execute_command` /
   backend reads only to assert state, never to shortcut a flow the UI owns.
4. Screenshot checkpoints as you go; the scenario says where.
5. Write the run's artifacts into the scenario's own runs folder —
   `docs/test-scenarios/<scenario>/runs/<YYYY-MM-DD>-<label>/` — and commit
   them with the run.

## Bug reports are a deliverable

When the app fights you — wrong data, a flow that dead-ends, a number that
doesn't match the game — that's not a thing to work around quietly. File it
using the scenario's bug-report template, link it from the run index, and keep
going if you can. Severity `showstopper` means you genuinely can't continue:
stop the run, write up where and why, and hand back.

The app's own library data is the working source of truth during a run. If you
know the game disagrees with it, you still plan with the app's numbers — and
file the discrepancy as a bug. Catching those gaps is half the point.

## Scenarios

- [`full-playthrough/`](./full-playthrough/README.md) — plan an entire Tier
  0→9 playthrough: every component line, real node claims, real logistics,
  committed factory layouts per tier. The big regression test before large
  changes.
