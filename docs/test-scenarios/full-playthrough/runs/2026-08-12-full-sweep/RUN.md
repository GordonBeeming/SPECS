# Run 2026-08-12-full-sweep

- **Playthrough:** 2026-08-12-full-sweep (created 12 Aug 2026 at Tier 0, game `1.2`)
- **Status:** in progress

Played from the map and the factory view only, per `constraints.md`. Every trip
to a list screen is recorded as a finding rather than treated as the way through.

| Tier group | State | Issues |
| ---------- | ----- | ------ |
| tier-0     | done — checkpoint green on the fixed build | #113–#121 fixed, #122 split out |
| tiers-1-2  | not started | — |
| tiers-3-4  | not started | — |
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
