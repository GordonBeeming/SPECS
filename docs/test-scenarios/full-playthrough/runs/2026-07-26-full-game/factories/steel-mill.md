# Steel Mill — Tier 3–4 (new)

**Site:** Grass Fields west, 1.30 km W / 0.75 km N
**Built at:** Tier 4 · Mk3 belts (270/min cap) · Miner Mk.1 and Mk.2

The site is the reason this factory exists where it does. Three Pure coal nodes
sit at 1.1 km W / 0.4–0.5 km N and three Pure iron nodes at 1.5–1.7 km W /
0.3–0.5 km N, about 500 m apart, so a plant dropped between them belts both raws
in under 450 m and never hauls ore across the map. The app's own distance
readouts back the placement up: 250 m to Motor Works, 449 m to Elevator Yard,
734 m to Iron Works, 792 m to Copper Works.

## Claims

| Node | Purity | Position | Extractor | Clock | Yield | Haul |
| --- | --- | --- | --- | --- | --- | --- |
| Coal #1 | Pure | 1.1 km W · 0.4 km N | Miner Mk.2 | 80% | 192/min | 403 m |
| Iron Ore #1 | Pure | 1.5 km W · 0.5 km N | Miner Mk.1 | 100% | 120/min | 320 m |
| Copper Ore #2 | Pure | 1.5 km W · 0.3 km N | Miner Mk.1 | 25% | 30/min | 492 m |

Coal is the first Miner Mk.2 in the run. It has to be: the plan wants
183.2 coal/min and a Pure node on a Mk.1 tops out at 120/min, so a second coal
node and a second belt would be the alternative. Mk.2 at 80% replaces both.

The copper is not a mistake. The optimizer picked **Alternate: Iron Alloy Ingot**
(40 iron ore + 10 copper ore → 75 iron ingot) over the standard smelt, which
turns 97.7 iron ore into what would otherwise take 183, and there happens to be
a Pure copper node 492 m away, so the choice is buildable here.

## Production

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Iron Ingot | Alternate: Iron Alloy Ingot | 3× Foundry | 81% | 183.2/min |
| Steel Ingot | Alternate: Solid Steel Ingot | 5× Foundry | 92% | 274.8/min |
| Steel Beam | Steel Beam | 3× Constructor | 89% | 40/min ✱ |
| Steel Pipe | Steel Pipe | 4× Constructor | 96% | 76.5/min ✱ |
| Encased Industrial Beam | Alternate: Encased Industrial Pipe | 1× Assembler | 100% | 4/min ✱ |

✱ = tier objective output. 16 machines, 162.9 MW including extractors.

Steel Beam and Steel Pipe are both pinned to their standard recipes. Left to
itself the optimizer picked Molded Beam and Molded Steel Pipe, which are far more
ingot-efficient but eat 137 concrete/min, five times what Copper Works can spare.
Pinning the two standard recipes drops concrete demand to the 20/min the Encased
Industrial Pipe alt needs.

## Imports

| Item | Rate | From | Distance (map) | Transport |
| --- | --- | --- | --- | --- |
| Concrete | 20/min | Copper Works | 792 m | 1× Mk3 belt (7% used) |

Concrete comes over the link rather than from a local limestone claim. The
nearest unclaimed limestone is 1.7 km W / 1.3 km N, 800 m away and on the wrong
side of the plant, so importing from a factory that already runs a concrete line
is both shorter and avoids a second Constructor bank.

## Exports

| Item | Rate | To | Distance (map) |
| --- | --- | --- | --- |
| Steel Beam | 30/min | Elevator Yard | 449 m |
| Steel Pipe | 37.5/min | Motor Works | 250 m |

10 Steel Beam/min and 15 Steel Pipe/min stay free for milestone spend.

## Layout

Foundations are 8×8 m. Foundry 10×19 m, Constructor 8×10 m, Assembler 10×15 m.
Ore arrives from the west, concrete from the north.

```
        col 1-2          col 3-4            col 5-6           col 7-8
row 1   ══ Iron 97.7 ═══▶ [Foundry ×3]
row 2   ══ Copper 24.4 ═▶  Iron Alloy Ingot ══ 183.2 ═══▶┐
row 3                                                    │
row 4   ══ Coal 183.2 ═══════════════════════════════════┴▶ [Foundry ×5]
row 5                                                        Solid Steel Ingot
row 6                                                              ║
row 7                                    ┌═════ 160.0 ═════════════╣
row 8                                    ▼                         ║
row 9                            [Constructor ×3]                  ║
row 10                            Steel Beam 40/min ──▶ 10 free    ║
row 11                                              └─ 30 ─▶ Elevator Yard
row 12                                   ┌═════ 114.8 ═════════════┘
row 13                                   ▼
row 14                           [Constructor ×4]
row 15                            Steel Pipe 76.5/min ─┬─ 24 ─▶ [Assembler]
row 16   ══ Concrete 20/min ══════════════════════════─┴──────▶ Encased Ind.
row 17                                                          Beam 4/min
row 18                                             └─ 37.5 ─▶ Motor Works
row 19                                             └─ 15 free
```

About 9×20 foundations (72 m × 160 m) including the miner pads.

## Belt segments

Every segment is Mk3, cap 270/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Coal #1 miner → plant | Coal | 183.2/min | 87 |
| 2 | Iron #1 miner → plant | Iron Ore | 97.7/min | 172 |
| 3 | Copper #2 miner → plant | Copper Ore | 24.4/min | 246 |
| 4 | Iron Alloy bank → Steel Ingot bank | Iron Ingot | 183.2/min | 87 |
| 5 | Steel Ingot bank → Steel Beam bank | Steel Ingot | 160.0/min | 110 |
| 6 | Steel Ingot bank → Steel Pipe bank | Steel Ingot | 114.8/min | 155 |
| 7 | Steel Pipe bank → Assembler | Steel Pipe | 24.0/min | 246 |
| 8 | Copper Works → Assembler | Concrete | 20.0/min | 250 |
| 9 | Steel Beam bank → out | Steel Beam | 40.0/min | 230 |
| 10 | Steel Pipe bank → out | Steel Pipe | 52.5/min | 217 |

The one thing to watch is the Steel Ingot bank: 274.8/min leaves five Foundries
and that is over the 270 cap, so the split to Beam (160) and Pipe (114.8) happens
**at the bank**, on the machine outputs, not after a merge. Merge the five
outputs into one line and it saturates.

## Power

| | MW |
| --- | --- |
| 3× Foundry @ 81% | 36.6 |
| 5× Foundry @ 92% | 71.2 |
| 3× Constructor @ 89% | 10.3 |
| 4× Constructor @ 96% | 15.1 |
| 1× Assembler @ 100% | 15.0 |
| 3× extractor (Mk.2 coal, Mk.1 iron, Mk.1 copper) | 14.8 |
| **Draw** | **162.9** |
| Generators here | none |

Steel Mill has no generators of its own; it runs off the shared grid from Coal
Power Station, 1.0 km east.
