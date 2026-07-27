# Computer Plant

**Site:** 0.70 km W · 1.30 km N — 268 m from Copper Works, which feeds it copper
sheet and cable over two short belts.
**Tier introduced:** 6

## Claims

None. Every input arrives over a logistics link, which is the point of the
factory: at Tier 6 the network is meant to move intermediates rather than
rebuild them.

## Production

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Circuit Board | 22/min (10 free) | Circuit Board | 3× Assembler @ 98% |
| Computer | 3/min | Computer | 2× Manufacturer @ 60% |

5 machines, 99.7 MW.

## Imports

| Item | Rate | From | Distance | Transport |
| --- | --- | --- | --- | --- |
| Plastic | 136/min | Oil Refinery | 1,242 m | 1× Mk4 belt (28% used) |
| Copper Sheet | 44/min | Copper Works | 268 m | 1× Mk4 belt (9% used) |
| Cable | 24/min | Copper Works | 268 m | 1× Mk4 belt (5% used) |

## The rate the app wouldn't take

The tier page asks for Computer at 2.5/min. Every rate field in the app is
`step="1"`, so 2.5 is rejected by native form validation with no message at all
and the dialog simply refuses to close. The plant is planned at **3/min**
instead. The Motor Works chips still hold 2.5 from Tier 3–4, so the data model
handles fractions fine; it's only the input that blocks them.

## Why the standard recipes

Left alone the solver picked **Alternate: Crystal Computer**, which is fed by
Crystal Oscillator and AI Limiter (both Tier 7), and expanded to 18 machines with
a quartz and caterium chain attached. Nothing warned that a Tier 6 playthrough
had just been handed a Tier 7 plan. Computer and Circuit Board were both pinned
to the standard recipes.

The same pin cut the plant from 27 machines and 493 MW (building its own copper,
iron and oil chains on the plains) to 5 machines and 99.7 MW once the three
imports were wired.

## Belts

| Segment | Rate | Cap at T6 | Lines |
| --- | --- | --- | --- |
| Plastic in → Circuit Board bank | 88/min | Mk4 480 | 1 |
| Plastic in → Manufacturer bank | 48/min | Mk4 480 | 1 |
| Copper Sheet in → Circuit Board bank | 44/min | Mk4 480 | 1 |
| Circuit Board → Manufacturer bank | 12/min | Mk4 480 | 1 |
| Cable in → Manufacturer bank | 24/min | Mk4 480 | 1 |

## Exports

| Item | Rate | To |
| --- | --- | --- |
| Circuit Board | 5/min | Elevator Yard |
| Computer | 2/min | Elevator Yard |

## Power

No generators on site. 99.7 MW from the shared grid.
