# Motor Works — Tier 4 (new)

**Site:** Grass Fields, 1.30 km W / 1.00 km N
**Built at:** Tier 4 · Mk3 belts (270/min cap) · no extractors of its own

Motor Works is a pure assembly shop, and the site was chosen so that all four of
its imports are short hauls: 250 m to Steel Mill, 583 m to Copper Works, 613 m to
Iron Works, 320 m to Elevator Yard. Nothing here is smelted and nothing is mined:
it takes wire, cable, steel pipe and rotors and turns them into the three parts
Tier 4 wants.

## Claims

None.

## Production

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Stator | Stator | 3× Assembler | 83% | 12.5/min (5/min free ✱) |
| Motor | Motor | 1× Assembler | 50% | 2.5/min ✱ |
| Automated Wiring | Automated Wiring | 1× Assembler | 100% | 2.5/min ✱ |

✱ = tier objective output. 5 machines, 56.4 MW.

The Stator line is the interesting number. The objective asks for 5/min of free
Stator, but Motor eats 5/min and Automated Wiring another 2.5/min, so the plan
builds 12.5/min. The app works that out on its own; you set the product to 5 and
the node reports 12.5.

Automated Wiring is the cable sink of this tier: 2.5/min of it needs 50 Cable/min,
which needs 100 Wire/min on top of the 100 Wire the Stators drink.

## Imports

| Item | Rate | From | Distance (map) | Transport |
| --- | --- | --- | --- | --- |
| Wire | 100/min | Copper Works | 583 m | 1× Mk3 belt (37% used) |
| Cable | 50/min | Copper Works | 583 m | 1× Mk3 belt (19% used) |
| Steel Pipe | 37.5/min | Steel Mill | 250 m | 1× Mk3 belt (14% used) |
| Rotor | 5/min | Iron Works | 613 m | 1× Mk3 belt (2% used) |

Every one of these was a "build it here" chain before the imports were wired. Left
to itself the plan smelted its own iron and coal into steel pipe and made wire
from iron, at 31 machines and 182.9 MW. Sourcing the four intermediates over links
took it to 5 machines and 56.4 MW, which is the whole point of the exercise from
Tier 4 on.

## Exports

Automated Wiring 2.5/min is the Space Elevator Phase 2 deliverable and ships
direct from here. Stator 5/min and Motor 2.5/min stay free for milestone spend.

## Layout

Foundations are 8×8 m. Assembler 10×15 m. Wire and cable arrive from the north,
steel pipe from the south, rotors from the west.

```
        col 1-2            col 3-4              col 5-6
row 1   ══ Wire 100 ═════▶ [Assembler ×3]
row 2   ══ Pipe 37.5 ════▶  Stator 12.5/min ═══╦══ 5/min free
row 3                                          ║
row 4   ══ Rotor 5 ═══════════════════════╗    ║
row 5                                     ▼    ▼
row 6                              [Assembler] Motor 2.5/min ──▶ free
row 7                                  (5 Rotor + 5 Stator)
row 8
row 9   ══ Cable 50 ═════════════════▶ [Assembler]
row 10                                  (50 Cable + 2.5 Stator)
row 11                                  Automated Wiring 2.5/min ──▶ Phase 2
```

Five Assemblers fit in about 6×6 foundations (48 m × 48 m).

## Belt segments

Every segment is Mk3, cap 270/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Copper Works → plant | Wire | 100/min | 170 |
| 2 | Copper Works → plant | Cable | 50/min | 220 |
| 3 | Steel Mill → plant | Steel Pipe | 37.5/min | 232 |
| 4 | Iron Works → plant | Rotor | 5/min | 265 |
| 5 | Stator bank → Motor | Stator | 5/min | 265 |
| 6 | Stator bank → Automated Wiring | Stator | 2.5/min | 267 |
| 7 | Stator bank → out | Stator | 5/min | 265 |

Nothing is near a cap. Wire at 100/min is the busiest line and it uses 37% of one
Mk3.

## Power

| | MW |
| --- | --- |
| 3× Assembler @ 83% | 35.4 |
| 1× Assembler @ 50% | 6.0 |
| 1× Assembler @ 100% | 15.0 |
| **Draw** | **56.4** |
| Generators here | none |

Runs off the shared grid from Coal Power Station, 940 m south-east.
