# Filing PBIs

Findings live in GitHub Issues on `GordonBeeming/SPECS`, screenshots and all. Nothing gets written into the run folder as a bug report — one home per finding, so nothing drifts.

File at the tier-group checkpoint rather than mid-flow, so the app session keeps moving while you're building.

## One-time: the assets bucket

`gh issue create` can't attach images — GitHub's drag-and-drop endpoint has no public API. A published release acts as the asset bucket instead.

Check whether it's there:

```bash
gh release view assets --repo GordonBeeming/SPECS
```

If it isn't, **confirm the guard is on `main` first**. `.github/workflows/release.yml` triggers on `release: types: [published]`, so publishing this bucket would otherwise fire the entire product pipeline — Tauri bundles on three runners, Apple notarisation, a Homebrew cask push, a winget submission. The `bundle` job carries `if: github.event_name != 'release' || github.event.release.tag_name != 'assets'` to stop that — the first clause short-circuits true on `workflow_dispatch`, which carries no release payload at all — and every other job needs `bundle`, so the guard covers the pipeline. GitHub runs the workflow as it exists on the default branch, so the guard has to be merged before the release is created — not sitting on a branch.

With that confirmed:

```bash
gh release create assets --repo GordonBeeming/SPECS --target main --prerelease \
  --title "Issue attachments (not a product release)" \
  --notes "Asset bucket for images embedded in issues and PRs. Upload with: gh release upload assets <file>. Not an app release — ignore."
```

It has to be a published prerelease, not a draft. Draft assets aren't publicly downloadable, so images embedded from one render broken for everyone else.

Never delete or repurpose it once URLs point at it, and never use a product tag (`v0.7`) as the bucket.

Because it's a prerelease, `create-release/SKILL.md` has to filter it out of its own release lookups (`gh release list --exclude-pre-releases`) — otherwise the next `create-release` run reads `assets` as the latest tag and drops real commits from its changelog.

## Screenshots

Asset names are unique across the whole release, so prefix every one with the session's `<YYYY-MM-DD>-<label>` before what it shows — two sessions hitting the same rough edge must not collide on the same filename. A scenario run uses its run-folder name as the label:

```
2026-07-25-iron-giant-t0-sources-panel-empty.png
2026-07-25-iron-giant-t3-4-coal-power-belt-mk-mismatch.png
```

Never `screenshot.png`. Upload, then confirm the URL resolves before you put it in an issue body:

```bash
gh release upload assets 2026-07-25-iron-giant-t0-sources-panel-empty.png --repo GordonBeeming/SPECS
curl -sIL https://github.com/GordonBeeming/SPECS/releases/download/assets/2026-07-25-iron-giant-t0-sources-panel-empty.png | grep ^HTTP
```

The last status has to be 200. `--clobber` replaces an asset of the same name if you're re-uploading a better capture.

The same file stays in the run folder's `screenshots/` — the run artifact and the issue embed share one capture.

## The issue

Search before filing. A second run hitting the same rough edge comments on the existing issue with the new run's context instead of opening a duplicate:

```bash
gh issue list --repo GordonBeeming/SPECS --state open --search "sources panel"
```

**Title** — prefix by kind, then say what's wrong in plain words. The title should be readable on its own in a list six months from now.

- `UX:` a flow, layout, or wording problem
- `Bug:` something broken or dead-ended
- `Data:` the app's library data disagreeing with the game

`UX: Sources panel is empty with no explanation when nothing is claimed yet` beats `UX: sources panel issue`.

**Body:**

```markdown
## What happened

<What the app did. Exact error text, exact numbers when data is wrong.>

## What I expected

<And why — what the game or the flow led me to expect.>

## Repro

1. <step>
2. <step>

## Impact

<What it costs the player. For friction, say how often it comes up over a playthrough.>

![<alt>](https://github.com/GordonBeeming/SPECS/releases/download/assets/<file>.png)

---
Found while testing `<what was being tested>` — session `<YYYY-MM-DD>-<label>`.
```

Keep it tight. Enough for someone to reproduce it cold, and nothing else — no summary of the summary, no section left in with "N/A" under it. Drop `Repro` entirely if the title and `What happened` already say it.

**Labels:**

| Severity | Labels |
| --- | --- |
| `showstopper`, `blocking-flow` | `bug`, `playthrough` |
| `wrong-data` | `bug`, `playthrough` |
| `friction`, `polish` | `enhancement`, `ux`, `playthrough` |

UX-flavoured `blocking-flow` findings take `ux` as well. `playthrough` goes on everything the run files, so the whole batch is one filter away.

Most `UX:`-titled findings are `friction`/`polish` severity, so most take `enhancement` + `ux` + `playthrough`:

```bash
gh issue create --repo GordonBeeming/SPECS \
  --title "UX: ..." --label enhancement --label ux --label playthrough --body-file <path>
```

A `UX:`-titled `blocking-flow` finding is the exception — swap `enhancement` for `bug`.

Both `ux` and `playthrough` are repo-specific labels this workflow depends on — create them once if they're missing:

```bash
gh label create ux --repo GordonBeeming/SPECS --color BFD4F2 --description "User experience and interaction quality"
gh label create playthrough --repo GordonBeeming/SPECS --color 5319E7 --description "Found by an end-to-end playthrough test run"
```

## After filing

Hand the issue numbers back to the session that found them. Where the session keeps a ledger — a scenario run does — record them there and link them from its index, because the ledger is what the next invocation reads and an unrecorded issue is one a later run will file all over again.
