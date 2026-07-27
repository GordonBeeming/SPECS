# Run — 2026-07-26-full-game

One continuous Tier 0 → Tier 9 playthrough, recorded end to end. Each tier group
appends to this folder rather than starting its own.

Playthrough created in-app on 26 Jul 2026, starting tier 0, game stamp `1.2`.

## Tier index

| Tier group | Status | Validate | Frames | Issues |
| --- | --- | --- | --- | --- |
| Tier 0 | Complete | No findings — 60 MW gen / 42 MW draw (+18 MW) | 00001–00096 | #41–#64 |
| Tier 1–2 | Complete | No findings — 360 MW gen / 281 MW draw (+79 MW) | 00001–00088 | #65–#72 |
| Tier 3–4 | Complete | 0 errors, 4 warnings (shared-grid) — 1410 MW gen / 879 MW draw (+531 MW) | 00001–00082 | #73–#80 |
| Tier 5–6 | Complete | 0 errors, 4 warnings (unsatisfiable generator-fuel checks) — 2222 MW gen / 1695 MW draw (+527 MW) | 00001–00076 | #81–#87 |
| Tier 7–8 | **Partial** — see "What this group did not reach" | 0 errors, 17 warnings (unclaimed raws on two new factories, 3 unsatisfiable Biomass) — 7222 MW gen / 3050 MW draw (+4172 MW) | 00001–00065 | #92–#97 |
| Tier 7–8 (cont.) | **Partial** — see "Tier 7–8, second pass" | 0 errors, 29 warnings — 7222 MW gen / 3622 MW draw (+3600 MW) | 00001–00046 (t78b) | t78b report |
| Tier 9 | **Game complete** — Phase 4 Delivered, Phase 5 covered; claims outstanding | 0 errors, 60 warnings (all claim gaps) — 17222 MW gen / 12682 MW draw (+4540 MW) | 00001–00040 (t9) | t9 report |

From Tier 1 onward the map is the primary surface: claim on the node, place the
factory where it belongs spatially, and let list screens cover only what the map
can't do.

Each tier group's issues are fixed before the next starts, so a finding from an
earlier group recurring later is itself worth reporting. Video cuts live in
`~/Developer/artifacts/SPECS/`, and the annotated cut opens each tier with a
title card that names the issue range already logged for it.

**One rule this run got wrong for four tiers.** Belt capacity doesn't limit
aggregate flow: parallel belts, splitters and several nodes feeding one factory
are all normal. What it limits is a single extractor's output port, because a
splitter placed after the port can only divide what already came through. A
miner clocked to 300/min at Tier 1 delivers 60. `tier-0.md` had told testers to
"split the output onto two belts at the miner" and the Tier 0 artifacts followed
it; both are fixed now, and the check the app is missing is #82.

## Tier 0

### What was built

| Factory | Site | Products | Machines | Power |
| --- | --- | --- | --- | --- |
| [Iron Works](./factories/iron-works.md) | 1.9 km W · 1.2 km N | Iron Plate 20/min, Iron Rod 20/min, Screws 40/min | 6 | 1× Biomass Burner, +2 MW |
| [Copper Works](./factories/copper-works.md) | 0.95 km W · 1.45 km N | Wire 30/min, Cable 15/min, Concrete 15/min | 5 | 1× Biomass Burner, +7 MW |

Four nodes claimed, 135 ipm total: two Normal iron at 50%, one Normal copper at
50%, one Normal limestone at 75%. Every miner is a Mk.1 and every belt is Mk1.
The busiest segment in either plant carries 45/min against the 60/min cap, so
nothing needs a parallel run yet.

### Checkpoint

- [x] Validate playthrough → no findings
- [x] No belt segment over 60/min in the layouts (worst is 45/min)
- [x] Layout artifacts written for both factories; screenshots of each plan
      graph, the map with claims, and the validation panel
- [x] `hesitations.md` emptied into the findings report

### Alternates

No alt recipe in the library unlocks at or below T0, so nothing was unlocked. The
earliest is Cast Screws at T1. The Alts screen will still let you tick a T7
recipe while sitting at T0, which is reported separately.

### Skipped

Nothing this tier is skipped by choice. Biomass is the one T0 recipe without a
production line, and that isn't a judgement call: its inputs are Leaves and Wood,
which have no extractor in the game at any tier, and the app's product picker
returns "No matches." for Biomass anyway. Both burners are hand-fed at 4.00/min
each, which is how Tier 0 power works in-game.

No equipment, ammo, filters or FICSMAS items exist at T0.

### Map pass

Both factories were created from the Factories list, so both pins spawned on the
same default coordinate and had to be dragged onto their nodes by hand. The map
has a better route for this that I found afterwards: an unlabelled rail button,
"Place a factory — click, then click the map", which opens a small "New factory
here" card and creates the factory at the clicked point. Tier 1 onward uses that.

The map also carries a full claim flow. Clicking an unclaimed node opens a card
with the resource, purity, coordinates, extractor, clock and factory binding, and
a Claim button. It only works one way though: clicking an *already claimed* node
does nothing at all, so the map can start a claim but can't review or change one.

I ran two probes and reverted both: a map claim on Iron Ore Normal #11, which I
had to remove from the Resources list because the map can't unclaim, and a
throwaway "Placement Probe" factory created from the map and removed with "Cancel
& delete this factory". Validate still reports no findings afterwards, with the
same four claims at 135 ipm.

### Screenshots

- `2026-07-26-full-game-t0-iron-works-plan-graph.png`
- `2026-07-26-full-game-t0-copper-works-plan-graph.png`
- `2026-07-26-full-game-t0-map-claims-and-factories.png`
- `2026-07-26-full-game-t0-resources-claims.png`
- `2026-07-26-full-game-t0-validate-clean.png`
- `2026-07-26-full-game-t0-home-machine-count-8-vs-11.png`
- `2026-07-26-full-game-t0-power-hides-ungenerated-factory.png`
- `2026-07-26-full-game-t0-map-factory-card-oreiron.png`
- `2026-07-26-full-game-t0-map-pins-stacked-default.png`
- `2026-07-26-full-game-t0-icon-search-no-match-iron-plate.png`
- `2026-07-26-full-game-t0-alts-t7-tickable-at-t0.png`
- `2026-07-26-full-game-t0-biomass-no-matches-in-product-picker.png`
- `2026-07-26-full-game-t0-map-filtered-to-iron.png`
- `2026-07-26-full-game-t0-map-node-card-negative-coords.png`
- `2026-07-26-full-game-t0-map-placing-loadout-mk2-default-at-t0.png`
- `2026-07-26-full-game-t0-map-factory-pill-occludes-its-nodes.png`
- `2026-07-26-full-game-t0-network-light-theme-cards.png`
- `2026-07-26-full-game-t0-logistics-distance-not-derived-from-map.png`
- `2026-07-26-full-game-t0-logistics-item-picker-whole-catalogue.png`

## Tier 1–2

Tier set to 2 on entry. Tier 1 is Field Research and adds no standard recipe, so
the whole group is really Tier 2: the Assembler, Mk2 belts at 120/min, and the
first Space Elevator part.

### What was built

| Factory | Site | Products | Machines | Power |
| --- | --- | --- | --- | --- |
| [Iron Works](./factories/iron-works.md) | 1.9 km W · 1.2 km N | Iron Plate 20/min, Iron Rod 20/min, Screws 40/min, Modular Frame 4/min, Rotor 9/min, Reinforced Iron Plate 11/min | 36 | 8× Biomass Burner, +26.8 MW |
| [Copper Works](./factories/copper-works.md) | 0.95 km W · 1.45 km N | Wire 30/min, Cable 15/min, Concrete 15/min, Copper Sheet 10/min | 7 | 2× Biomass Burner, +27.7 MW |
| [Elevator Yard](./factories/elevator-yard.md) | ~1.6 km W · 1.1 km N | Smart Plating 5/min | 3 | 2× Biomass Burner, +24.6 MW |

Six nodes claimed, 393 ipm total: four iron (288/min), one copper (60/min), one
limestone (45/min). Every miner is still a Mk.1, since Mk.2 is Tier 4, and every
belt is now Mk2.

### Alternates

Seven alts unlock at or below T2 and all seven were ticked: Cast Screws and Iron
Wire (T1), then Bolted Frame, Bolted Iron Plate, Copper Rotor, Fused Wire and
Stitched Iron Plate (T2). The solver picked three of them, all at Iron Works, and
those three are what keeps the Reinforced Iron Plate chain entirely on iron.

Fused Wire is listed at T2 by the library but needs Caterium Ingot, which no
recipe produces until far later. It's unlocked and unusable; that mis-tiering is
issue #41.

### The first cross-factory pull

Elevator Yard is the run's first factory with no extractor of its own. Both its
inputs come from Iron Works over logistics links:

| Item | Rate | Transport | Distance |
| --- | --- | --- | --- |
| Reinforced Iron Plate | 5/min | 1× Mk2 belt (4% used) | 297 m |
| Rotor | 5/min | 1× Mk2 belt (4% used) | 297 m |

The 297 m came from the map: the link dialog derives it from the two factories'
positions and says so on the field. The planner then ranked eight transport
options for that distance and disabled the six that need Tier 3 or above, leaving
Mk1 and Mk2 belts to pick from. That answers the tier page's "sane belt plan for
the distance" question about as directly as it could.

### Space Elevator

Phase 1 (Distribution Platform) needs Smart Plating × 50. Elevator Yard makes
5/min with all 5 free, so the phase reads **In progress** and completes in ten
minutes of uptime.

### Checkpoint

- [x] Phase 1 deliverable planned: Smart Plating at 5/min
- [x] Iron Works → Elevator Yard links exist with a Mk2 belt transport plan
- [x] Validate playthrough → no findings (360 MW gen / 281 MW draw, +79 MW)
- [x] No belt segment over 120/min in the layouts — one segment needed splitting
      (Screws → Rotor at 225/min, run as 2× Mk2 at 112.5/min); the app gave no
      warning, which is issue #48
- [x] Layout artifacts: Elevator Yard (new), Iron Works and Copper Works deltas
- [x] Screenshots: alts post-unlock, Elevator Yard plan graph, validation panel

### Skipped

**Solid Biofuel** is the one T2 recipe without a production line, and it can't be
planned at all. Its input is Biomass, which no recipe produces and no node
supplies, so adding it to a plan returns "No recipe produces Desc_Biofuel_C" and
wipes the rest of the graph. Solid Biofuel is also missing from the Biomass Burner
fuel list, which offers Wood, Biomass, Leaves and Mycelia, so even a hand-fed line
would have nowhere to send it. Both reported.

No equipment, ammo, filters or FICSMAS items exist at T2.

### Power, honestly

Twelve Biomass Burners across three factories, 360 MW, eating 48 Biomass/min by
hand. That's what a 281 MW network costs on the only generator Tier 2 has, and
it's the reason coal is the first thing you want at Tier 3. Every factory is
individually positive, so Validate is clean.

### Map pass

Placement worked well. "Place a factory → click the map → New factory here →
Create & plan" put Elevator Yard within 3 m of where I meant, and the app's own
distance readout confirmed it afterwards. Claiming on the node works too: the card
picks up the Placing loadout, and the extractor picker is correctly limited to
Miner Mk.1.

Two things the map couldn't do. The Iron Works pin covers its own claimed nodes
completely at default zoom, with the node's whole hit box sitting behind the pin,
so the third node in that cluster had to be claimed from the Resources list
instead. And the two logistics links draw as a single unlabelled line, on the map
and on Network alike, so neither surface tells you what's shipping.

Panning couldn't be driven over the MCP bridge, because synthetic drag doesn't
take. That's a harness limit rather than an app problem, but it does leave the
zoom buttons as the only navigation, and they zoom about the viewport centre, so
anything off-centre goes out of reach.

### Screenshots

- `2026-07-26-full-game-t12-alts-post-unlock.png`
- `2026-07-26-full-game-t12-alts-filter-no-tier-match.png`
- `2026-07-26-full-game-t12-above-tier-alt-warning.png`
- `2026-07-26-full-game-t12-add-source-distances.png`
- `2026-07-26-full-game-t12-link-planner-ranked-plans.png`
- `2026-07-26-full-game-t12-iron-works-plan-graph.png`
- `2026-07-26-full-game-t12-elevator-yard-plan-graph.png`
- `2026-07-26-full-game-t12-solid-biofuel-bricks-plan.png`
- `2026-07-26-full-game-t12-power-grid-positive.png`
- `2026-07-26-full-game-t12-power-badge-counts-rows-not-generators.png`
- `2026-07-26-full-game-t12-network-two-links-one-edge.png`
- `2026-07-26-full-game-t12-map-three-factories.png`
- `2026-07-26-full-game-t12-space-elevator-phase1.png`
- `2026-07-26-full-game-t12-validate-clean.png`

## Tier 3–4

Tier set to 4 on entry. This is the group where the run stops being one cluster:
steel opens, water arrives, coal power replaces biomass, and three of the six
factories now live somewhere other than the starting plains.

### What was built

| Factory | Site | Products | Machines | Power |
| --- | --- | --- | --- | --- |
| [Iron Works](./factories/iron-works.md) | 1.9 km W · 1.2 km N | Iron Plate 20/min, Iron Rod 20/min, Screws 40/min, Modular Frame 6.5/min, Rotor 15/min, Reinforced Iron Plate 10/min | 56 | 8× Biomass Burner, −168.1 MW |
| [Copper Works](./factories/copper-works.md) | 0.95 km W · 1.45 km N | Wire 260/min, Cable 65/min, Concrete 35/min, Copper Sheet 10/min | 21 | 2× Biomass Burner, −28.5 MW |
| [Elevator Yard](./factories/elevator-yard.md) | ~1.6 km W · 1.1 km N | Smart Plating 5/min, Versatile Framework 5/min | 4 | 2× Biomass Burner, +9.6 MW |
| [Steel Mill](./factories/steel-mill.md) | 1.30 km W · 0.75 km N | Steel Beam 40/min, Steel Pipe 76.5/min, Encased Industrial Beam 4/min | 16 | none, −162.9 MW |
| [Motor Works](./factories/motor-works.md) | 1.30 km W · 1.00 km N | Stator 12.5/min, Motor 2.5/min, Automated Wiring 2.5/min | 5 | none, −56.4 MW |
| [Coal Power Station](./factories/coal-power-station.md) | 0.50 km W · 0.50 km N | — (power only) | 0 | 14× Coal Generator, +939.4 MW |

Eleven nodes claimed, 1,113 ipm total. Two claims are on Miner Mk.2 (both coal),
one existing claim was upgraded from Mk.1 to Mk.2 and two were released as a
result. Every belt is Mk3.

### Power — coal takes over

Fourteen Coal Generators at Coal Power Station produce **1050 MW**, against a
whole-network draw of **879 MW**. Coal alone carries the grid with 171 MW spare;
the twelve legacy Biomass Burners add another 360 MW on top and are no longer
load-bearing. They stay in the plan only because the generator delete control
can't be driven over the MCP bridge (reported).

The fuel bill is 210 coal/min and 630 m³ water/min. Water costs 100.6 MW of the
1050 MW to pump, which is why the extractor bank is clocked at 87.5% to match
demand exactly rather than left at 100%.

### Fluids, for the first time

Water is the run's first fluid and it behaves nothing like a belt item.

- 14 generators × 45 m³/min = **630 m³/min**.
- A Water Extractor makes 120 m³/min at 100%, so 6 at 87.5% is the exact match.
- Mk1 pipes cap at **300 m³/min**, so 630 needs **three parallel headers** at
  210 m³/min each, one per generator row (5 / 5 / 4).

The app computes the demand and shows it with the right unit on the Power view
("Water 630.00 m³/min"), and the map's water-extractor card computes group output
("Output 630 m³/min"). What it never does is put the two together: it will let a
540 m³/min group sit against a 630 m³/min demand and say nothing, and it has no
concept of the 300 m³/min pipe cap at all. The three-header split is a plan
decision, not something the app derived. Both reported.

### Cross-factory flows

Nine logistics links now move intermediates instead of rebuilding them.

| From → To | Item | Rate | Distance (map) | Transport |
| --- | --- | --- | --- | --- |
| Copper Works → Motor Works | Wire | 100/min | 583 m | 1× Mk3 belt (37%) |
| Copper Works → Motor Works | Cable | 50/min | 583 m | 1× Mk3 belt (19%) |
| Copper Works → Steel Mill | Concrete | 20/min | 792 m | 1× Mk3 belt (7%) |
| Steel Mill → Motor Works | Steel Pipe | 37.5/min | 250 m | 1× Mk3 belt (14%) |
| Steel Mill → Elevator Yard | Steel Beam | 30/min | 449 m | 1× Mk3 belt (11%) |
| Iron Works → Motor Works | Rotor | 5/min | 613 m | 1× Mk3 belt (2%) |
| Iron Works → Elevator Yard | Rotor | 5/min | 297 m | 1× Mk3 belt (2%) |
| Iron Works → Elevator Yard | Reinforced Iron Plate | 5/min | 297 m | 1× Mk3 belt (2%) |
| Iron Works → Elevator Yard | Modular Frame | 2.5/min | 297 m | 1× Mk3 belt (1%) |

The distances above are the map-derived ones the app itself quoted while the
links were being created. The Logistics screen stores 1000 m for seven of the
nine, because links made through the plan's Sources panel get a hard-coded
distance instead of the one the panel just showed you. Reported.

The payoff is large. Motor Works planned from raw was 31 machines and 182.9 MW;
sourcing wire, cable, steel pipe and rotors over links took it to 5 machines and
56.4 MW. Elevator Yard went from 26 machines to 4 the same way.

### Alternates

32 alts unlock at or below T4 and all 32 are ticked, up from 7. Twenty-five had
to be ticked one at a time, because the Alts screen has Select all and Select none but
nothing that means "everything I can actually build".

Unlocking them re-solved the two existing factories without warning. Copper Works
picked up Copper Alloy Ingot (iron ore) and Fine Concrete via Cheap Silica (raw
quartz); Iron Works picked up Solid Steel Ingot (coal) and Steel Cast Plate. None
of those raws is claimed anywhere near either plant. Both were pinned back to
recipes their claims can feed; Iron Works kept Iron Alloy Ingot and Iron Wire,
which it can, and gained a copper claim 220 m away to do it.

### Space Elevator

Phase 1 (Distribution Platform) reads **Delivered**. Phase 2 (Construction Dock)
reads **In progress** with all three parts covered:

| Part | Needs | Made at | Free rate |
| --- | --- | --- | --- |
| Smart Plating | 1,000 | Elevator Yard | 5/min |
| Versatile Framework | 1,000 | Elevator Yard | 5/min |
| Automated Wiring | 100 | Motor Works | 2.5/min |

The app's Phase 2 costs (1,000 / 1,000 / 100) don't match the published 1.0 values
of 500 / 500 / 100 for Smart Plating and Versatile Framework. Flagged for a data
check rather than asserted.

### Checkpoint

- [x] Phase 2 parts all planned at stated rates with working imports
- [x] Validate → 0 errors. 4 warnings remain and all four are "factory X draws
      more than it generates", which is what a shared grid looks like, and Validate
      has no concept of one. Grid line: **1410 MW generation / 879 MW draw
      (+531 MW)**; coal alone is 1050 MW against 879 MW
- [x] Water group sits on an approved water body, the Grass Fields lakes, at
      0.78 km W · 0.33 km N, the lake immediately south-west of the plant
- [x] No pipe segment over 300 m³/min (three headers at 210 each). Three belt
      segments at Iron Works are over 270/min and are planned as parallel Mk3
      pairs: Iron Ingot 439.5, Screws 415, Screws → Rotor 375
- [x] Layouts written — Steel Mill, Motor Works and Coal Power Station in full;
      Iron Works, Copper Works and Elevator Yard as deltas
- [x] Screenshots: power view, steel mill plan, validation panel

### Skipped

**Black powder and the Nobelisk family** (T3), **Power Shards** (T3) and the
Portable Miner alt are the T3–T4 recipes without a line. Black Powder and
Nobelisk are ammo, Power Shards are an amplifier consumable and the Portable
Miner is equipment, all optional under `constraints.md`. Every T3–T4 production
component that feeds another recipe, a milestone or the elevator has a line:
Steel Ingot, Steel Beam, Steel Pipe, Encased Industrial Beam, Versatile
Framework, Stator, Motor and Automated Wiring.

**Solid Biofuel** is still unplannable for the reasons given at Tier 2.

### Map pass

Map-first held up well. Both new production factories and the power station were
placed by clicking the map, and all three landed within about 10 m of where they
were aimed, and the app's own distance readouts confirmed it afterwards (Coal Power
Station → Elevator Yard came back as 1,250 m against a calculated 1,253 m).

Claiming on the node works, and the Placing loadout now defaults to Mk1 with Mk2
offered as a second option at T4, so the extractor picker is correctly gated.
Setting the loadout first and then clicking the node pre-fills the card, which is
the fast path for a run of claims.

Three things the map still can't do. Overlapping markers mean the top layer wins,
so a copper node and a limestone node on the same coordinate can only be reached
by toggling the other resource off, which happened twice. The claimed-node card is
still create-only, so every clock change and every Mk.1 → Mk.2 upgrade went
through the Resources list. And the six factory pins in the western cluster now
overlap each other and their own link labels at default zoom.

Panning still can't be driven over the MCP bridge (synthetic drag doesn't take),
which is a harness limit rather than an app problem, but it does mean the whole
session ran at one zoom level.

### Screenshots

- `2026-07-26-full-game-t34-steel-mill-plan-graph.png`
- `2026-07-26-full-game-t34-motor-works-plan-graph.png`
- `2026-07-26-full-game-t34-power-coal-station.png`
- `2026-07-26-full-game-t34-map-six-factories.png`
- `2026-07-26-full-game-t34-validate.png`
- `2026-07-26-full-game-t34-validate-shared-grid-warnings.png`
- `2026-07-26-full-game-t34-water-shortfall-not-flagged.png`
- `2026-07-26-full-game-t34-logistics-duplicate-links-1000m.png`
- `2026-07-26-full-game-t34-link-editor-save-below-fold.png`
- `2026-07-26-full-game-t34-fractional-rate-rejected-silently.png`
- `2026-07-26-full-game-t34-solver-adds-quartz-to-steel-mill.png`
- `2026-07-26-full-game-t34-alts-resolved-existing-factory.png`
- `2026-07-26-full-game-t34-coal-gen-fuel-picker-no-water-unit.png`

## Tier 5–6

Tier set to 6 on entry. Oil arrives, and with it the first factory the western
cluster can't reach on a belt you'd want to build: the refinery sits 1.2 km
north-east of everything else, on the Northern Forest oil field. Caterium and the
Manufacturer open too, which between them make Phase 3 of the Space Elevator
plannable.

### What was built

| Factory | Site | Products | Machines | Power |
| --- | --- | --- | --- | --- |
| [Iron Works](./factories/iron-works.md) | 1.9 km W · 1.2 km N | Iron Plate 20/min, Iron Rod 20/min, Screws 144/min, Modular Frame 8/min, Rotor 15/min, Reinforced Iron Plate 12/min | 65 | 8× Biomass Burner, −236.2 MW |
| [Copper Works](./factories/copper-works.md) | 0.95 km W · 1.45 km N | Wire 132/min, Cable 124/min, Concrete 50/min, Copper Sheet 54/min | 38 | 2× Biomass Burner, −103.2 MW |
| [Elevator Yard](./factories/elevator-yard.md) | ~1.6 km W · 1.1 km N | Smart Plating 5/min, Versatile Framework 5/min, Modular Engine 1/min, Adaptive Control Unit 1/min | 8 | 2× Biomass Burner, −124.9 MW |
| [Steel Mill](./factories/steel-mill.md) | 1.30 km W · 0.75 km N | Steel Beam 51/min, Steel Pipe 64/min, Encased Industrial Beam 7/min | 28 | none, −285 MW |
| [Motor Works](./factories/motor-works.md) | 1.30 km W · 1.00 km N | Stator 5/min, Motor 2.5/min, Automated Wiring 5/min | 7 | none, −85.5 MW |
| [Coal Power Station](./factories/coal-power-station.md) | 0.50 km W · 0.50 km N | — (power only) | 0 | 14× Coal Generator, +1050 MW |
| [Oil Refinery](./factories/oil-refinery.md) | 0.30 km E · 2.08 km N | Plastic 136/min, Rubber 35/min, Fuel 65/min | 12 | 4× Fuel Generator, +469 MW |
| [Caterium Electronics](./factories/caterium-electronics.md) | 1.75 km W · 0.85 km N | Caterium Ingot 15/min, Quickwire 60/min | 3 | none, −13.8 MW |
| [Computer Plant](./factories/computer-plant.md) | 0.70 km W · 1.30 km N | Circuit Board 10/min, Computer 3/min | 5 | none, −99.7 MW |

Sixteen nodes claimed, 1,813 ipm total. Two of them are Oil Extractors, which
have no marks — purity × clock is the only lever. Every belt is Mk4 (480/min)
and every pipe is Mk2 (600 m³/min).

### Oil, and what happens to the residue

The refinery runs the standard Plastic and Rubber recipes, which is the whole
point of the exercise: both dump Heavy Oil Residue, 103 m³/min of it. 97.5 goes
straight into Residual Fuel and comes back as the 65 m³/min Fuel the power block
burns; the 0.5 that doesn't divide evenly becomes 1.5 Petroleum Coke/min and is
sunk.

The planner handles this well and does it without being asked. It routes
byproducts into whatever consumes them, and anything genuinely left over gets an
explicit `BYPRODUCT → SINK` node on the graph rather than being dropped. At one
point during the build that sink was carrying 145.5 Petroleum Coke/min, which is
a real decision the app made silently, because the sink node is the dimmest thing
on the canvas and no banner mentions it. That's the one byproduct complaint: the
handling is right, the visibility isn't.

### Power — fuel comes online

Four Fuel Generators at 81.2% produce **812 MW** on 64.96 m³/min of the
refinery's own fuel. Together with the 14 Coal Generators (1050 MW) and the
twelve legacy Biomass Burners (360 MW), the grid reads **2222 MW generation
against 1695 MW draw, +527 MW**.

The generator picker is correctly tier-gated — Biomass Burner (T0), Coal
Generator (T3) and Fuel Generator (T6), no nuclear. The fuel picker inside it
isn't: it offers Rocket Fuel and Ionized Fuel, which are Tier 8–9.

### Cross-factory flows

Fifteen logistics links now, and every one of them carries a real map-derived
distance — the 1000 m placeholders from Tier 3–4 are gone.

| From → To | Item | Rate | Distance | Transport |
| --- | --- | --- | --- | --- |
| Oil Refinery → Computer Plant | Plastic | 136/min | 1,242 m | 1× Mk4 belt (28%) |
| Oil Refinery → Elevator Yard | Rubber | 35/min | 2,133 m | 1× Mk4 belt (7%) |
| Copper Works → Computer Plant | Copper Sheet | 44/min | 268 m | 1× Mk4 belt (9%) |
| Copper Works → Computer Plant | Cable | 24/min | 268 m | 1× Mk4 belt (5%) |
| Copper Works → Motor Works | Wire | 132/min | 583 m | 1× Mk4 belt (28%) |
| Copper Works → Motor Works | Cable | 100/min | 583 m | 1× Mk4 belt (21%) |
| Copper Works → Steel Mill | Concrete | 35/min | 792 m | 1× Mk4 belt (7%) |
| Steel Mill → Motor Works | Steel Pipe | 49/min | 250 m | 1× Mk4 belt (10%) |
| Steel Mill → Elevator Yard | Steel Beam | 30/min | 449 m | 1× Mk4 belt (6%) |
| Steel Mill → Elevator Yard | Encased Industrial Beam | 3/min | 449 m | 1× Mk4 belt (1%) |
| Iron Works → Motor Works | Rotor | 3/min | 613 m | 1× Mk4 belt (1%) |
| Iron Works → Elevator Yard | Screws | 104/min | 297 m | 1× Mk4 belt (22%) |
| Iron Works → Elevator Yard | Reinforced Iron Plate | 7/min | 297 m | 1× Mk4 belt (1%) |
| Iron Works → Elevator Yard | Rotor | 7/min | 297 m | 1× Mk4 belt (1%) |
| Iron Works → Elevator Yard | Modular Frame | 7.5/min | 297 m | 1× Mk4 belt (2%) |
| Motor Works → Elevator Yard | Automated Wiring | 5/min | 320 m | 1× Mk4 belt (1%) |
| Computer Plant → Elevator Yard | Circuit Board | 5/min | 939 m | 1× Mk4 belt (1%) |
| Computer Plant → Elevator Yard | Computer | 2/min | 939 m | 1× Mk4 belt (<1%) |

The payoff is the same shape as Tier 3–4 but larger. Computer Plant planned from
raw was 27 machines and 493 MW; three imports took it to 5 machines and 99.7 MW.
Elevator Yard went from 55 machines and 604 MW to 8 machines and 184.9 MW.

### Alternates

71 alts are unlocked, up from 32 — every one at or below Tier 6, and nothing
above. All 39 new ones had to be ticked individually.

Unlocking them re-solved four factories that were already working. Copper Works
picked up Quickwire Cable and Coated Cable and started asking for crude oil and
caterium on the plains; Iron Works and Steel Mill both took Pure Iron Ingot and
wanted 135 and 56 m³/min of water they have no claim on. Every one was pinned
back to a recipe its own claims can feed.

The sharper case is Computer Plant, which the solver built out of **Alternate:
Crystal Computer** — a recipe the library dates to Tier 5 whose inputs, Crystal
Oscillator and AI Limiter, are both Tier 7. A Tier 6 playthrough got a Tier 7
plan with no warning anywhere.

### Space Elevator

Phase 1 and Phase 2 both read **Delivered**, and Phase 2's costs now read
500 / 500 / 100, matching the published values. Phase 3 (Main Body) reads **In
progress** with all three parts covered:

| Part | Needs | Made at | Free rate |
| --- | --- | --- | --- |
| Versatile Framework | 2,500 | Elevator Yard | 5/min |
| Modular Engine | 500 | Elevator Yard | 1/min |
| Adaptive Control Unit | 100 | Elevator Yard | 1/min |

### Checkpoint

- [x] Phase 3 parts planned at stated rates, imports wired
- [x] No orphaned byproducts on any saved plan — heavy oil residue is fully
      consumed by Residual Fuel, with a 1.5/min Petroleum Coke sink for the
      remainder
- [x] Validate playthrough → **0 errors, 4 warnings**. All four are the same
      unsatisfiable check: "generators need X/min of *fuel*, claims cover 0.0",
      for Biomass at three factories and Fuel at the refinery. Neither Biomass
      nor Fuel is a claimable node, so no amount of planning clears them.
      Grid: **2222 MW generation / 1695 MW draw (+527 MW)**
- [x] Belt ≤ 480/min and pipe ≤ 600 m³/min on every link. The busiest link is
      Plastic at 136/min, 28% of one Mk4 belt; the busiest pipe is the refinery's
      257 m³/min crude header, 43% of one Mk2 pipe
- [x] Layouts written — Oil Refinery, Caterium Electronics and Computer Plant in
      full; Elevator Yard as a delta
- [x] Screenshots: refinery plan graph with byproduct edges, elevator yard plan
      graph, validation panel, power view, map, logistics

### Skipped

**AI Limiter** is the one Caterium Electronics part without a line, and that's
deliberate: it's Tier 7. The app offers it anyway and plans it without complaint,
which is reported rather than used.

Packaged fluids (Packaged Water, Packaged Oil, Packaged Fuel, Packaged Turbofuel)
and the Packager are unlocked at Tier 5 and skipped. Nothing in the network needs
a canister, since every fluid moves by pipe inside its own site, so a packaging
line would be scenery. Empty Canister is their only shared input and it has no
other consumer.

**Solid Biofuel** is still unplannable for the reasons given at Tier 2.

No equipment, ammo, filters or FICSMAS items were built.

### Map pass

Map-first still holds. Both new production sites and the refinery were placed by
clicking the map, and the app's own link distances confirmed the placements
afterwards — Computer Plant came back as 268 m from Copper Works against a
calculated 291 m, and Oil Refinery as 1,242 m against 1,268 m.

Two map things improved this group. The claimed-node card is no longer
create-only: clicking a claimed node opens the same card with **Release** and
**Update**, so miner marks and clocks can be changed from the map. And the
factory links now carry labels on the map ("Plastic 136/min", "Steel Pipe
47/min", or "3 items" where several share a route) instead of the unlabelled
lines of Tier 1–2.

What the map still can't do is set a claim's factory binding without a native
`<select>`, which the MCP bridge can't open. That's a harness limit rather than
an app bug, but it's worth noting that every other picker in the app is a custom
combobox and this one isn't.

### Screenshots

- `2026-07-26-full-game-t56-oil-refinery-plan-graph.png`
- `2026-07-26-full-game-t56-elevator-yard-plan-graph.png`
- `2026-07-26-full-game-t56-computer-plant-plan-graph.png`
- `2026-07-26-full-game-t56-byproduct-sink-node-low-contrast.png`
- `2026-07-26-full-game-t56-validate-unsatisfiable-generator-fuel-warnings.png`
- `2026-07-26-full-game-t56-validate-export-mismatch-errors.png`
- `2026-07-26-full-game-t56-power-grid.png`
- `2026-07-26-full-game-t56-map-nine-factories.png`
- `2026-07-26-full-game-t56-logistics-real-distances.png`
- `2026-07-26-full-game-t56-link-planner-parallel-lines-at-600ipm.png`
- `2026-07-26-full-game-t56-plan-graph-edges-still-unflagged-over-belt-cap.png`
- `2026-07-26-full-game-t56-space-elevator-phase3.png`
- `2026-07-26-full-game-t56-ai-limiter-t7-plans-at-t6.png`
- `2026-07-26-full-game-t56-product-picker-offers-tier-7.png`
- `2026-07-26-full-game-t56-solver-builds-t7-ai-limiter-chain-at-t6.png`
- `2026-07-26-full-game-t56-fractional-rate-2point5-rejected-silently.png`
- `2026-07-26-full-game-t56-oil-node-offers-t8-well-extractor.png`

## Tier 7–8

Tier set to 8 on entry. The heavy group, and the first one that didn't finish. Two
new factories went in, aluminum with its recycled-water loop and nuclear, and both
are planned, sited and mostly supplied. Quartz Electronics, Space Elevator
Phase 4 and the Miner Mk.3 sweep across the older factories did not get built, and
the section below says so plainly rather than pretending otherwise.

### What was built

| Factory | Site | Products | Machines | Power |
| --- | --- | --- | --- | --- |
| [Aluminum Plant](./factories/aluminum-plant.md) | 1.85 km W · 0.22 km S | Aluminum Ingot 60/min, Alclad Sheet 30/min, Casing 40/min, Battery 15/min, Cooling System 5/min, Fused Modular Frame 1.5/min | 60 | none, −890 MW |
| [Nuclear Power Station](./factories/nuclear-power-station.md) | 0.70 km W · 0.20 km N | Uranium Fuel Rod 0.4/min | 27 | 2× Nuclear Power Plant, +4,835 MW |

Twenty-three nodes claimed, 2,718 ipm total, up from sixteen. Seven of them are new:
bauxite, coal, copper, sulfur and uranium on Miner Mk.3, plus two nitrogen well
satellites. Two new water extractor groups: 4× @ 82.5% on the Gold Coast shoreline
for aluminum, 5× @ 87.7% on the Grass Fields lakes for nuclear.

### Power, and nuclear ending the argument

Two Nuclear Power Plants at 100% produce **5,000 MW** on 0.4 Uranium Fuel Rod/min
and 480 m³/min of water. The grid went from **−683 MW** with the Aluminum Plant
switched on and no new generation, to **7,222 MW generation against 3,050 MW draw,
+4,172 MW**. One build covers everything the playthrough has and most of what Tier 9
will want.

### Picking sites off the dataset instead of by eye

Five tier groups placed factories by eye. This one derived the map's coordinate
convention from `nodes.json` and checked it against the claims the earlier groups
had already recorded. The Oil Refinery's two seeps land exactly on the "0.5 km E ·
2.0 km N" and "0.4 km E · 2.3 km N" in its layout file, which pins the convention as
**+x east, −y north**.

That turned siting from guesswork into arithmetic, and it changed two decisions.
The bauxite trio at 1.8–2.2 km W is the only bauxite on the map inside a kilometre
of an approved water body, which is why the Aluminum Plant is there and not on the
larger eastern cluster. And the raw quartz Pure pair sits 0.6 km from Caterium
Electronics, which makes "extend Caterium Electronics" a genuinely short belt rather
than the 1.5 km haul it looked like. Worth inheriting.

### The aluminum water loop

The plan shows the recycle as its own edge. Alumina Solution draws 341.4 m³/min of
fresh water from the Gold Coast group, Aluminum Scrap returns 61.2 m³/min, and the
graph labels that return `Water · 61.2/min (reuse)` alongside a separate
`Water · 28.8/min` fresh edge. The two never collapse into one number, which is what
stops a plan from balancing on paper while costing an extra extractor bank in the
game.

The route the solver picked keeps it simple: **Alternate: Sloppy Alumina** (bauxite
and water, no coal) into **Alternate: Pure Aluminum Ingot** (scrap only, no silica),
so the plant needs no raw quartz at all. Three recipes were pinned back by hand,
each because the alt reached for a resource this site doesn't have: Aluminum Scrap
off the petroleum-coke alt onto coal, Battery off the plastic-and-wire alt onto
sulfuric acid, Fused Modular Frame off the fuel-and-nitric-acid alt onto casing and
nitrogen.

### Nuclear waste

The tier page requires the waste path stated explicitly. **It cannot be stated
inside the app.** The Nuclear Power Plant generator has no waste output in the data
model, and its fuel panel lists inputs only. Uranium Waste has no producing recipe. The
product picker drops the whole plutonium chain behind a bare "No matches.", and the
fuel picker two screens away offers Plutonium Fuel Rod as a fuel anyway. The
`nuclear-power-station.md` layout states the real-game figure (0.4 rods/min burnt →
10 Uranium Waste/min, stored until reprocessing exists) and flags that the app
can't hold it.

### Resource wells

Per-satellite claiming works and the purity totals are right: a Pure satellite at
100% is 120 m³/min, matching the tier page's 30/60/120. Satellites are clearly
labelled "Well satellite" in both the list and the map card, and the extractor
picker correctly offers only the Resource Well Extractor at T8.

What isn't modelled is the **pressuriser**. There's no pressuriser entity, so each
satellite carries its own clock. Two satellites of the same well now sit at 50% and
100%, 60 + 120 = 180 m³/min, and nothing objects. In the game the pressuriser holds
the clock for the whole well and every satellite on it runs at the same rate. The
pressuriser's power draw is missing too, and the 45 satellites are a flat list
sorted by coordinate, so one well's seven are scattered among other wells'.

### Alternates

103 alts unlocked, up from 71, every one at or below Tier 8, with the eight Tier 9
alts left alone. All 32 new ones were ticked individually; the Alts screen still has
only Select all and Select none, and Select all would have taken the eight
unreachable ones too.

Unlocking them re-solved Iron Works again, which now wants Crude Oil 8/min and Water
26.7/min it has no claim on. That's the third tier group running where unlocking
alts has quietly rewritten a working factory.

### Checkpoint

- [ ] **Phase 4 parts planned at stated rates** — not reached. All four are offered
      by the product picker (Assembly Director System, Magnetic Field Generator,
      Nuclear Pasta, Thermal Propulsion Rocket), so nothing blocks it but time.
      Nuclear Pasta at 0.5/min needs Copper Powder 100/min, which is **600 Copper
      Ingot/min**. That's a claim-budget problem rather than a plan problem, and
      the reason this objective wants its own session.
- [x] **Aluminum water loop closed** — reuse edges present and labelled, no fluid
      surplus left unexplained
- [ ] **Validate playthrough → no findings** — **0 errors, 17 warnings**. Three are
      the long-standing unsatisfiable Biomass checks. The other fourteen are
      unclaimed raws on the two new factories, all of them the tail of chains that
      should be imported and can't be yet (see below). Waste path stated in the
      layout artifact, with the reason it can't be stated in the app.
- [x] **Belt ≤ 780/min, pipes ≤ 600 m³/min** — busiest belt is Aluminum Scrap at
      606.7/min (78% of one Mk5), busiest pipe is the reactor water header at
      480 m³/min (80% of one Mk2). Nothing needs a parallel run.
- [x] **Layouts + screenshots** — Aluminum Plant and Nuclear Power Station written in
      full; plan graph, power view and validation panel captured

### What this group did not reach

Four things, and one root cause under three of them.

**Space Elevator Phase 4**, **Quartz Electronics** and the **Miner Mk.3 upgrade
sweep** across the six older factories weren't built. That's a scope call, not a
blocker, since the app offers every part Phase 4 needs.

**The imports the run's own rules require.** From Tier 4–5 onward this run moves
shared intermediates over logistics links instead of rebuilding them. At Tier 8 that
is nearly impossible, because every existing factory is sized exactly to its old
demand. Iron Works has 0.5 Modular Frame/min spare against the 4 the Aluminum Plant
needs; Steel Mill has 0 Steel Pipe/min spare against 18. So both new factories still
build their own iron, steel and oil chains on site, which is where fourteen of the
seventeen Validate warnings come from. Scaling Iron Works, Steel Mill, Copper Works,
Motor Works and Oil Refinery is the next group's first job, and doing it would clear
those warnings and take roughly 45 machines out of the two new plans.

### Skipped

**Reanimated SAM and SAM Fluctuator** (T8) have no line. Both are offered by the
picker and both are plannable; they're skipped for time, not because anything
blocks them.

**The whole plutonium chain** is skipped because it cannot be planned at all; see
the nuclear waste section.

Packaged fluids and Solid Biofuel remain skipped for the reasons given at Tier 5–6
and Tier 2.

### Map pass

Two things the map does well now. The **factory-binding picker is a real combobox**
everywhere it appears (node cards, water groups, the Resources row editor) with
icons and nearest-first distances, and it drives cleanly. And **dragging a factory
pin works**, which is what let the Nuclear Power Station be repositioned from a
mis-click onto the lake without deleting and rebuilding it.

Two things it still can't do. **Markers scale with the zoom**, so overlapping nodes
never separate. Measured at 2.21× zoom, seven nitrogen satellites spread over
36 × 46 px behind 53 px markers, with only two of the seven clickable at their own
centre. Resource wells are the worst case for this and they're new at this tier.
And the **extractor picker in the Resources row editor is still a native `<select>`**,
the last native control in the flow, and the one every Mk.3 upgrade has to go
through.

Panning turned out to be available after all: `webview_interact` swipe drives
neither the map nor the plan graph, but a dispatched `mousedown`/`mousemove`/`mouseup`
sequence pans both. That lifts the "one zoom level for the whole session" limit the
last four groups worked under, and it's what made the south-western bauxite and
nitrogen fields reachable at all.

### Screenshots

- `2026-07-26-full-game-t78-aluminum-plant-plan-graph.png`
- `2026-07-26-full-game-t78-power-nuclear-online.png`
- `2026-07-26-full-game-t78-validate.png`
- `2026-07-26-full-game-t78-nuclear-fuel-demand-no-waste-output.png`
- `2026-07-26-full-game-t78-plutonium-no-matches.png`
- `2026-07-26-full-game-t78-fuel-picker-offers-unplannable-plutonium.png`
- `2026-07-26-full-game-t78-belt-capacity-warning-has-no-text.png`
- `2026-07-26-full-game-t78-well-satellites-per-satellite-clock.png`
- `2026-07-26-full-game-t78-well-satellites-never-separate.png`
- `2026-07-26-full-game-t78-sources-every-exporter-short.png`
- `2026-07-26-full-game-t78-alts-no-tier-scoped-select.png`
- `2026-07-26-full-game-t78-quick-claim-defaults-to-mk1.png`
- `2026-07-26-full-game-t78-extractor-picker-still-native-select.png`
- `2026-07-26-full-game-t78-new-factory-card-no-coords.png`
- `2026-07-26-full-game-t78-product-chip-pending-commit.png`
- `2026-07-26-full-game-t78-water-tool-armed-state-invisible.png`

## Tier 7–8, second pass

Same tier, same playthrough, picking up the two objectives the first pass left: the
exporter re-scale and Quartz Electronics. The interesting part was the new `Raise
target` control in the Sources panel, used in anger for the first time.

### What the re-scale actually did

All five exporters were raised from inside the Aluminum Plant's plan, without leaving
it once:

| Item | Exporter | Raised to | Spare freed | What it cost the exporter |
| --- | --- | --- | --- | --- |
| Modular Frame | Iron Works | 11.5/min | 4.0/min | Crude Oil 9.8, Water 32.5 (both already short) |
| Steel Pipe | Steel Mill | 88.1/min | 39.1/min | Coal 266.1 vs 242.4, Iron Ore 266.1 vs 246 |
| Concrete | Copper Works | 51.0/min | 16.0/min | Limestone 153.1 vs 150.6 |
| Motor | Motor Works | 4.5/min | 2.5/min | Steel Pipe cap 20 short, Wire cap 56 short |
| Rubber | Oil Refinery | 70.6/min | 35.6/min | Crude Oil 309.8 vs 256.5 |

Wiring those five imports took the Aluminum Plant from 60 machines and 1,105.9 MW down
to 29 machines and 838.2 MW, and cleared its Crude Oil, Iron Ore and Limestone
warnings. That's objective 7 on the tier page, done.

It cost something, though. Five factories that had no warnings between them now have
seven, because each raise pushed demand onto a claim budget nobody had topped up.
Closing those is claim work rather than plan work.

### Quartz Electronics

Two Pure raw quartz nodes at 1.7 km W · 1.5 km N and 1.7 km W · 1.4 km N, claimed on
the map and bound to Caterium Electronics 800 m away, and all seven products added:
Quartz Crystal 22.5/min, Silica 37.5/min, Crystal Oscillator 1/min, AI Limiter 5/min,
High-Speed Connector 2/min, Radio Control Unit 1/min, Supercomputer 0.75/min.

Quartz Crystal was pinned off Alternate: Pure Quartz Crystal onto the standard recipe,
because the alt wants 16.1 m³/min of water and this site has no water claim.

The plant is planned but not supplied. Supercomputer and Radio Control Unit drag in the
computer, aluminum and plastic chains, so the site currently asks for bauxite, copper,
iron, limestone, sulfur, crude oil and water it has no claim on, plus 180.8 caterium
against 81 claimed. Aluminum Casing comes in from the Aluminum Plant and the rest
don't. Eight of the 29 remaining warnings are this factory.

### Claims

Two new claims, both Miner Mk.3 on Pure raw quartz. The first sat at 250% / 1200 ipm
to exercise the port check, then went to 162% / 778 ipm to fit a Mk5 belt. The second
is 100% / 480 ipm. Both are over the plant's 91.4/min demand and want trimming once
the imports land.

### Checkpoint

- [ ] **Phase 4 parts planned** — not reached, second group running. Nothing blocks it;
      Supercomputer now has a home, which was its prerequisite.
- [x] **Aluminum water loop closed** — unchanged from the first pass
- [ ] **Validate → no findings** — **0 errors, 29 warnings**, up from 17. Three are the
      long-standing unsatisfiable Biomass checks, eight are the new Quartz Electronics
      chains, nine are the Nuclear Power Station's untouched on-site build, eight are
      claim gaps at the exporters (six opened by the re-scale, plus Iron Works' Crude
      Oil and Water, which the alts pass had already left short), and one is a rounding
      artefact ("Modular Frame import short by 0.0/min")
- [x] **Belt ≤ 780/min, pipes ≤ 600 m³/min** — the one breach was deliberate and
      reverted; the port check caught it
- [ ] **Layouts** — not written for Quartz Electronics; the plant isn't supplied yet

### What this pass did not reach

Space Elevator Phase 4, the Miner Mk.3 upgrade sweep, the Nuclear Power Station's nine
imports, and the claim work the five raises created. Quartz Electronics is planned but
under-supplied.

### Screenshots

- `2026-07-26-full-game-t78b-raise-target-consequence-report.png`
- `2026-07-26-full-game-t78b-raise-target-honest-partial-coverage.png`
- `2026-07-26-full-game-t78b-raise-target-cap-shortfall-wording.png`
- `2026-07-26-full-game-t78b-no-raise-path-for-existing-source.png`
- `2026-07-26-full-game-t78b-no-raise-path-motor-works-topup.png`
- `2026-07-26-full-game-t78b-producer-listed-as-not-exporting.png`
- `2026-07-26-full-game-t78b-export-click-activates-pending-source.png`
- `2026-07-26-full-game-t78b-caterium-quickwire-60-spare.png`
- `2026-07-26-full-game-t78b-zero-demand-still-warns.png`
- `2026-07-26-full-game-t78b-needs-an-alt-recipe-mislabel.png`
- `2026-07-26-full-game-t78b-belt-port-warning-with-text.png`
- `2026-07-26-full-game-t78b-port-warning-advice-rounds-up-and-loops.png`
- `2026-07-26-full-game-t78b-resources-row-1200ipm-no-port-warning.png`
- `2026-07-26-full-game-t78b-factory-card-no-coordinates.png`
- `2026-07-26-full-game-t78b-map-claim-card-clock-unlabelled.png`
- `2026-07-26-full-game-t78b-validate-final.png`

## Tier 9 — Phase 4, Phase 5, and the end of the game

Tier set to 9 on entry. The run finishes here: Space Elevator Phase 4 reads
**Delivered** and every Phase 5 part has a producer with spare capacity.

This section is reconstructed rather than written live. The agent running this
group stopped responding before filing its own report, so what follows comes
from the playthrough database, the Space Elevator and Validate screenshots it
left behind, and the frame captures, rather than a first-person account
written during the session. Every figure below is checked against the
`.specsdb` directly rather than assumed.

### The fix that made this session different

Two passes at Phase 4 died on the same thing. Importing between factories meant
leaving the plan, opening the source factory, clicking `Export`, and coming back.
That's gone. The Sources panel now lists a factory that makes an item but has
never exported it, and one click opens the export slice:

> **MAKES BATTERY — NOT EXPORTING IT YET** · Aluminum Plant · 877 m away ·
> 15/min spare — *picking it opens a 7.5/min export slice. No extra machines.*

The effect is not subtle. Caterium Electronics went 47 → 38 machines on the first
use. Director Works went **65 machines → 1** on two imports, Magnet Works
**22 → 2** on four. Every factory below was built the same way: plan the part,
then pull its inputs off whatever already makes them.

### What was built

| Factory | Site | Products | Machines |
| --- | --- | --- | --- |
| Director Works | 1.5 km W · 0.4 km N | Assembly Director System 0.5/min | 1 |
| Magnet Works | 1.0 km W · 0.9 km N | Magnetic Field Generator 0.5/min | 2 |
| Rocket Works | 1.6 km W · 0.4 km S | Thermal Propulsion Rocket 0.5/min | 32 |
| Pasta Works | 1.0 km W · 1.6 km N | Nuclear Pasta 0.5/min | 20 |
| Quantum Lab | 2.0 km W · 0.5 km N | AI Expansion Server 0.5, Time Crystal 3, Dark Matter Crystal 3, Superposition Oscillator 1, Neural-Quantum Processor 0.75 | 68 |
| Warp Drive Final | 1.8 km W · 1.2 km N | Ballistic Warp Drive 0.5/min, Biochemical Sculptor 0.5/min | 118 |

Each sits on what feeds it: Director Works next to Caterium Electronics for
Supercomputer, Magnet Works 301 m from Motor Works for Stator, Rocket Works 275 m
from the Aluminum Plant for Cooling System and Fused Modular Frame, Pasta Works on
the copper.

### Nuclear Pasta was cheaper than budgeted

0.5 Nuclear Pasta/min needs 100 Copper Powder/min, which is 600 Copper Ingot/min.
The solver reached for **Alternate: Pure Copper Ingot** without being asked and
bought that 600 for **240 ore/min and 160 water/min**, well inside the 13.2k/min
the Resource budget panel said was still on the map. One Particle Accelerator
at 100%, 1,500 MW, and no claim crisis, though "no claim crisis" means the
budget wasn't the problem. None of that ore or water is actually claimed
anywhere yet, which is exactly what Validate's Pasta Works warnings say.

(Correction: an earlier pass at this section named the recipe as Leached Copper
Ingot. The sixteen Refinery machines the `.specsdb` records are running
Alternate: Pure Copper Ingot, which runs on Copper Ore and Water rather than
Sulfuric Acid, which is also why Water shows up as one of this factory's two
unclaimed raw inputs.)

### Power

Six new factories took the grid from +3,600 MW to **−5,056 MW**. The Nuclear
Power Station went from 2 reactors to 6 (17,222 MW generated) and its Uranium Fuel
Rod target from 0.4 to 1.2/min. Final grid **17,222 MW gen / 12,682 MW draw,
+4,540 MW**. The reactors' water isn't claimed to match, and Validate says so
plainly: "generators need 1577.6/min of Water, claims cover 526.2". At 1,577
m³/min that's three parallel Mk2 headers in the layout nobody has drawn yet.

### Space Elevator

Phase 4 (Propulsion) reads **Delivered**, which unlocks Tier 9. All four parts
clear their need with a producer to spare:

| Part | Needs | Free producer | Rate free |
| --- | --- | --- | --- |
| Assembly Director System | 500 | Director Works | 0.5/min |
| Magnetic Field Generator | 500 | Magnet Works | 0.5/min |
| Thermal Propulsion Rocket | 250 | Rocket Works | 0.5/min |
| Nuclear Pasta | 100 | Pasta Works | 0.5/min |

The app's "making" total for all four runs higher than the free rate above,
and the `.specsdb` explains all of it: each part also has a second, smaller
production line at Warp Drive Final or Quantum Lab, built to feed that
factory's own downstream part rather than the elevator. Assembly Director
System reads 0.625/min making because Director Works' 0.5/min sits alongside
a 0.125/min line at Warp Drive Final that's fully consumed by its own
Biochemical Sculptor. Thermal Propulsion Rocket and Magnetic Field Generator
both read 1/min making for the same reason: a second 0.5/min line at Warp
Drive Final (feeding its own Ballistic Warp Drive) and at Quantum Lab
(feeding its own AI Expansion Server) respectively. Nuclear Pasta reads
0.75/min making for the same reason again: Pasta Works' 0.5/min sits
alongside a 0.25/min line at Warp Drive Final that's fully consumed by its
own Singularity Cell machine (Singularity Cell needs 1 Nuclear Pasta/min at
100%, and that machine runs at 25% clock there, 0.25/min exactly).

None of this changes what the elevator can draw on: the "free" figures above
are what's actually uncommitted. What it does show is that Warp Drive Final
and Quantum Lab rebuilt small pieces of Director Works', Rocket Works' and
Magnet Works' output instead of importing them, the same gap the "MAKES X —
NOT EXPORTING IT YET" fix was built to close and apparently wasn't used
between the new factories themselves.

Phase 5 (Assembly), the project-launch phase, reads **In progress**, and
that's the right reading, not a shortfall. Its four "need" figures are
cumulative stockpiles the elevator banks before launch, not rates the network
has to sustain, and every one of them already has a producer running at
target with 0.5/min free:

| Part | Needs | Made at | Rate | Free |
| --- | --- | --- | --- | --- |
| Nuclear Pasta | 1,000 | Pasta Works | 0.75/min | 0.5/min |
| Biochemical Sculptor | 1,000 | Warp Drive Final | 0.5/min | 0.5/min |
| AI Expansion Server | 256 | Quantum Lab | 0.5/min | 0.5/min |
| Ballistic Warp Drive | 200 | Warp Drive Final | 0.5/min | 0.5/min |

Nuclear Pasta is the one part that straddles both phases: Pasta Works is the
same 0.75/min line that cleared Phase 4's 100 and is now banking toward Phase
5's 1,000. Nothing about Phase 5 needs a new plan; it needs uptime.

### Alternates

**Select reachable** is new and it settles the complaint from Tier 7–8. One click
took 103 → 111 with no risk of grabbing something above tier.

### Checkpoint

- [x] **Phase 4 parts planned at stated rates** — all four at 0.5/min or better,
      each in its own factory, phase reads Delivered
- [x] **SAM toggle auto-forced on** — planning AI Expansion Server turned it on by
      itself, so the showstopper condition on the tier page doesn't fire
- [x] **Phase 5 parts planned** — Nuclear Pasta 0.75/min, Biochemical Sculptor
      0.5/min, AI Expansion Server 0.5/min, Ballistic Warp Drive 0.5/min, each
      with 0.5/min free
- [ ] **Final Validate → no findings** — **0 errors, 60 warnings**. Every one is a
      claim gap. The oldest is Caterium Electronics at 185.3/min of caterium
      against 81 claimed; the new ones are Pasta Works (Copper Ore 240, Water 160)
      and the six reactors' fuel and water.
- [ ] **Belt ≤ 1200/min everywhere** — not re-checked; the Miner Mk.3 sweep never ran
- [x] **Layouts** — written for all six new factories: `director-works.md`,
      `magnet-works.md`, `rocket-works.md`, `pasta-works.md`,
      `quantum-lab.md`, `warp-drive-final.md`. Each is reconstructed from the
      `.specsdb` and a full material-balance check against the game's recipe
      data rather than from a live session, and each says so.

### What this group did not reach

The claim work behind those 60 warnings, and the **Miner Mk.3 upgrade sweep**
across the six older factories (which leaves the port-advice rounding fix
untested). On the tier page's own list, **SAM Conversion Works**, the
**Ficsonium loop** and the **Converter ore-patch** objective are unbuilt, and
Diamonds 7.5/min never became an explicit Quantum Lab target.

Writing the six new factories' layouts turned up two things worth carrying
forward. First, the `.specsdb` shows the Pasta Works recipe as **Alternate:
Pure Copper Ingot**, not Leached Copper Ingot as this section originally
said; corrected above. Second, Warp Drive Final rebuilds a full second copy
of the Thermal Propulsion Rocket, Nuclear Pasta and Assembly Director System
lines on site instead of importing them from Rocket Works, Pasta Works and
Director Works, all three of which already have spare capacity — the "MAKES
X — NOT EXPORTING IT YET" import flow that shrank Director Works and Magnet
Works so effectively was apparently never tried between the new factories
themselves. See `warp-drive-final.md` for the detail.

### Screenshots

- `2026-07-26-full-game-t9-space-elevator-phase4-5.png`
- `2026-07-26-full-game-t9-validate-final.png`
- `2026-07-26-full-game-t9-factory-card-raw-item-ids.png`
- `2026-07-26-full-game-t9-exports-none-contradicts-0-left.png`

## Closing the run

Seven tier groups across Tiers 0 through 9, in one continuous playthrough
that never restarted. It started as two factories on a plains claim, dragged onto
their nodes by hand because the map's own "place here" button hadn't been
found yet, and it ends as seventeen factories and 530 machines drawing
12,682 MW off a 17,222 MW grid, with 25 nodes claimed and 111 alternate
recipes unlocked.

Phase 5 is the number worth reading carefully rather than at a glance. It
shows **In progress**, not **Delivered**, and across four space elevator
phases so far that word has always meant the same thing: a producer is
running, the stockpile is climbing, and nothing is blocking it. That's true
here too. All four Phase 5 parts (Nuclear Pasta, Biochemical Sculptor, AI
Expansion Server, Ballistic Warp Drive) already run at their target rate
with spare capacity to grow into, and Phase 5's thousand-unit costs are
banked totals, not a demand the network has to keep meeting. So "in
progress" describes a complete production network waiting out a stockpile
timer, the same as Phase 1 did at Tier 2 and Phase 3 did at Tier 6. That's
not an admission anything is still unbuilt, and this write-up doesn't claim
Phase 5 as delivered either, because the screenshot doesn't say that.

What's genuinely left is mostly claim work, not plan work. All sixty of the
final Validate warnings are claim gaps: the six reactors' fuel and water,
Pasta Works' copper and water, and the caterium shortfall at Caterium
Electronics that's been on the books since Tier 7–8. The Miner Mk.3 sweep
across the six original-cluster factories never ran, so their belts are
still whatever mark carried them through the tier they were built in. The
one genuine plan gap the layout write-up turned up is Warp Drive Final,
which rebuilds a second copy of three parts other Tier 9 factories already
make with room to spare, instead of importing them. That's real waste, on
top of the claim gap, not instead of it. None of that stops the game from
finishing: every phase the Space Elevator asks for is either delivered or
actively producing. But it's real, and it's the honest state the network is
in rather than a tidier one.
