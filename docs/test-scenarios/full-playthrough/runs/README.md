# Runs

One folder per run, named `<YYYY-MM-DD>-<label>` (label = short slug, e.g.
`2026-06-15-first-smoke`). Everything in the folder is committed with the
run so diffs between runs show what changed.

Required shape:

```
<YYYY-MM-DD>-<label>/
  index.html          — from ../templates/run-index.html, fully filled in
  factories/
    <factory-slug>.html           — first full layout (templates/factory-layout.html)
    <factory-slug>-t<N>.html      — upgrade deltas per tier the factory changed in
  bugs/
    001-<slug>.md     — from ../templates/bug-report.md, numbered in order found
  screenshots/
    <tier>-<what>.png — the captures each tier page's checkpoint asks for
```

A run is complete when `index.html` carries a verdict (`worked`,
`worked-with-bugs`, or `blocked at <tier>`), links every factory page and
bug, and the scenario README's "Past runs" table has the new row.
