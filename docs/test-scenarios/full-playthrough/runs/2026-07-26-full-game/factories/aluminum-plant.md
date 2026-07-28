# Aluminum Plant — Tier 7 (new)

**Site:** 1.85 km W · 0.22 km S — on the bauxite trio in the Rocky Desert, read
back off the app's own map pin rather than estimated.
**Built at:** Tier 7–8 · Mk5 belts (780/min cap) · Mk2 pipes (600 m³/min cap)

## Why here

Three bauxite nodes sit inside 700 m of each other at 1.8 W / 0.4 S (Pure),
2.2 W / 0.1 S (Pure) and 1.5 W / 0.0 N (Normal), and no other bauxite on the map
is within a kilometre of an approved water body. The Gold Coast shoreline is
0.71 km west, which is the shortest fresh-water pipe run any bauxite site on this
map can have, since every other bauxite cluster is 1.5 km or more from water. Coal and
copper both turned out to be inside 1 km as well, so the plant smelts its own
aluminum, burns its own coal and makes its own copper ingot without a single
import for the aluminum chain itself.

The app's link distances confirmed the placement afterwards: Steel Mill 1,094 m
against a calculated 1,098 m, Iron Works 1,400 m against 1,400 m.

## Claims

| Node | Purity | Extractor | Clock | Output | Distance |
| --- | --- | --- | --- | --- | --- |
| Bauxite #5 · 1.8 km W · 0.4 km S | Pure | Miner Mk.3 | 76% | 362 ipm | 240 m |
| Coal #8 · 1.5 km W · 0.6 km S | Pure | Miner Mk.3 | 44% | 210 ipm | 499 m |
| Copper Ore #12 · 1.6 km W · 1.1 km S | Impure | Miner Mk.3 | 42% | 51 ipm | 941 m |
| Sulfur #3 · 1.0 km W · 0.9 km S | Normal | Miner Mk.3 | 16% | 38 ipm | 1,085 m |
| Nitrogen Gas #18 · 1.4 km W · 1.2 km S | Pure | Well Extractor | 50% | 60 m³/min | 1,101 m |
| Nitrogen Gas #22 · 1.4 km W · 1.2 km S | Pure | Well Extractor | 100% | 120 m³/min | 1,050 m |

Every clock is set to demand rather than left at 100%, so nothing is mined that
nowhere consumes. Bauxite at 362 ipm is the busiest extractor on the site and it
sits at 46% of a Mk5 belt, so the output port is comfortable. There's a note at
the bottom about what happens when it isn't.

Water is a group rather than a claim: **4× Water Extractor @ 82.5% = 396 m³/min**
on the Gold Coast shoreline at 2.50 km W · 0.50 km S, 708 m from the plant, against
341.4 m³/min of demand.

## Production

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Aluminum Ingot | 303.3/min (60 free) | Alternate: Pure Aluminum Ingot | 11× Smelter @ 92% |
| Alclad Aluminum Sheet | 30/min ✱ | Alclad Aluminum Sheet | 1× Assembler @ 100% |
| Aluminum Casing | 160/min (40 free) | Alternate: Alclad Casing | 2× Assembler @ 71% |
| Battery | 15/min ✱ | Battery | 1× Blender @ 75% |
| Cooling System | 5/min ✱ | Alternate: Cooling Device | 1× Blender @ 100% |
| Fused Modular Frame | 1.5/min ✱ | Fused Modular Frame | 1× Blender @ 100% |

✱ = tier objective output.

60 machines. Aluminum Ingot runs well over its 60/min target because Alclad Sheet,
Casing and the Fused Modular Frame line all draw on it, so 303/min is what the
whole site needs rather than padding.

## The water loop

This is the part worth reading. Alumina Solution takes water in and Aluminum Scrap
gives water back, and the plan wires the return straight into the intake instead of
importing twice:

```
   Bauxite 362/min ──▶ [Alumina Solution]  ◀── Water 341.4/min fresh (Gold Coast)
                              │      ▲
             Alumina 434.4/min│      │ Water 61.2/min  ── recycled
                              ▼      │
                        [Aluminum Scrap] 606.7/min
                              │
                              ▼
                     [Aluminum Ingot] 303.3/min
```

The graph draws the return as its own edge, labelled `Water · 61.2/min (reuse)`,
next to a separate `Water · 28.8/min` fresh edge. The two are never merged into one
number, which is the whole point. A plan that quietly re-imported the recycled
water would balance on paper and still cost you an extra extractor bank in the
game.

Recipe choices came out of the solver and were kept: **Alternate: Sloppy Alumina**
(bauxite + water, no coal) upstream, **Alternate: Pure Aluminum Ingot** downstream,
which skips silica entirely and means this plant needs no raw quartz at all.

Three recipes were pinned back by hand. Aluminum Scrap was left on the standard
recipe rather than **Alternate: Electrode Aluminum Scrap**, because the alt wants
petroleum coke and the nearest crude oil is 3.1 km away, while coal is 499 m away.
Battery was pinned off **Alternate: Classic Battery**, which drags in plastic and
wire, onto the standard sulfuric-acid recipe the tier page asks for. Fused Modular
Frame was pinned off **Alternate: Heat-Fused Frame**, which wants fuel and nitric
acid, onto the standard recipe that runs on casing and nitrogen, both of which
this plant already makes.

## Byproducts

Nothing is left with nowhere to go. The recycled water is consumed, and the sulfuric
acid line runs at exactly the 37.5 m³/min the Battery bank draws.

## Pipes

| Segment | Rate | Cap at T8 | Lines |
| --- | --- | --- | --- |
| Gold Coast group → plant | Water 396 m³/min | Mk2 600 | 1 |
| Nitrogen wells → plant | Nitrogen Gas 180 m³/min | Mk2 600 | 1 |
| Alumina Solution → Aluminum Scrap | 434.4 m³/min | Mk2 600 | 1 |
| Aluminum Scrap → Alumina (reuse) | 61.2 m³/min | Mk2 600 | 1 |
| Sulfuric Acid → Battery | 37.5 m³/min | Mk2 600 | 1 |

The 708 m water run and the 1.1 km nitrogen run are the two long ones, and both
fit inside a single Mk2 pipe.

## Belts

| Segment | Rate | Cap at T8 | Lines |
| --- | --- | --- | --- |
| Bauxite miner → Alumina bank | 362/min | Mk5 780 | 1 |
| Coal miner → Aluminum Scrap | 210/min | Mk5 780 | 1 |
| Aluminum Scrap → Smelter bank | 606.7/min | Mk5 780 | 1 |
| Aluminum Ingot → Casing / Sheet | 303.3/min | Mk5 780 | 1 |
| Aluminum Casing → out | 160/min | Mk5 780 | 1 |

The scrap belt at 606.7/min is the busiest segment anywhere in the run so far, and
it still fits one Mk5. Nothing here needs a parallel line.

## Imports

| Item | Rate | From | Distance | Transport |
| --- | --- | --- | --- | --- |
| Encased Industrial Beam | 4/min | Steel Mill | 1,094 m | 1× Mk5 belt (<1%) |

One import, and only 4/min of the 5/min the Heavy Modular Frame line needs, because
that was everything Steel Mill had spare. See the honest gap below.

## What isn't finished

The aluminum half of this plant is complete and supplied. The **Heavy Modular Frame
sub-chain is not**, and it's the reason Validate still shows three warnings against
this factory: Iron Ore 117.5/min, Limestone 24.1/min and Crude Oil 10.7/min, none
of them claimed.

Fused Modular Frame needs 1.5 Heavy Modular Frame/min, and Heavy Modular Frame is
currently built on site out of iron ore the site doesn't have. It should be pulled
in over links instead: Modular Frame from Iron Works, Encased Industrial Beam and
Steel Pipe from Steel Mill, Concrete from Copper Works. That's blocked on those four
factories having no spare capacity to export. Iron Works has 0.5 Modular
Frame/min free against 4 needed; Steel Mill has 0 Steel Pipe/min free against 18
needed. Scaling those two up is the next tier group's first job, and it will clear
all three warnings at once.

The same shape explains the rubber, plastic and motor lines still sitting on this
plan: they exist only because the Cooling System and Heat Sink recipes need them and
Oil Refinery and Motor Works had nothing spare either.
