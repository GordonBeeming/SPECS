---
name: do-some-testing
description: Test part of SPECS by actually using it — drive the real UI over the Tauri MCP bridge, interrogate the experience as a designer while you work, and hand back a ranked findings report. Use when the user says "do some testing", "test the X flow", "go test X", or names a screen, feature or scenario to exercise. Takes what to test as its argument. Not for writing unit tests, and it reports findings rather than filing or fixing them.
---

# Do some testing

Use the app the way a person would, on purpose, and write down everything that gets in the way.

Two things come out of a session: bugs, and a tool that's nicer to use than it was. The second one is the reason this skill insists on the designer's eye rather than leaving it to whoever feels like offering an opinion — the friction that never gets written down never gets fixed.

## What to test

Take it from the argument. It can be:

- **A screen or flow** — "the resource claiming flow", "the Alts screen"
- **A feature** — "logistics links", "power"
- **A named scenario** — then that scenario's own page owns the work list, and this skill only owns how you go about it. `docs/test-scenarios/` holds those; `playthrough-test` drives the full-playthrough one.

With no argument, ask what to test rather than guessing.

## Before you start

- The dev app is running: `./run.sh` (Vite + Tauri with the MCP bridge).
- Connected over Tauri MCP — `driver_session` start, then the `webview_*` tools.
- You know where your findings log lives. The caller names it; a scenario supplies its own path.

## The stance

Wear the UX designer's hat the whole way through, not as a pass at the end. You're using the screen to get something done, and judging it at the same time.

[`references/ux-critique.md`](./references/ux-critique.md) carries the lens: what to interrogate on each screen, the capture format, and the severity ladder.

## Workflow

1. **Orient.** Start the driver session and get to the part of the app you're testing. How hard that was is itself the first finding.
2. **Do the real thing.** Work through the task as a user would, end to end. **Everything goes through the UI** — `ipc_execute_command` and backend-state reads are for asserting what the UI did, never for shortcutting a flow the UI owns. A flow you can't complete through the UI is the finding, not an obstacle to route around.
3. **Capture as you go.** Every hesitation goes in the log the moment it happens, with a screenshot of the state that confused you. Not reconstructed afterwards, and not filtered.
4. **Rank once you're done.** Sort by severity with the whole session in view, when you can tell a one-off annoyance from a pattern.
5. **Report.** Hand back the ranked findings. Filing is the caller's job — [`references/filing.md`](./references/filing.md) is there for whoever does it, and tells you what a finding needs to contain to be fileable.

## Rules that shape a session

**Capture everything, rank afterwards.** Step 3 has no severity filter. If it made you stop and think, it goes in the log — you lose nothing by recording a nit that turns out to be minor, and you lose a real finding every time you decide mid-flow that something wasn't worth writing down.

**Report; don't file.** You produce findings; the caller files them. A long session shouldn't stop every few minutes to open issues, and one reviewer between findings and the repo keeps the noise down.

**Report; don't fix.** Don't touch app code, don't patch data, don't tidy something on the way past. A trivial-looking fix is still separate work with its own plan.

**Say what worked.** A report that's only complaints is less useful than one that also names the two screens that got it right — those are the pattern everything else should be measured against, and they're easy to lose.

**The app's data is the source of truth.** Plan with the app's numbers even where you know the game disagrees, then record the discrepancy. Those gaps are half of what a session is for.

**Showstoppers stop the session.** If you genuinely can't continue, record where and why and hand back. Don't invent a workaround and keep going as though the flow works.
