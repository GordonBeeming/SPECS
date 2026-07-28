# Pasta Works — Tier 9 (new)

**Site:** 1.0 km W · 1.6 km N
**Built at:** Tier 9 · Mk6 belts (1200/min cap) · Mk2 pipes (600 m³/min cap)

This layout is reconstructed from the `.specsdb` and the game's recipe data,
not written live: the agent that built it stopped before filing its own
report. The production breakdown below is a full material-balance
reconciliation, checked against every import and export, rather than a
guess; the site reasoning and any internal belt routing aren't in the
database, so they're left unstated rather than invented.

## Why here

Pasta Works sits 1,264 m from Caterium Electronics and 2,015 m from the
Aluminum Plant, its two import partners, both single low-rate belt links.
It holds no resource claim of its own. The "on the copper" siting the Tier
9 write-up describes refers to an unclaimed copper cluster this factory
still needs to reach, not to ore it's already working.

## Claims

None.

## Imports

| Item | Rate | From | Distance | Transport |
| --- | --- | --- | --- | --- |
| Fused Modular Frame | 0.5/min | Aluminum Plant | 2,015 m | belt |
| Radio Control Unit | 1.0/min | Caterium Electronics | 1,264 m | belt |

Neither link carries a committed belt mark in the database
(`transport_plan_json` is empty on both), so there's no cap check to report.

## Production

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Nuclear Pasta | 0.5/min ✱ | Nuclear Pasta | 1× Particle Accelerator @ 100% |

✱ = Space Elevator Phase 4 objective output.

20 machines, and this is the cleanest chain of the six new factories. Nuclear
Pasta needs Copper Powder 100/min and Pressure Conversion Cube 0.5/min.
Pressure Conversion Cube comes from a single Assembler at 50% clock, taking
the two imports above directly (0.5/min Fused Modular Frame and 1.0/min
Radio Control Unit), exactly what the recipe needs at that clock. Copper
Powder comes from two Constructors at 100%, which need Copper Ingot
300/min between them; that's covered by sixteen Refinery machines running
Alternate: Pure Copper Ingot at 100% clock, 15 Copper Ore and 10 Water each,
for 240 Copper Ore/min and 160 Water/min combined.

RUN.md's "Nuclear Pasta was cheaper than budgeted" section originally named
this recipe as Leached Copper Ingot; the `.specsdb` shows Pure Copper Ingot
instead, and RUN.md has been corrected to match. The two recipes aren't
interchangeable here: Leached Copper Ingot runs on Sulfuric Acid, not Water,
so the water demand below wouldn't exist under that recipe.

## What isn't finished

Pasta Works has exactly two unclaimed raw inputs: Copper Ore 240/min and
Water 160/min, both entirely from the copper-ingot line. Both are named
directly in the Tier 9 checkpoint's warning summary. Nothing else about this
factory is short: the objective output and both of its imports already
balance exactly.
