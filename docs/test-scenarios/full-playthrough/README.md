# Full playthrough — Tier 0 to 9

Plan a complete Satisfactory playthrough in SPECS, start to endgame. The agent
creates a fresh playthrough at Tier 0 and works through every tier group:
claiming real map nodes, building factories sized to real rates, linking them
with logistics that respect the belts available at that tier, and producing a
committed set of layout artifacts a player could take into the game and build.

Read [`constraints.md`](./constraints.md) before starting — it's the rulebook
the whole run is judged against.

## Tier groups

Work through these in order. Each page lists what unlocks, what to build, and
the checkpoint that must pass before moving on.

| Group | Page | Headline unlocks |
| ----- | ---- | ---------------- |
| Tier 0 | [`tiers/tier-0.md`](./tiers/tier-0.md) | Smelter, Constructor, Miner Mk.1, Mk1 belts |
| Tiers 1–2 | [`tiers/tiers-1-2.md`](./tiers/tiers-1-2.md) | Assembler, Mk2 belts, Space Elevator Phase 1 |
| Tiers 3–4 | [`tiers/tiers-3-4.md`](./tiers/tiers-3-4.md) | Steel, coal power, Water Extractor, Mk3 belts, Miner Mk.2 |
| Tiers 5–6 | [`tiers/tiers-5-6.md`](./tiers/tiers-5-6.md) | Oil, Refinery, Manufacturer, Mk4 belts, Phase 3 parts |
| Tiers 7–8 | [`tiers/tiers-7-8.md`](./tiers/tiers-7-8.md) | Aluminum, Blender, nuclear, resource wells, Mk5 belts, Phase 4 |
| Tier 9 | [`tiers/tier-9.md`](./tiers/tier-9.md) | Converter, Quantum Encoder, SAM chain, Mk6 belts, Phase 5 |

## Run protocol

1. **Boot + connect.** `./run.sh`, then Tauri MCP `driver_session` start.
2. **Fresh playthrough.** Create one through the UI, starting tier 0. Name it
   after the run folder (`<YYYY-MM-DD>-<label>`).
3. **Per tier group, in order:**
   1. Set the playthrough tier to the group's top tier (through the UI).
   2. Unlock every alternate recipe with `unlock_tier <=` the current tier on
      the Alts screen — the run assumes the pioneer sweeps all reachable hard
      drives the moment a tier opens.
   3. Plan and build everything the tier page asks for: claim nodes, place
      water extractors, create/upgrade factories, set up plans, machines,
      power, and logistics links. Drive the UI for all of it.
   4. Verify the checkpoint checklist at the bottom of the tier page. Each
      checkpoint contains a check for the header's **Validate** button:
      run it and clear every finding — warnings included — before moving
      on. It sweeps tier gating, cross-factory flows, supply, power, and
      uncollected alts in one click, which replaces most of the by-hand
      assertions. Warnings matter here because supply gaps and per-factory
      power deficits report as warnings, and the alt-unlock step above
      should have emptied the shopping list. A finding you genuinely can't
      clear gets a bug report and an explanation in the run artifact, not
      a shrug.
   5. Write the tier's artifacts (below) before touching the next group.
4. **Finish.** Fill in the run index verdict, final screenshots, commit the
   run folder.

## Artifacts

Everything lands in `runs/<YYYY-MM-DD>-<label>/` — see
[`runs/README.md`](./runs/README.md) for the exact folder shape.

- **Run index** (`index.html`, from
  [`templates/run-index.html`](./templates/run-index.html)) — navigable map of
  the whole run: tiers → factories, the bug list, and the final verdict.
- **Factory layouts** (`factories/<slug>.html`, from
  [`templates/factory-layout.html`](./templates/factory-layout.html)) — one
  page per factory per tier it changes in. The 8×8 m foundation grid, machine
  placements, extractor hookups, and every belt segment labeled with its mark
  and items/min. An upgrade page shows the delta from the previous tier, not a
  re-description.
- **Bug reports** (`bugs/NNN-<slug>.md`, from
  [`templates/bug-report.md`](./templates/bug-report.md)) — numbered, linked
  from the index.
- **Screenshots** (`screenshots/`) — the checkpoint captures each tier page
  asks for.

## Past runs

None yet. Each run adds a row here:

| Date | Label | Verdict | Bugs filed |
| ---- | ----- | ------- | ---------- |
