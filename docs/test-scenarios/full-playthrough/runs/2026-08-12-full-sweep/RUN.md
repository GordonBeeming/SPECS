# Run 2026-08-12-full-sweep

- **Playthrough:** 2026-08-12-full-sweep (created 12 Aug 2026 at Tier 0, game `1.2`)
- **Status:** in progress

Played from the map and the factory view only, per `constraints.md`. Every trip
to a list screen is recorded as a finding rather than treated as the way through.

| Tier group | State | Issues |
| ---------- | ----- | ------ |
| tier-0     | done — shipped as PR #126, merged `fbf6b410` | #113–#121, #124, #125 fixed |
| tiers-1-2  | done — shipped as PR #133, merged `d33c37c0` | #127–#131 fixed, #132 open |
| tiers-3-4  | started — Steel Mill part-built, checkpoint not attempted | — |
| tiers-5-6  | not started | — |
| tiers-7-8  | not started | — |
| tier-9     | not started | — |

## Tier 0

### What was built

**Claims — 4 nodes, 165 ipm**

| Ore | Node | Purity | Extractor | Clock | Rate | Feeds |
| --- | ---- | ------ | --------- | ----- | ---- | ----- |
| Iron | #N6 · 1.9 km W · 1.2 km N | Normal | Miner Mk.1 | 50% | 30/min | Iron Works |
| Iron | #N13 · 1.9 km W · 1.1 km N | Normal | Miner Mk.1 | 50% | 30/min | Iron Works |
| Copper | 1.7 km W · 1.3 km N | Normal | Miner Mk.1 | 50% | 30/min | Copper Works |
| Limestone | 1.7 km W · 1.3 km N | Pure | Miner Mk.1 | 37.5% | 45/min | Copper Works |

Two miners at 50% rather than one at 100% keeps each belt at 30/min, so no
segment goes near the Mk1 cap and each smelter is fed by its own miner with no
splitter in between.

**Iron Works** — 1.7 km W · 1.3 km N. Iron Plate 20/min, Iron Rod 20/min,
Screws 40/min. 2 Smelters, 4 Constructors, 2 Miner Mk.1 · 28.0 MW.
Iron Ore 60/min needed, 60/min claimed.

**Copper Works** — 1.4 km W · 1.0 km N. Wire 30/min, Cable 15/min,
Concrete 15/min. 1 Smelter, 4 Constructors, 2 Miner Mk.1 · 21.0 MW.
Copper Ore 30/min and Limestone 45/min needed, both fully claimed.

Neither plan carries a supply warning.

### Power

One Biomass Burner per factory, 30 MW each, hand-fed with Wood at 18/min.
Grid: 60 MW generated against 49 MW drawn, +11 MW.

Adding either of them was impossible until #113 landed — the fuel picker
offered nothing at any tier, so a Tier 0 playthrough could not be powered at
all.

### Checkpoint — green on the fixed build

| Check | Result |
| ----- | ------ |
| No belt segment over 60/min | pass — worst segment is the 45/min limestone run |
| Every input traces to a claimed node | pass — no supply warnings on either plan |
| Power balance ≥ 0 | pass — +2 MW Iron Works, +9 MW Copper Works |
| Validate → no findings | pass — "Nothing to fix at T0", 0 errors, 0 warnings, 2 notes |

The two notes are the hand-fed burners, which is the shape #121 gave them:
Wood has no node to claim and no recipe that makes it, so the burner reports as
a note rather than a shortfall the player can never clear.

### Findings

Filed, fixed, and re-checked against the fixed build in the same session.

| # | Severity | Title |
| - | -------- | ----- |
| #113 | showstopper | Biomass Burner has no selectable fuel, so no generator can be added at any tier |
| #114 | blocking-flow | Map claim popup ignores the selected factory and defaults to "— none —" |
| #115 | wrong-data | Product picker offers Crude Oil, Nitrogen Gas and Water at Tier 0, plus a raw blueprint id |
| #116 | friction | The map's claim flow withholds the numbers you need to make the choice |
| #117 | friction | The map factory card reports a missing input it can't help you fix |
| #118 | friction | "Add power" inside a factory throws you out of the factory |
| #119 | polish | Icon results, map-position fields and the claim row don't say what they mean |
| #120 | wrong-data | Editing a claim from the Resources row silently wipes its notes |
| #121 | blocking-flow | Hand-gathered generator fuel warns forever because the fuel check demands a claim |

#120 and #121 were found by the fixes rather than by playing: #120 while
checking whether rebinding a node preserved a deliberate underclock, and #121
by #113 removing the wall that had been hiding it.

#122 (Geothermal Generator pinned at T8 while its cost chain resolves to T6)
was found by the same sweep but deliberately not fixed here — moving a
generator two tiers earlier changes what power a T6 playthrough is offered,
which is a gameplay decision rather than the data-consistency work that
surfaced it.

### What the fixes broke

The batch that fixed nine issues introduced three regressions of its own, all
caught by review and none caught by the test suite, which was green for every
one of them.

- **The #121 fix hid every biofuel shortfall.** `hand_gathered_only_items`
  used the predicate "no automated tier, but a hand-gathered one", which is the
  transitive closure rather than the pickups — 17 items, including Liquid
  Biofuel, a Refinery product that travels by pipe. A Fuel Generator burning
  270/min against 60 supplied stopped warning and started printing "which is
  hand-gathered — there's no node to claim for it". The gate is now
  `is_hand_gathered` directly, and the function is deleted.
- **The #115 fix deleted a buildable product.** Excluding the `equipment`
  category to stop a blueprint id leaking also removed the Portable Miner,
  which has a real Assembler recipe at T3. The test encoded the removal as
  intended, so it locked the regression in.
- **`claimIntent` could rewrite a saved binding.** The intent set by "Claim a
  node" was never cleared, so reopening that node later showed the intended
  factory over the saved one, and any edit silently committed it.

The first slipped through 365 passing tests because its test asserted five
members present and four absent without ever bounding the set. That lesson is
now in the skill: a test over a derived set has to pin the boundary.

### Verified on screen, not just in tests

The claim card anchors beside the marker and stays inside the viewport at the
bottom edge; Enter opens a node card, focus moves into the dialog, and Escape
closes it and returns focus to the exact marker; resizing 1920→1200 with a card
open re-clamps it rather than stranding it off-screen. That last path has no
test — `ResizeObserver` is a no-op stub in this jsdom setup.

### What the run got wrong

Four of the nine issues stated something about the code that turned out to be
false. Recorded here because a run that only reports its hits is not a useful
record.

- **#113** asked for all five biomass fuels at tier 0. Solid Biofuel belongs at
  2, since `Recipe_Biofuel_C` is a Tier 2 recipe — putting it at 0 would have
  been #115's own bug in reverse.
- **#115** said Tier 0 unlocks nine products. It's eight; the three wrong rows
  had been counted into the total.
- **#116** claimed the factory card anchors near its pin, and that an unclaimed
  node's yield is hidden. The card is docked bottom-right, and the yield is
  genuinely `0` until a claim exists — the fix derives it from the placement
  loadout and says so.
- **#119.3** asked for the claim row to follow the editor live. That row was
  deliberately frozen under #49, with a test guarding it. The fix keeps both
  goals: the row follows the draft and grows an `unsaved` pill when it diverges.

## Tiers 1–2

Tier set to 2 on entry; all 7 alts reachable at T2 unlocked in one press of
"Select reachable".

### What was built

**Elevator Yard** (new) — 2.1 km W · 1.0 km N. Smart Plating 5/min for Space
Elevator Phase 1. 3 Assemblers · 35.4 MW. Both inputs imported from Iron Works;
claims none of its own. Layout: [`factories/elevator-yard.html`](factories/elevator-yard.html).

**Iron Works** (delta) — gained Reinforced Iron Plate 5/min, Rotor 9/min and
Modular Frame 4/min, and became the run's first exporter. 36 machines +
4 extractors · 207.8 MW, up from 6 machines · 28.0 MW at Tier 0. Iron ore
demand went 60 → 280.9/min, covered by two new Pure nodes at 100% (120/min
each) alongside the two original Normals, 300/min claimed in total.

The optimizer picked Stitched Iron Plate for RIP, which needs Wire, so Iron
Works grew a wire line of its own — fed by the Iron Wire alt from iron ingot
rather than by copper.

**Copper Works** (delta) — gained Copper Sheet 10/min. Adding it pushed part of
the wire production onto the Iron Wire alt, so Copper Works now needs 22.2/min
of iron ore and claims a Normal node at 50% for it.

**Power** — 11 Biomass Burners across the three factories, 330 MW generated
against 274 MW drawn.

### Checkpoint

| Check | Result |
| ----- | ------ |
| Phase 1 deliverable planned | pass — Smart Plating 5/min |
| Iron Works → Elevator Yard link with a belt plan | pass — two Mk2 links, 5/min each |
| No belt segment over 120/min | see below — two segments need parallel belts |
| Validate (before fixes) | 0 errors, 2 warnings, 3 notes |
| Validate (on the fixed build) | **"Nothing to fix at T2" — 0 errors, 0 warnings, 5 notes** |

The two belt warnings became notes once #130 landed, phrased as layout facts —
"Screws segment runs 225.0/min — needs 2 belts at Mk.2 (120/min each)" — because
running parallel belts is normal play, not a defect to clear. The fuel notes
were reworded by #131 to "every route to it starts with hand-gathered pickups,
so no build removes the gathering", which is true of a fluid you can only pipe
as well as a solid you can shovel; the old wording told you to hand-feed
Liquid Biofuel.

### Findings

| # | Severity | Title |
| - | -------- | ----- |
| #127 | blocking-flow | "import instead" adds the source with zero flow, so nothing changes |
| #128 | friction | Unlocking alts silently re-plans factories the player already built |
| #129 | friction | Claim popup defaults to the nearest factory even when it doesn't use that resource |
| #130 | polish | Belt-capacity warnings can't be cleared by building it correctly |

#127 is the tier's headline: the app offers "Iron Works already makes this,
5/min spare — import instead", and clicking it changes nothing on screen. It
adds the source at 0/min, so the solver keeps everything local. Typing the cap
by hand does the whole job — 21 machines/111.6 MW → 12/74.5 MW. And even done
correctly, only the consuming end is configured; the producer needs its Export
set separately or the link draws from nothing.

### What worked

"Select reachable" on the Alts screen unlocks exactly the right set in one
press, and says what it's about to do first. The plan graph spots surplus in
other factories on its own and offers the import before being asked — the offer
is right, it's only the click that doesn't land. And three Tier 0 fixes held up
under real use: Solid Biofuel appeared in the fuel picker at T2 and not before,
the stacked-node pager walked a 3-node cluster to find the unclaimed one, and
every unclaimed node tooltip carried its yield and coordinates before commitment.

### What the Tiers 1–2 fixes turned up

Two of the four issues had the wrong cause written into them, and both corrections
came from a teammate reading the code rather than from the run.

**#127 named the wrong mechanism, and the fix I suggested would have shipped the
bug.** A `null` cap on an external source doesn't mean "the solver ignores the
import" — it resolves to *whatever the producer actually offers*, and a factory
with no export slice open offers zero. So the zero-flow symptom and the
"exports cover 0.0" error are one fact seen from two ends, not two bugs. My
suggested fix — default the cap — would have bound the LP through
`declared_import_caps`, moved the numbers on screen, and left the link still
broken. Harder to catch than the original, because it looks fixed.

**#128 named the wrong trigger, and the real one is worse.** Unlocking alts
cannot change a plan; plans solve against tier-reachable alts, not the collected
set, and there's a test pinning that now. What rewrote Iron Works was a tier
bump plus any later plan *save* — and saves fire on factories the player isn't
looking at, including from `raise_export_target` and `assign_import_source`.
Which means **#127's own fix makes those saves more frequent**: repairing one
issue in this batch would have quietly widened the other.

That pairing is the argument for fixing a tier group as one batch rather than
issue by issue. Neither interaction is visible from a single issue.

## Tiers 3–4 — started, not finished

Tier set to 4 and all 32 reachable alts unlocked. **Steel Mill** placed at
2.7 km W · 0.9 km N, between the western coal field and the iron nodes below
it, planning Steel Beam 10/min and Steel Pipe 15/min. The optimizer chose
Solid Steel Ingot and Iron Alloy Ingot, so the mill wants copper as well as
coal and iron — 41.7 coal, 22.2 iron, 5.6 copper per minute. Coal and iron
are claimed at 42/min and 22.5/min; copper is not.

Not reached: Encased Industrial Beam, the coal power station and its water
extractors, Motor Assembly, Versatile Framework for Phase 2, and the Miner
Mk.2 upgrades. The tier page's checkpoint is untouched.

One thing confirmed on the way: **#129's fix works in the wild.** Claiming a
coal node with three factories on the map defaulted to Steel Mill — the one
short of coal — rather than the nearest. Same for the iron and copper claims,
three for three. That's the fix I couldn't trigger during the Tiers 1–2
checkpoint because no factory was short of anything at the time.

The Mk3 unlock also shows the belt note tracking the tier: the Iron Works ore
segment now reads "needs 2 belts at Mk.3 (270/min each)", down from 3 at Mk.2.

## Where this run stands

| Tier group | State |
| --- | --- |
| Tier 0 | shipped — PR #126, merged `fbf6b410` |
| Tiers 1–2 | shipped — PR #133, merged `d33c37c0` |
| Tiers 3–4 | Steel Mill part-built, checkpoint not attempted |

#133 sat draft on two blockers, both of them regressions its own fixes had
introduced, and both invisible to a green suite. #134 was a plan save dropping
the backfill; #135 demoted a single machine clocked past its output port to a
note, when that's the one belt case a player genuinely can't build around. Both
were fixed on the same branch before it merged (`MachineOverPortCapacity` first
appears in `d33c37c0`), so #133 carries its own repairs rather than handing them
to a follow-up.

Four PRs shipped after it. #138 (`7226f122`) queued export raises instead of
racing them, for #137. #140 (`46bc83d3`) narrowed that queue's comment to what
it actually covers, leaving #139 open. #141 (`022080a1`) stopped a re-save
wiping the transport on every import route and stopped Home guessing which
factory a claim belongs to, and #144 (`c3ca7a74`) closed an ordering hole in
#141's own fix, where two import rows drawing the same item from the same
producer could swap each other's belts.

Six PRs merged. 26 issues filed, 20 closed, and the 6 still open are the ones
listed at the end of this file. Vitest went from 470 tests to 523, cargo from
379 to 406.

### The pattern this run keeps producing

Six times a fix introduced a new defect, and the suite was green every time.

Three of those were tests asserting the bug as correct behaviour — the belt
note, the Portable Miner exclusion, and a picker test pinning the very enabled
state the fix was meant to change. Writing a test from the current behaviour
rather than the intended behaviour is how a suite ends up defending a bug.

The other three came from something overclaiming what it did: a code comment, an
undo, and a queue whose reach stops at the webview boundary. Module scope does
serialize the graph and the Sources panel together, which is what it was added
for, but a popped-out factory reloads the app in its own realm with its own copy
of the map. That's #139, and no JS queue can close it — it needs the backend
holding the read-modify-write under a lock.

What caught these was reverting each fix and watching a named test go red, then
driving the built app. Neither happens on its own, and playing is where most of
the run's findings came from, though not all: #120 and #121 surfaced while
fixing something else, and a review bot caught the wrong PR attribution in this
very section. No single method covers it.

### Still open

Tiers 5–9 are untouched, and the Tiers 3–4 checkpoint was never attempted: the
coal power station and its water extractors, Motor Assembly, Versatile Framework
for Phase 2, and the Miner Mk.2 upgrades all remain.

Carrying forward: #143 (stale shortfalls during a background refetch), #139 (the
export-raise race across popped-out windows, which wants a Rust-side lock rather
than the per-root queue), #136 (eleven remaining review findings), #132 (the
factory slice README no longer describes the slice), #123 (a hand-fed chain
validates clean) and #122 (Geothermal listed at T8 against the game's T6).
