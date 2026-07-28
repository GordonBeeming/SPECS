# Iron Works — Tier 0

**Site:** Grass Fields, western edge — 1.9 km W / 1.2 km N
**Built at:** Tier 0 · Mk1 belts only (60/min cap) · Miner Mk.1 only

## Claims

| Node | Purity | Coords | Extractor | Clock | Output |
| --- | --- | --- | --- | --- | --- |
| Iron Ore #6 | Normal | 1.9 km W · 1.2 km N | Miner Mk.1 | 50% | 30/min |
| Iron Ore #12 | Normal | 1.9 km W · 1.2 km N | Miner Mk.1 | 50% | 30/min |

Both nodes sit in the same cluster, so the miners are roughly 100 m apart and
each one belts straight into its own smelter.

### Why 50% and not 100%

Ore demand is fixed at 60/min by the tier's output targets, and there are three
ways to get there on a Mk1 belt:

- **Pure node (#1, 1.5 km W · 0.5 km N) at 100%:** 120/min on paper, but a miner
  feeds one belt, so 60/min is all that can leave the port at Mk1 — splitting
  afterwards only divides what already got through. Half the clock would be
  wasted, and even the deliverable 60/min is three times what this tier eats.
  Rejected.
- **Two Normal nodes at 100%:** 60/min each, which is exactly the Mk1 cap on both
  belts, and 60/min of ore backs up behind smelters that can't take it. Rejected.
- **Two Normal nodes at 50%:** 30/min each, one belt per miner, one smelter per
  belt, every segment at half the cap. Chosen.

## Production

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Iron Ingot | Iron Ingot | 2× Smelter | 100% | 60/min |
| Iron Plate | Iron Plate | 1× Constructor | 100% | 20/min ✱ |
| Iron Rod | Iron Rod | 2× Constructor | 100% | 30/min (20/min ✱ + 10/min internal) |
| Screws | Screw | 1× Constructor | 100% | 40/min ✱ |

✱ = tier objective output.

Reinforced Iron Plate is not here. It needs an Assembler, which is Tier 2.

## Layout

Foundations are 8×8 m. Miners sit on their nodes off the foundation grid.

```
        col 1          col 2      col 3          col 4         col 5
row 1   [Miner A]  ──30 Ore──▶  [Smelter 1] ──30 Ingot──▶  [Constr P]  ──20 Plate──▶ out
row 2                                                       (Iron Plate)
row 3   [Miner B]  ──30 Ore──▶  [Smelter 2] ──30 Ingot──▶  [Split S1]
row 4                                              ┌──15 Ingot──▶ [Constr R1] ──15 Rod──┐
row 5                                              └──15 Ingot──▶ [Constr R2] ──15 Rod──┤
row 6                                                                      [Merge M1] ◀─┘
row 7                                              [Split S2] ◀──30 Rod── [Merge M1]
row 8                                    ┌──10 Rod──▶ [Constr S] ──40 Screws──▶ out
row 9                                    └──20 Rod──▶ out
row 10  [Biomass Burner ×1]
```

Machine footprints: Miner Mk.1 6×14 m, Smelter 6×9 m, Constructor 8×10 m,
Biomass Burner 8×8 m. The whole plant fits in roughly 5×10 foundations
(40 m × 80 m).

## Belt segments

Every segment is Mk1, cap 60/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Miner A → Smelter 1 | Iron Ore | 30/min | 30 |
| 2 | Miner B → Smelter 2 | Iron Ore | 30/min | 30 |
| 3 | Smelter 1 → Constr P | Iron Ingot | 30/min | 30 |
| 4 | Smelter 2 → Split S1 | Iron Ingot | 30/min | 30 |
| 5 | Split S1 → Constr R1 | Iron Ingot | 15/min | 45 |
| 6 | Split S1 → Constr R2 | Iron Ingot | 15/min | 45 |
| 7 | Constr R1 → Merge M1 | Iron Rod | 15/min | 45 |
| 8 | Constr R2 → Merge M1 | Iron Rod | 15/min | 45 |
| 9 | Merge M1 → Split S2 | Iron Rod | 30/min | 30 |
| 10 | Split S2 → Constr S | Iron Rod | 10/min | 50 |
| 11 | Split S2 → output | Iron Rod | 20/min | 40 |
| 12 | Constr P → output | Iron Plate | 20/min | 40 |
| 13 | Constr S → output | Screws | 40/min | 20 |

Busiest segment is 40/min. Nothing needs a parallel run at this tier.

## Power

| | MW |
| --- | --- |
| 6 production machines (app figure) | 24.0 |
| 2× Miner Mk.1 @ 50% (not modelled by the app) | ~4.0 |
| **Draw** | **~28.0** |
| 1× Biomass Burner @ 100% | 30.0 |
| **Balance** | **+2.0** |

The app reports +6.0 MW because its power model leaves extractors out entirely.
Either way the factory is positive.

Fuel: Biomass 4.00/min, hand-fed. Nothing produces it; see the run notes.

---

# Iron Works — Tier 2 delta

Tier 2 turns Iron Works from a six-machine starter plant into the run's engine
room: **36 machines · 213.2 MW**, feeding its own milestones plus Elevator Yard.

## What changed

| | Tier 0 | Tier 2 |
| --- | --- | --- |
| Machines | 6 | 36 |
| Draw | ~28 MW | 213.2 MW |
| Generators | 1× Biomass Burner | 8× Biomass Burner |
| Ore claimed | 60/min | 288/min |
| Belts | Mk1, 60/min cap | Mk2, 120/min cap |

## New claims

| Node | Purity | Coords | Extractor | Clock | Output |
| --- | --- | --- | --- | --- | --- |
| Iron Ore #13 | Normal | 1.9 km W · 1.1 km N | Miner Mk.1 | 100% | 60/min |
| Iron Ore #9 | Pure | 2.3 km W · 1.2 km N | Miner Mk.1 | 90% | 108/min |

Iron Ore #6 and #12 both went from 50% to 100% (30 → 60/min each). Total 288/min
against a demand of 280.9/min.

**Why the Pure node runs at 90%, not 100%.** A Mk.1 on Pure at full clock is
120/min, which is exactly the Mk2 belt cap and leaves no headroom at all. 90%
gives 108/min on one belt with 12/min to spare, and 3×60 + 108 = 288 still
clears the 280.9 the plan needs. #13 sits in the same cluster as #6 and #12, so
three of the four miners are within ~100 m of the plant; the Pure node is a
400 m Mk2 run in from the west.

## Production

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Iron Ingot | Iron Ingot | 10× Smelter | 94% | 280.9/min |
| Iron Plate | Iron Plate | 3× Constructor | 94% | 56.6/min (20 ✱ + 36.6 internal) |
| Wire | Alternate: Iron Wire | 4× Constructor | 81% | 73.3/min (all internal) |
| Screws | Alternate: Cast Screws | 6× Constructor | 88% | 265/min (40 ✱ + 225 internal) |
| Iron Rod | Iron Rod | 6× Constructor | 99% | 89/min (20 ✱ + 69 internal) |
| Reinforced Iron Plate | Alternate: Stitched Iron Plate | 2× Assembler | 98% | 11/min (5 exported + 6 internal) |
| Rotor | Rotor | 3× Assembler | 75% | 9/min (4 ✱ + 5 exported) |
| Modular Frame | Modular Frame | 2× Assembler | 100% | 4/min ✱ |

✱ = tier objective output.

Three of the seven alts unlocked at T2 earn their place here. Iron Wire keeps the
Reinforced Iron Plate line entirely on iron, so no copper gets belted in from
Copper Works at all. Stitched Iron Plate then buys RIP with plate and wire instead
of plate and screws, and Cast Screws makes the 265/min of screws the Rotor line
eats from 66 rod/min rather than triple that.

## Exports

| Item | Rate | To | Transport |
| --- | --- | --- | --- |
| Reinforced Iron Plate | 5/min | Elevator Yard | 1× Mk2 belt, 297 m |
| Rotor | 5/min | Elevator Yard | 1× Mk2 belt, 297 m |

## Belt segments

Every segment is Mk2, cap 120/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Miner #6 → Smelter bank | Iron Ore | 60/min | 60 |
| 2 | Miner #12 → Smelter bank | Iron Ore | 60/min | 60 |
| 3 | Miner #13 → Smelter bank | Iron Ore | 60/min | 60 |
| 4 | Miner #9 (Pure) → Smelter bank | Iron Ore | 108/min | 12 |
| 5 | Smelter bank → Iron Plate | Iron Ingot | 85.0/min | 35 |
| 6 | Smelter bank → Wire | Iron Ingot | 40.7/min | 79 |
| 7 | Smelter bank → Screws | Iron Ingot | 66.3/min | 54 |
| 8 | Smelter bank → Iron Rod | Iron Ingot | 89.0/min | 31 |
| 9 | Iron Plate → RIP | Iron Plate | 36.6/min | 83 |
| 10 | Iron Plate → output | Iron Plate | 20/min | 100 |
| 11 | Wire → RIP | Wire | 73.3/min | 47 |
| 12 | **Screws → Rotor (a)** | Screws | **112.5/min** | 7.5 |
| 13 | **Screws → Rotor (b)** | Screws | **112.5/min** | 7.5 |
| 14 | Screws → output | Screws | 40/min | 80 |
| 15 | Iron Rod → Rotor | Iron Rod | 45/min | 75 |
| 16 | Iron Rod → Modular Frame | Iron Rod | 24/min | 96 |
| 17 | Iron Rod → output | Iron Rod | 20/min | 100 |
| 18 | RIP → Modular Frame | Reinforced Iron Plate | 6/min | 114 |
| 19 | RIP → Elevator Yard | Reinforced Iron Plate | 5/min | 115 |
| 20 | Rotor → Elevator Yard | Rotor | 5/min | 115 |

**The one segment that needs splitting is Screws → Rotor.** The plan graph draws
it as a single 225/min edge, which is nearly double the Mk2 cap. On the ground
it's a splitter at the screw bank feeding two parallel Mk2 belts at 112.5/min
each, merging into the three Rotor Assemblers. The app doesn't warn about this;
the edge label is the only clue you get.

The ore feed is the same story in reverse. The graph shows one 280.9/min edge into
the smelter bank, but that's four separate miner belts, none over 108/min.

## Power

| | MW |
| --- | --- |
| 36 production machines | 193.9 |
| 4× Miner Mk.1 (3 @ 100%, 1 @ 90%) | 19.3 |
| **Draw** | **213.2** |
| 8× Biomass Burner @ 100% | 240.0 |
| **Balance** | **+26.8** |

Fuel: Biomass 32.00/min, hand-fed across eight burners.

Eight burners is an absurd amount of hand-feeding, and it's the honest Tier 2
answer for a 213 MW plant on the only generator the tier offers. It's exactly the
pressure that makes coal the first thing you want at Tier 3.

The plan graph header reports the full 213.2 MW. The factory's card on the map
reports 193.9 MW for the same 36 machines, because that one surface still leaves
extractors out. Reported separately.

---

# Iron Works — Tier 3–4 delta

**Belts upgraded Mk2 → Mk3 (270/min).** Miner Mk.1 → Mk.2 on the busiest claim.
36 machines → **56 machines · 408.1 MW**.

## Claims — changed

| Node | Was | Now | Why |
| --- | --- | --- | --- |
| Iron Ore Pure #9 · 2.3 km W · 1.2 km N | Mk.1 @ 90% · 108/min | **Mk.2 @ 90% · 216/min** | Tier objective: the busiest claim goes to Mk.2 |
| Iron Ore Normal #12 · 1.9 km W · 1.2 km N | Mk.1 @ 100% · 60/min | **released** | Mk.2 on #9 covers it |
| Iron Ore Normal #13 · 1.9 km W · 1.1 km N | Mk.1 @ 100% · 60/min | **released** | as above |
| Copper Ore Normal #8 · 1.7 km W · 1.3 km N | — | **Mk.1 @ 100% · 60/min** | new: Iron Alloy Ingot needs it |

Iron feed goes from four Mk.1 miners at 288/min to two miners at 276/min for a
plan that draws 234.4/min. Two fewer miners, two fewer belt runs, and the busiest
line is on Mk.2 as the tier asks.

The copper claim is new. With the Tier 3–4 alts unlocked the optimizer swapped
Iron Ingot for **Alternate: Iron Alloy Ingot** (40 iron ore + 10 copper ore → 75
iron ingot), which is why an iron plant now mines copper. The node is 220 m away,
so it's a short belt rather than a haul.

## Production — changed

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Iron Ingot | **Alternate: Iron Alloy Ingot** | 6× Foundry | 98% | 439.5/min |
| Wire | **Alternate: Iron Wire** | 6× Constructor | 97% | 131.5/min |
| Iron Plate | Iron Plate | 5× Constructor | 86% | 85.8/min (20 free) |
| Reinforced Iron Plate | Alternate: Stitched Iron Plate | 4× Assembler | 88% | 19.8/min (10 free) |
| Iron Rod | Iron Rod | 16× Constructor | 99% | 237.8/min (20 free) |
| Screws | Screws | 11× Constructor | 94% | 415/min (40 free) |
| Modular Frame | Modular Frame | 4× Assembler | 81% | 6.5/min |
| Rotor | Rotor | 4× Assembler | 94% | 15/min |

Ingots moved from Smelters to Foundries because Iron Alloy Ingot is a Foundry
recipe. Wire is now made here from iron rather than bought from Copper Works,
which is the alt doing its job — Copper Works' wire all goes to Motor Works.

## Exports — changed

| Item | Rate | To | Distance (map) |
| --- | --- | --- | --- |
| Reinforced Iron Plate | 5/min | Elevator Yard | 297 m |
| Rotor | 5/min | Elevator Yard | 297 m |
| Rotor | 5/min | Motor Works | 613 m |
| Modular Frame | 2.5/min | Elevator Yard | 297 m |

Rotor is planned at 15/min and Reinforced Iron Plate at 10/min against real demand
of 10/min and 5/min. The extra 5/min of each is dead output forced by duplicate
logistics links the app created and won't let you delete — see the tier report.

## Belt segments — the three that need splitting

Mk3 caps at 270/min and three lines are over it.

| From → To | Carries | Rate | Plan |
| --- | --- | --- | --- |
| Foundry bank → splits | Iron Ingot | 439.5/min | 2× Mk3 @ 219.8 each |
| Screw bank → out + Rotor | Screws | 415/min | 2× Mk3 @ 207.5 each |
| Screws → Rotor Assemblers | Screws | 375/min | 2× Mk3 @ 187.5 each |

Everything else fits one Mk3: Iron Rod 237.8, Wire 131.5, Iron Plate 85.8,
Iron Ore 234.4 (across two miner belts), Copper Ore 58.6.

The Tier 2 workaround is gone: the Screws → Rotor split that needed two Mk2 belts
at 112.5/min each is now two Mk3 belts, and every other segment that used to need
a parallel run is a single belt.

## Power — changed

| | MW |
| --- | --- |
| 56 machines + 3 extractors | 408.1 |
| **Draw** | **408.1** |
| 8× Biomass Burner @ 100% | 240.0 |
| **Balance** | **−168.1** |

The deficit is deliberate: from Tier 3 the grid is shared and Coal Power Station
carries it. The eight Biomass Burners are legacy and no longer load-bearing.
