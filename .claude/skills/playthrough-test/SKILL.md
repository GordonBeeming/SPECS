---
name: playthrough-test
description: Run one tier group of the full-playthrough end-to-end game test against the live SPECS app — drive the real UI over the Tauri MCP bridge, plan factories under the game's real constraints, critique the UX hard along the way, and file every finding as a GitHub issue with screenshots. Use when the user says "run the playthrough test", "run the game test", "end-to-end game test", "/playthrough-test", or names a tier group to run. Not for fixing the problems it finds, and not for the Playwright doc screenshots in tests/e2e/.
---

# Playthrough test

Drive SPECS the way a pioneer would: create a playthrough, claim nodes off the real map, size factories to rates that hold up, and link them with logistics the current tier can actually build. The run answers two questions at once — does the app still work after recent changes, and does it genuinely help someone plan a factory they could go build in the game?

The scenario lives in `docs/test-scenarios/full-playthrough/`. Read [`constraints.md`](../../../docs/test-scenarios/full-playthrough/constraints.md) before touching anything — it's the rulebook the run is judged against, and this skill doesn't restate it.

## Scope

One tier group per invocation. A full Tier 0→9 sweep is far more UI driving than one session can hold, so each run ends at a checkpoint and the next invocation picks up from the ledger.

Take the tier group from the user's argument (`tier-0`, `tiers-1-2`, `tiers-3-4`, `tiers-5-6`, `tiers-7-8`, `tier-9`). With no argument, resume the open run at its next unfinished group, or start a fresh run if none is open.

## Before you start

- The dev app is up: `./run.sh` (Vite + Tauri with the MCP bridge).
- Connected over Tauri MCP — `driver_session` start, then the `webview_*` tools.
- The `assets` release exists on `GordonBeeming/SPECS`. See [`references/pbi-filing.md`](./references/pbi-filing.md) for creating it, including the release-workflow guard that has to be on `main` first.

## The ledger

Each run owns `docs/test-scenarios/full-playthrough/runs/<YYYY-MM-DD>-<label>/RUN.md`, which is how a later invocation knows where to resume:

```markdown
# Run <YYYY-MM-DD>-<label>

- **Playthrough:** <the name given to it in the app>
- **Status:** in progress | complete | blocked at <group>

| Tier group | State | Issues |
| ---------- | ----- | ------ |
| tier-0     | done  | #12, #13 |
| tiers-1-2  | not started | — |
```

## Workflow

1. **Connect and orient.** Start the driver session. Read the ledger if a run is open; otherwise create the run folder and a fresh playthrough through the UI, named after the run folder.
2. **Open the tier.** Set the playthrough to the group's top tier, then unlock every alternate recipe with `unlock_tier` at or below it on the Alts screen. The run assumes the pioneer sweeps every reachable hard drive the moment a tier opens.
3. **Build what the tier page asks.** Claim nodes, place extractors, create factories, set up plans and machines, wire power and logistics. **Drive the UI for all of it** — `ipc_execute_command` and backend-state reads are for asserting what the UI did, never for shortcutting a flow the UI owns. A flow you can't complete through the UI is itself a finding.
4. **Critique while you build.** Every hesitation gets logged and screenshotted the moment it happens, not reconstructed afterwards. [`references/ux-critique.md`](./references/ux-critique.md) carries the lens and the capture format.
5. **Checkpoint.** Work the tier page's checklist, and run the header's **Validate** button until it comes back clean — warnings included, since supply gaps and per-factory power deficits report as warnings. A finding you genuinely can't clear becomes an issue with an explanation, not a shrug.
6. **Rank, then file.** Now sort the captured hesitations by severity and file them. [`references/pbi-filing.md`](./references/pbi-filing.md) has the mechanics.
7. **Write the artifacts.** Factory layout pages for anything built or changed this group, checkpoint screenshots, the run index, and the ledger row.
8. **Report back.** What you built, what worked, the issues filed with their numbers, and the verdict for the group.

## Rules that shape the run

**Capture everything, rank afterwards.** Step 4 has no severity filter — if it made you stop and think, it goes in the log. Judging what's worth filing happens in step 6, once you've seen the whole tier group and know which annoyances were one-offs and which are patterns. Filtering at capture time loses the finding before anyone can weigh it.

**Test and report; don't fix.** This skill files issues. It doesn't touch app code, doesn't patch data, and doesn't tidy something up on the way past. If a fix looks trivial and tempting, that's still a separate piece of work with its own plan.

**Stop at the checkpoint.** Finish the group, report, and hand back. Rolling on to the next tier group is the user's call.

**One driver.** The app is a single live session with real state, so this runs as one agent start to finish. Several subagents driving one UI would fight over it.

**The app's data is the source of truth.** Plan with the app's numbers even when you know the game disagrees, then file the discrepancy. Catching those gaps is half the point of the run.

**Showstoppers halt the run.** If you genuinely can't continue, file it, write where and why into the ledger with status `blocked at <group>`, and hand back.
