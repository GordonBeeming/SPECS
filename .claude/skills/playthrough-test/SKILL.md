---
name: playthrough-test
description: Run one tier group of the full-playthrough end-to-end game test against the live SPECS app — drive the real UI over the Tauri MCP bridge, plan factories under the game's real constraints, critique the UX hard along the way, file every finding as a GitHub issue with screenshots, then fix the whole batch with delegated teammates and review it past the 95% bar before the next group starts. Use when the user says "run the playthrough test", "run the game test", "end-to-end game test", "/playthrough-test", or names a tier group to run. Not for the Playwright doc screenshots in tests/e2e/.
---

# Playthrough test

Drive SPECS the way a pioneer would: create a playthrough, claim nodes off the real map, size factories to rates that hold up, and link them with logistics the current tier can actually build. The run answers two questions at once — does the app still work after recent changes, and does it genuinely help someone plan a factory they could go build in the game?

The scenario lives in `docs/test-scenarios/full-playthrough/`. Read [`constraints.md`](../../../docs/test-scenarios/full-playthrough/constraints.md) before touching anything — it's the rulebook the run is judged against, and this skill doesn't restate it.

## Run the whole thing without coming back

**A full sweep means Tier 0 through Tier 9 in one session, and the run does not pause between groups for anything.** Finish a group, ship it, start the next one. Don't report and wait. Don't offer to continue. Don't ask whether to hold while someone reviews the PR — the PR is review's problem, not the run's, and a group that's pushed is finished as far as the next group is concerned.

The report at the end of a group is a status line on the way past, not a question. Write it, then open the next tier page and keep going. "Ready to start Tiers 1–2 whenever you want it" is the failure this paragraph exists to stop: the answer is always yes, it was yes when the sweep was asked for, and every hour spent waiting for someone to say so again is an hour of the run not happening.

The only thing that ends a sweep early is a showstopper you genuinely cannot get past, and even then it gets filed and written into the ledger before you hand back. Running out of things to fix isn't a reason to stop; it's the reason to open the next tier.

## Scope

One tier group per invocation *when a single group was named*. A full sweep runs every group back to back — see above. A full Tier 0→9 sweep is far more UI driving than one session can hold, so each run ends at a checkpoint and the next invocation picks up from the ledger.

Take the tier group from the user's argument (`tier-0`, `tiers-1-2`, `tiers-3-4`, `tiers-5-6`, `tiers-7-8`, `tier-9`). With no argument, resume the open run at its next unfinished group, or start a fresh run if none is open.

A named group past `tier-0` requires every earlier group to already be `done` in an open run's ledger — later groups extend factories the earlier ones build. If the ledger doesn't show that, refuse and say which group to run first instead of starting fresh; starting a brand-new run is only valid for `tier-0` or the no-argument case above.

## Before you start

- The dev app is up: `./run.sh` (Vite + Tauri with the MCP bridge).
- Connected over Tauri MCP — `driver_session` start, then the `webview_*` tools.
- Screenshots reach GitHub through the `git-workflow:github-upload-file` skill, which owns the `assets` release on `GordonBeeming/SPECS` and hands back the URL to embed. Invoke it rather than uploading by hand; [`do-some-testing/references/filing.md`](../do-some-testing/references/filing.md) covers the naming the run needs and the release-workflow guard behind it.

**How to test is the `do-some-testing` skill's job, not this one's.** It owns driving the UI, the UX lens, capture and ranking, and the filing mechanics. This page owns what to build and what "done" means for each tier group.

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
4. **Critique while you build.** Every hesitation gets logged to the run folder's `hesitations.md` and screenshotted the moment it happens, not reconstructed afterwards. [`do-some-testing/references/ux-critique.md`](../do-some-testing/references/ux-critique.md) carries the lens and the capture format.
5. **Checkpoint.** Work the tier page's checklist, and run the header's **Validate** button until it comes back clean — warnings included, since supply gaps and per-factory power deficits report as warnings. A finding you genuinely can't clear becomes an issue with an explanation, not a shrug.
6. **Rank, then file.** Now sort the captured hesitations by severity and file them, then clear the filed entries from `hesitations.md` — a checkpoint always ends with that file empty, so the next tier group starts from a blank log. [`do-some-testing/references/filing.md`](../do-some-testing/references/filing.md) has the mechanics.
7. **Fix the batch before moving on.** Everything filed this group gets fixed now, so the next group tests an app that no longer has these problems. Plan the batch through `global:plan-delegated` and hand the work to right-sized teammates, review what comes back, and land it. Re-run the group's checkpoint against the fixed build: a finding that survives its own fix is worth more than the original report.

   **The group ends merged, not pushed.** Take the batch all the way through `git-workflow:pull-request` — draft, bot review rounds, publish, merge — and only then start the next tier. A draft PR left open is the same stall as stopping to ask: the next group builds on this one, so it wants the fixes on `main`, not sitting in review. Leaving it draft "for someone to look at" is a decision nobody asked for.

   Nothing leaves the machine until `git-workflow:review-branch` has run over the batch as a whole — the fixes, the scenario doc edits and the run artifacts together, not one commit at a time. A batch of a dozen small fixes lands as one change and deserves one review of that change.

   **The bar is 95% and the loop runs until it's met.** Review, fix what came back, review again, and keep going round; one pass that finds twelve things and fixes ten is not a finished batch. At least 95% of the panel's findings resolved, no unresolved blocker at any severity, and the tier's own checkpoint still green on the fixed build. Only then push and start the next group. If a round keeps surfacing the same class of problem, that's the signal to fix the cause rather than the instances.
8. **Write the artifacts.** Factory layout pages for anything built or changed this group, checkpoint screenshots, the run index, and the ledger row with the issue numbers and where they landed.
9. **Report back.** What you built, what worked, the issues filed and fixed with their numbers, and the verdict for the group.

## Rules that shape the run

**Capture everything, rank afterwards.** Step 4 has no severity filter — if it made you stop and think, it goes in the log. Judging what's worth filing happens in step 6, once you've seen the whole tier group and know which annoyances were one-offs and which are patterns. Filtering at capture time loses the finding before anyone can weigh it.

**One tier group's fixes at a time, and never alongside a live PR loop.** The previous group's PR keeps running its bot rounds while you play the next tier, and that autopilot commits to the same working tree your fix teammates are editing. Two owners of one tree means a `--changes` commit can sweep up someone else's half-finished work, and a review bot's finding can land in a file a teammate is mid-rewrite on. Before starting a group's fix batch, check what the PR loop is holding; if a bot finding falls in a file your teammates own, route it to whoever already owns that file rather than letting the autopilot in. Tell the autopilot explicitly which files are off limits — it can't see your teammates.

**Call a freeze before you verify.** Teammates fixing a batch in parallel share one working tree, so a suite run while two of them are mid-edit reports a different answer every few minutes and none of those answers are about the thing you're checking. Worse, it wastes everyone's time chasing failures that belong to someone else's half-finished rename. So the endgame is serialised: every teammate reports done and then stops touching files, and only then does the lead run the gates and the second review. A teammate whose own slice is green should say so with an isolated run and wait, rather than re-running the whole suite against moving ground.

**Revert the fix and watch the test go red.** A test written alongside a fix is the least trustworthy kind, because it was authored by someone who already knew the answer — so prove it can fail. Restore the bug, run the test, confirm it goes red, put the fix back. Fixes in this batch shipped with tests that couldn't see them: one asserted a value that was already the default, so the fix and the bug produced the same result, and another asserted a mutation synchronously when it lands in a microtask, so "not called" held either way.

That second kind hides from revert-to-red as well, since it fails to fail in both directions. The catch for it is a **positive control** in the same test: assert the thing does happen in the case where it should. If the control doesn't pass, the test is measuring nothing at all.

**A test over a derived set has to pin the set's boundary.** Asserting that the five things you expect are present, and a few you don't want are absent, passes just as happily over a set three times the size — which is how a fix that quietly exempted twelve extra items shipped through a green suite. Assert the count, or the whole set, or the nearest neighbour that must stay out. The same trap catches any test written against a computed collection: a filter, a reachability closure, a category exclusion.

**A visual fix owes DESIGN.md an edit.** `CLAUDE.md` requires `DESIGN.md` to be updated *before* component standards, icon usage or visual behaviour change, and the batch at the end of a tier group is exactly where that gets forgotten — the teammates are each holding one issue and nobody is holding the design system. So the brief says it, and the review checks it. A doc that still describes the behaviour you just replaced is worse than no doc: it contradicts the test that now pins the new behaviour, and the next reader has no way to tell which one is stale.

**Don't stop to ask — run the group to the end.** Steps 1 through 9 are the whole job, and a group left sitting at "shall I file these?" or "want me to plan the fixes?" has burnt whatever hours passed before anyone read the question. File the findings, plan the batch, fix it, review it past the bar, push, and only then report. Approval for the run was given when the run was asked for. The one thing that justifies stopping early is a showstopper you cannot get past, and even that gets filed and written into the ledger before you hand back.

**Don't fix mid-tier.** While you're building, app code is off limits, however trivial and tempting the fix looks — stopping to patch something loses the thread of the playthrough and biases what you notice next. Findings go in the log and wait for step 7, where the whole batch is planned and fixed together.

**Stop at the checkpoint.** A group is finished once its findings are filed, fixed, reviewed past the 95% bar and pushed. Then report — and if the run was asked for as a full sweep, or as a named span of tiers, carry straight on into the next group rather than asking whether to. Only a single named group ends the session at its checkpoint.

**One driver.** The app is a single live session with real state, so this runs as one agent start to finish. Several subagents driving one UI would fight over it.

**The app's data is the source of truth.** Plan with the app's numbers even when you know the game disagrees, then file the discrepancy. Catching those gaps is half the point of the run.

**Showstoppers halt the run.** If you genuinely can't continue, file it, write where and why into the ledger with status `blocked at <group>`, and hand back.

**Play it from the map.** The map and the factory you're inside are the two screens a pioneer should be able to run a whole tier from. Claim on the node, drop the pin, open the factory, build. Every trip to a list screen to get something done is a finding — `constraints.md` has the rule and what to log.

**Check the code before calling something missing.** "The map can't do X" and "the map can do X and I couldn't find it" are different bugs with different fixes, and only one of them is a missing feature. So when a flow looks absent, read the slice before you write the finding — the handler may already be there behind a gesture, a modifier key, a hover affordance or a second click. A capability nobody can discover is usually the worse bug, and it gets filed as one: say what the code supports, what the screen showed instead, and what you tried.

**Never work around a flow that doesn't work.** This is acceptance testing: the job is to find the bugs and the missing features, and a workaround hides both. When the map or the factory view can't do something, that *is* the result — file it as a missing feature, write it into the tier artifact, and carry on with the next thing. Don't reach for another screen, the console, or an IPC call to get the same outcome by other means. A run that quietly routed around three dead ends reports a clean tier and ships three bugs.

If the blocked step gates everything after it, the group is `blocked`, not done. Say so in the ledger and hand back.

**Writing to the repo reloads the app.** The dev server watches the whole project root, so saving anything — a hesitation, an artifact, a skill edit — full-reloads the webview and drops you back on Home. Saved work survives; an open dialog or a half-finished form does not. Keep the running log somewhere outside the repo while you build and copy it into the run folder at the checkpoint, and save doc edits when you're between flows rather than mid-form.

**The skill learns from the run.** A playthrough is the only place some of these lessons show up, and the next run starts from whatever this page says. So when the run teaches you something — a flow that only works in one order, a number the app derives differently than you assumed, a rule an earlier run got wrong — write it into this skill, `constraints.md`, or the tier page it belongs to, then and there. Encode the standing rule, not the run that found it: "claim the node before the factory needs it" rather than "on the 12 Aug run the sources panel was empty". Small corrections need no permission; changing what a tier group is *for* is Gordon's call.
