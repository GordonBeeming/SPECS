# Runs

One folder per run, named `<YYYY-MM-DD>-<label>` (label = short slug, e.g.
`2026-06-15-first-smoke`). Everything in the folder is committed with the
run so diffs between runs show what changed.

Required shape:

```
<YYYY-MM-DD>-<label>/
  RUN.md              — the ledger: playthrough name, per-group state, issues filed
  index.html          — from ../templates/run-index.html, fully filled in
  factories/
    <factory-slug>.html           — first full layout (templates/factory-layout.html)
    <factory-slug>-t<N>.html      — upgrade deltas per tier the factory changed in
  screenshots/
    <tier>-<what>.png — checkpoint captures, plus anything backing an issue
```

`RUN.md` is the resume point — a run spans several invocations, one tier group
each, and the ledger is how the next one knows where to pick up:

```markdown
# Run <YYYY-MM-DD>-<label>

- **Playthrough:** <the name given to it in the app>
- **Status:** in progress | complete | blocked at <group>

| Tier group | State | Issues |
| ---------- | ----- | ------ |
| tier-0     | done  | #12, #13 |
| tiers-1-2  | not started | — |
```

Findings are GitHub issues, so nothing lands here as a bug report — record the
numbers in the ledger and link them from the index.

A run is complete when every tier group is done, `index.html` carries a verdict
(`worked`, `worked-with-bugs`, or `blocked at <tier>`), links every factory page
and issue, and the scenario README's "Past runs" table has the new row.
