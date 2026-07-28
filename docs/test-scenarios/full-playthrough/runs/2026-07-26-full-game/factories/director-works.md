# Director Works — Tier 9 (new)

**Site:** 1.5 km W · 0.4 km N
**Built at:** Tier 9 · Mk6 belts (1200/min cap) · Mk2 pipes (600 m³/min cap)

This layout is reconstructed from the `.specsdb`, not written live: the agent
that built it stopped before filing its own report. Everything below is what
the database, the game's recipe data, and the two Tier 9 screenshots can
establish. Where that isn't enough, namely the actual reasoning behind the
site pick and any belt routing inside the plant, it's left unstated rather
than guessed.

## Why here

Director Works sits 393 m from Caterium Electronics and 634 m from Elevator
Yard, its two import partners. It holds no resource claim of its own, so the
site wasn't chosen for ore underfoot the way the Aluminum Plant or Nuclear
Power Station were. It reads as a placement aimed at its suppliers instead.

## Claims

None. Every input this factory needs arrives over a logistics link.

## Imports

| Item | Rate | From | Distance | Transport |
| --- | --- | --- | --- | --- |
| Supercomputer | 0.5/min | Caterium Electronics | 393 m | belt |
| Adaptive Control Unit | 1.0/min | Elevator Yard | 634 m | belt |

Neither link has a committed belt mark in the database (`transport_plan_json`
is empty on both rows), so there's no cap check to report here. Just the raw
rate and distance the app itself derived.

## Production

One machine, one recipe.

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Assembly Director System | 0.5/min ✱ | Assembly Director System | 1× Assembler @ 66.67% |

✱ = Space Elevator Phase 4 objective output.

The recipe takes Adaptive Control Unit 1.5/min and Supercomputer 0.75/min at
100% clock; at 66.67% that's 1.0/min and 0.5/min, which is exactly what the
two imports above deliver. Nothing is over- or under-supplied.

This is the cleanest example of the "MAKES X — NOT EXPORTING IT YET" import
flow described in the Tier 9 write-up: 65 machines down to 1, because both
inputs already existed at a neighboring factory with spare capacity.

## What isn't finished

Assembly Director System is also built in a second, much smaller line at Warp
Drive Final (0.125/min, feeding that factory's own Biochemical Sculptor
rather than importing from here). See the Space Elevator section of
`RUN.md` and `warp-drive-final.md` for that. Nothing about Director Works
itself is short: it has no unclaimed raw inputs, because it has no raw inputs
at all.
