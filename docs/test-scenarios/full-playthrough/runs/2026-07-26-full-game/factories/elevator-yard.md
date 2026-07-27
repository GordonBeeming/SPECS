# Elevator Yard — Tier 2 (new)

**Site:** Grass Fields, ~1.6 km W / 1.1 km N — 297 m south-east of Iron Works
**Built at:** Tier 2 · Mk2 belts (120/min cap) · no extractors of its own

The site was picked on the map by eye: close enough to Iron Works that both
imports ride a short belt, far enough out to be its own plot rather than bolted
onto a plant already running 36 machines. The app then confirmed the choice, with
its Add-source panel and the logistics dialog both reporting 297 m to Iron Works
against 780 m to Copper Works.

The coordinates above are derived from those two distances, because the app never
shows a factory's own position on any screen — there's nothing to read off.

## Claims

None. Every input arrives over a logistics link. This is the run's first factory
with no extractor of its own, which is rather the point of a Space Elevator part
factory.

## Production

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Smart Plating | Smart Plating | 3× Assembler | 83% | 5/min ✱ |

✱ = tier objective output, and the Phase 1 deliverable.

Space Elevator Phase 1 (Distribution Platform) wants Smart Plating × 50. At
5/min that's a ten-minute delivery. The Space Elevator screen tracks it and names
Elevator Yard as the producer.

## Imports

| Item | Rate | From | Transport | Distance |
| --- | --- | --- | --- | --- |
| Reinforced Iron Plate | 5/min | Iron Works | 1× Mk2 belt | 297 m |
| Rotor | 5/min | Iron Works | 1× Mk2 belt | 297 m |

Both links are Mk2 belts at 4% of capacity. The link planner ranked eight
options for the 297 m gap and locked the six that need Tier 3+.

## Layout

Foundations are 8×8 m. Both belts arrive from the north-west.

```
        col 1              col 2            col 3
row 1   ══ RIP 5/min ═════▶ [Assembler A] ──┐
row 2      (from Iron Works)                │
row 3                                       ├─▶ 5 Smart Plating/min ──▶ out
row 4   ══ Rotor 5/min ═══▶ [Assembler B] ──┤
row 5      (from Iron Works)                │
row 6                       [Assembler C] ──┘
row 7
row 8   [Biomass Burner ×2]
```

The three Assemblers each run at 83%, so the two incoming belts split three ways
at the plant edge — RIP 1.67/min and Rotor 1.67/min per machine. Assembler
footprint is 10×15 m, Biomass Burner 8×8 m; the whole yard fits in about
5×6 foundations (40 m × 48 m).

## Belt segments

Every segment is Mk2, cap 120/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Iron Works → plant edge | Reinforced Iron Plate | 5/min | 115 |
| 2 | Iron Works → plant edge | Rotor | 5/min | 115 |
| 3 | Split → each Assembler | RIP | 1.67/min ×3 | 118 |
| 4 | Split → each Assembler | Rotor | 1.67/min ×3 | 118 |
| 5 | Merge → output | Smart Plating | 5/min | 115 |

Nothing here is close to a cap. The two 297 m hauls are the only long runs.

## Power

| | MW |
| --- | --- |
| 3× Assembler @ 83% | 35.4 |
| **Draw** | **35.4** |
| 2× Biomass Burner @ 100% | 60.0 |
| **Balance** | **+24.6** |

Fuel: Biomass 8.00/min, hand-fed.

---

# Elevator Yard — Tier 3–4 delta

**Belts upgraded Mk2 → Mk3 (270/min).** 3 machines → **4 machines · 50.4 MW**.
Versatile Framework joins Smart Plating, so the yard now covers two of the three
Space Elevator Phase 2 parts.

## Production — added

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Versatile Framework | Versatile Framework | 1× Assembler | 100% | 5/min ✱ |

✱ = tier objective output and a Phase 2 deliverable.

One Assembler at 100% is the whole line. What makes it expensive is upstream:
5 Versatile Framework/min needs **30 Steel Beam/min**, which is three quarters of
everything Steel Mill produces.

## Imports — added

| Item | Rate | From | Distance (map) | Transport |
| --- | --- | --- | --- | --- |
| Steel Beam | 30/min | Steel Mill | 449 m | 1× Mk3 belt (11% used) |
| Modular Frame | 2.5/min | Iron Works | 297 m | 1× Mk3 belt (1% used) |

Both were local production chains before they were sourced. Building Steel Beam
here instead would have meant smelting steel at a site with no coal and no iron,
which is exactly what the tier's logistics guidance says not to do — the plan went
from 26 machines to 4 once the two intermediates came in over links.

## Layout — added

```
        col 1              col 2              col 3
row 1   ══ Steel Beam 30/min ═══▶ [Assembler D] ──▶ 5 Versatile Framework/min
row 2      (from Steel Mill, 449 m)     ▲
row 3   ══ Modular Frame 2.5/min ═══════┘
row 4      (from Iron Works, 297 m)
```

Assembler D sits south of the three Smart Plating machines on the same pad; the
yard is still inside 5×7 foundations.

## Belt segments — added

| # | From → To | Carries | Rate | Headroom (Mk3) |
| --- | --- | --- | --- | --- |
| 6 | Steel Mill → plant edge | Steel Beam | 30/min | 240 |
| 7 | Iron Works → plant edge | Modular Frame | 2.5/min | 267 |
| 8 | Assembler D → output | Versatile Framework | 5/min | 265 |

## Power — changed

| | MW |
| --- | --- |
| 3× Assembler @ 83% (Smart Plating) | 35.4 |
| 1× Assembler @ 100% (Versatile Framework) | 15.0 |
| **Draw** | **50.4** |
| 2× Biomass Burner @ 100% | 60.0 |
| **Balance** | **+9.6** |

## Space Elevator Phase 2

| Part | Needs | Made here | Free rate |
| --- | --- | --- | --- |
| Smart Plating | 1,000 | yes | 5/min |
| Versatile Framework | 1,000 | yes | 5/min |
| Automated Wiring | 100 | no — Motor Works, 320 m away | 2.5/min |

Automated Wiring is **not** routed through the yard. A product row is always built
locally in this app — there's no way to say "this factory receives 2.5/min of X" —
so adding Automated Wiring here rebuilt the whole Stator/Wire/Cable chain on site.
It ships from Motor Works instead.

---

# Elevator Yard — Tier 5–6 delta

**Belts upgraded Mk3 → Mk4 (480/min).** 4 machines → **8 machines · 184.9 MW**.
Modular Engine and Adaptive Control Unit join, so the yard now covers all three
Space Elevator Phase 3 parts.

## Production — added

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Modular Engine | Modular Engine | 1× Manufacturer | 100% | 1/min ✱ |
| Adaptive Control Unit | Adaptive Control Unit | 1× Manufacturer | 100% | 1/min ✱ |
| Heavy Modular Frame | Alternate: Heavy Flexible Frame | 1× Manufacturer | 27% | 1/min |

✱ = tier objective output and a Phase 3 deliverable.

Heavy Modular Frame is the one thing still built on site rather than imported.
It only needs 1/min for the Adaptive Control Unit line, and its four inputs
(Modular Frame, Encased Industrial Beam, Rubber, Screws) all arrive over links
that already exist, so a single Manufacturer at 27% is cheaper than a tenth
factory.

## Imports — added

| Item | Rate | From | Distance (map) | Transport |
| --- | --- | --- | --- | --- |
| Rubber | 35/min | Oil Refinery | 2,133 m | 1× Mk4 belt (7% used) |
| Screws | 104/min | Iron Works | 297 m | 1× Mk4 belt (22% used) |
| Reinforced Iron Plate | 7/min | Iron Works | 297 m | 1× Mk4 belt (1% used) |
| Rotor | 7/min | Iron Works | 297 m | 1× Mk4 belt (1% used) |
| Encased Industrial Beam | 3/min | Steel Mill | 449 m | 1× Mk4 belt (1% used) |
| Automated Wiring | 5/min | Motor Works | 320 m | 1× Mk4 belt (1% used) |
| Circuit Board | 5/min | Computer Plant | 939 m | 1× Mk4 belt (1% used) |
| Computer | 2/min | Computer Plant | 939 m | 1× Mk4 belt (<1% used) |

Automated Wiring finally does route through the yard, because the Sources panel
now lets a node be fed entirely by imports with local production removed. That's
the fix for the Tier 3–4 note above.

Wiring these eight imports collapsed the plan from **55 machines and 604 MW**,
where it was smelting its own iron, refining its own oil and building an AI
Limiter, down to 8 machines and 184.9 MW.

## Belt segments — added

Every segment is Mk4, cap 480/min. The busiest is Screws at 104/min, 22% of one
belt, so nothing needs a parallel run.

| # | From → To | Carries | Rate | Headroom (Mk4) |
| --- | --- | --- | --- | --- |
| 9 | Iron Works → plant edge | Screws | 104/min | 376 |
| 10 | Oil Refinery → plant edge | Rubber | 35/min | 445 |
| 11 | Iron Works → plant edge | Reinforced Iron Plate | 7/min | 473 |
| 12 | Iron Works → plant edge | Rotor | 7/min | 473 |
| 13 | Steel Mill → plant edge | Encased Industrial Beam | 3/min | 477 |
| 14 | Motor Works → plant edge | Automated Wiring | 5/min | 475 |
| 15 | Computer Plant → plant edge | Circuit Board | 5/min | 475 |
| 16 | Computer Plant → plant edge | Computer | 2/min | 478 |

## Power — changed

| | MW |
| --- | --- |
| 3× Assembler @ 88% (Smart Plating) | 50.3 |
| 1× Assembler @ 100% (Versatile Framework) | 15.0 |
| 1× Manufacturer @ 100% (Modular Engine) | 55.0 |
| 1× Manufacturer @ 100% (Adaptive Control Unit) | 55.0 |
| 1× Manufacturer @ 27% (Heavy Modular Frame) | 9.6 |
| **Draw** | **184.9** |
| 2× Biomass Burner @ 100% | 60.0 |
| **Balance** | **−124.9**, carried by the shared grid |

The two legacy Biomass Burners stay in the plan only because the generator
delete control can't be driven over the MCP bridge. They are no longer
load-bearing: coal and fuel carry the grid with 527 MW spare.

## Space Elevator Phase 3

| Part | Needs | Made here | Free rate |
| --- | --- | --- | --- |
| Versatile Framework | 2,500 | yes | 5/min |
| Modular Engine | 500 | yes | 1/min |
| Adaptive Control Unit | 100 | yes | 1/min |
