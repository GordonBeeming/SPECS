# Rocket Works — Tier 9 (new)

**Site:** 1.6 km W · 0.4 km S
**Built at:** Tier 9 · Mk6 belts (1200/min cap) · Mk2 pipes (600 m³/min cap)

This layout is reconstructed from the `.specsdb` and the game's recipe data,
not written live: the agent that built it stopped before filing its own
report. The production breakdown below is a full material-balance
reconciliation (every machine's inputs and outputs at its recorded clock,
checked against every import and export) rather than a guess, but the site
reasoning and any internal belt routing aren't in the database, so they're
left unstated rather than invented.

## Why here

Rocket Works sits 275 m from the Aluminum Plant, its closest and heaviest
import partner, then 1,051 m from Caterium Electronics, 1,384 m from Motor
Works and 1,422 m from Elevator Yard. It holds no resource claim of its own.
Unlike the Aluminum Plant or Nuclear Power Station, whose sites were chosen
for ore or water underfoot, this one reads as placed near its cheapest
supplier and left to import the rest.

## Claims

None.

## Imports

| Item | Rate | From | Distance | Transport |
| --- | --- | --- | --- | --- |
| Cooling System | 1.5/min | Aluminum Plant | 275 m | belt |
| Fused Modular Frame | 0.5/min | Aluminum Plant | 275 m | belt |
| Motor | 1.17/min | Motor Works | 1,384 m | belt |
| Radio Control Unit | 1.5/min | Caterium Electronics | 1,051 m | belt |
| Modular Engine | 1.25/min | Elevator Yard | 1,422 m | belt |

None of the five links carries a committed belt mark in the database
(`transport_plan_json` is empty on all of them), so there's no cap check to
report. Just the rates and distances the app derived.

## Production

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Thermal Propulsion Rocket | 0.5/min ✱ | Thermal Propulsion Rocket | 1× Manufacturer @ 50% |

✱ = Space Elevator Phase 4 objective output.

32 machines total, and the objective line only needs four inputs: Modular
Engine, Cooling System and Fused Modular Frame all arrive by import, exactly
matching the table above. The fourth, Turbo Motor, is where the factory grows
a tail. The recipe in use, Alternate: Turbo Electric Motor, needs Motor,
Radio Control Unit, Electromagnetic Control Rod and Rotor, a heavier bill
than the standard recipe, and one that pulls Electromagnetic Control Rod in
as a dependency most players wouldn't expect from a motor. Motor and Radio
Control Unit are imported (1.17/min and 1.5/min above, matching the recipe's
demand at this factory's clock exactly); Electromagnetic Control Rod and
Rotor are built on site, and each of those cascades further into caterium,
steel, aluminum, iron, copper and quartz processing under standard and
alternate recipes. That tail is the other 27 or so machines: Stator, AI
Limiter, Quickwire, Screws, Wire, Steel Ingot and Steel Rod chains, plus a
handful of Refinery lines (Pure Iron/Copper/Caterium Ingot, Sloppy Alumina,
Plastic, Recycled Rubber, Alumina Solution) sized to feed them. Most of it
reconciles to within a fraction of a unit per minute against what the tail
actually consumes; the residue that doesn't (a little spare Aluminum Casing,
Petroleum Coke, Quartz Crystal and Silica) is the same kind of small solver
surplus the Aluminum Plant's byproduct handling already showed, not a defect
of this factory.

## What isn't finished

None of Rocket Works' raw inputs are claimed. Reconciling every machine's
actual draw against imports and on-site supply gives a clean picture of what
the factory needs and doesn't have: Iron Ore 11.5/min, Water 19.5/min,
Bauxite 3.2/min, Copper Ore 3.0/min, Caterium Ore 2.1/min, Coal 0.8/min,
Crude Oil 1.0/min and Raw Quartz 0.7/min. Every one of those is part of the
60-warning claim gap the Tier 9 checkpoint reports, not a plan defect. The
chain is real and it balances; it's just standing on nodes nobody has
claimed yet.
