# Warp Drive Final — Tier 9 (new)

**Site:** 1.8 km W · 1.2 km N
**Built at:** Tier 9 · Mk6 belts (1200/min cap) · Mk2 pipes (600 m³/min cap)

This layout is reconstructed from the `.specsdb` and the game's recipe data,
not written live: the agent that built it stopped before filing its own
report. The production breakdown below is a full material-balance
reconciliation, checked against every import and export, rather than a
guess; the site reasoning and any internal belt routing aren't in the
database, so they're left unstated rather than invented.

## Why here

Warp Drive Final holds no resource claim and its only import link is 696 m
from Quantum Lab. There's nothing else in the database that explains the
site: it isn't near a claimed node, and unlike Director Works, Magnet Works,
Rocket Works or Pasta Works it isn't sitting close to a cluster of
suppliers either, because it barely imports anything.

## Claims

None.

## Imports

| Item | Rate | From | Distance | Transport |
| --- | --- | --- | --- | --- |
| Superposition Oscillator | 1.0/min | Quantum Lab | 696 m | belt |

That's the only input this 118-machine factory pulls from anywhere else in
the network. `transport_plan_json` is empty on the link, so there's no
committed belt mark to check.

## Production

Both of the run's last two Space Elevator parts:

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Ballistic Warp Drive | 0.5/min ✱ | Ballistic Warp Drive | 1× Manufacturer @ 50% |
| Biochemical Sculptor | 0.5/min ✱ | Biochemical Sculptor | 1× Blender @ 25% |

✱ = Space Elevator Phase 5 objective output.

This is the least import-driven factory of the six, and the 118-machine
count is why. Ballistic Warp Drive needs Thermal Propulsion Rocket,
Singularity Cell, Superposition Oscillator and Dark Matter Crystal;
Biochemical Sculptor needs Assembly Director System, Ficsite Trigon and
Water. Only Superposition Oscillator is imported. Everything else, down to
the raw ore, is built here from scratch, effectively re-running the whole
Phase 4/5 part chain a second time inside one factory:

- **Thermal Propulsion Rocket** (0.5/min) is its own Manufacturer line,
  needing Modular Engine, Turbo Motor, Cooling System and Fused Modular
  Frame, all four built on site rather than imported from Rocket Works,
  which already has 0.5/min of TPR free.
- **Singularity Cell** (2.5/min) needs Nuclear Pasta, Dark Matter Crystal,
  Iron Plate and Concrete. Nuclear Pasta is a third, small on-site line
  (0.25/min) rather than an import from Pasta Works, which already has
  0.5/min free. This is the "second Nuclear Pasta line" the Space Elevator
  section of `RUN.md` traces, and it closes cleanly here: 0.25 Nuclear
  Pasta/min in, 0.25/min consumed by this exact machine.
- **Dark Matter Crystal** (25/min total: 5/min for Singularity Cell, 20/min
  for Ballistic Warp Drive directly) comes from a Particle Accelerator
  running Alternate: Dark Matter Trap, fed by Time Crystal and Dark Matter
  Residue lines built under it.
- **Assembly Director System** (0.125/min) is a fourth self-feeding line,
  the same one the Space Elevator table's footnote covers. It exists only
  to feed this factory's Biochemical Sculptor, not to export to Director
  Works' elevator supply.
- **Nuclear Pasta's own recipe** needs Pressure Conversion Cube, which in
  turn needs Fused Modular Frame and Radio Control Unit, both built here a
  second time as well, closing the loop back to the aluminum and caterium
  chains underneath.

Underneath all of that sits a full base-metal tail: eleven Pure Copper Ingot
Refineries, seven Pure Iron Ingot Refineries, four Pure Aluminum Ingot
Smelters, a Steel foundry line, and the caterium, quartz, plastic and rubber
processing needed to feed circuit boards, computers, motors, stators and
casings across the whole thing. It's the same shape as Rocket Works' tail,
just five to ten times the size, because it's carrying two Phase 5 parts and
their full prerequisite chain instead of one Phase 4 part with three of its
four inputs imported.

## What isn't finished

None of Warp Drive Final's raw inputs are claimed, and this is the largest
gap of the six new factories by a wide margin. Reconciling every machine's
draw against on-site supply and the one import: Water 585.5/min (net, after
75.4/min recycled internally), Copper Ore 357.7/min, Coal 260.8/min, Iron
Ore 244.1/min, SAM 198.6/min, Limestone 111.1/min, Crude Oil 46.6/min,
Nitrogen Gas 42.0/min, Raw Quartz 12.8/min and Caterium Ore 11.6/min: nine
different raw items, none claimed anywhere.

The deeper fix isn't claim work at all. Four of this factory's own
intermediate lines (Thermal Propulsion Rocket, Nuclear Pasta, Assembly
Director System, and the Pressure Conversion Cube chain under it) duplicate
production that Rocket Works, Pasta Works and Director Works already have
running with spare capacity. Wiring those as imports instead, the same
"MAKES X — NOT EXPORTING IT YET" flow used to build Director Works and
Magnet Works, would very likely take a real bite out of both the machine
count and the raw-material list above, the way it already did for the
factories that used it.
