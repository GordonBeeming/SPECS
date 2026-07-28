# Coal Power Station — Tier 3–4 (new)

**Site:** Grass Fields lakes, 0.50 km W / 0.50 km N
**Built at:** Tier 4 · Mk3 belts (270/min cap) · Mk1 pipes (300 m³/min cap)

This is the run's first factory that makes nothing. It exists to carry the whole
grid so the twelve hand-fed Biomass Burners inherited from Tiers 0–2 stop being
the thing that keeps the network alive.

The site is one of the approved water bodies, the starter lakes west of the
plains spawn, listed in `constraints.md` at ~0.5 W / 0.5 N. The plant sits on the
lake shore and the extractor bank sits in the lake 280 m south-west of it. Coal
comes off the same Pure field the Steel Mill uses, 600 m west.

## Claims

| Node | Purity | Position | Extractor | Clock | Yield | Haul |
| --- | --- | --- | --- | --- | --- | --- |
| Coal #2 | Pure | 1.1 km W · 0.5 km N | Miner Mk.2 | 87.5% | 210/min | 600 m |

210 coal/min is exactly what fourteen Coal Generators burn. A Pure node on a Mk.1
gives 120/min, so this claim is the second reason the run wanted Miner Mk.2.

## Water

| Group | Position | Extractors | Clock | Output |
| --- | --- | --- | --- | --- |
| Grass Fields lake bank | 0.78 km W · 0.33 km N | 6× Water Extractor | 87.5% | 630 m³/min |

The lake immediately south-west of the plant, inside the Grass Fields lakes
cluster. Six extractors at 87.5% is the exact match for fourteen generators at
45 m³/min each.

**Pipe runs.** Mk1 pipes cap at 300 m³/min, so 630 m³/min cannot ride one header.
The bank splits into **three parallel Mk1 headers at 210 m³/min each**, one per
group of five generators (the third feeds four). Fluids never ride belts, and
there is no Mk2 pipe until Tier 6.

The app does not enforce this. It will happily show a 630 m³/min demand against
one water group and say nothing about the 300 m³/min cap. The three-header split
is a plan decision, not something the app derived.

## Production

None. 0 machines.

## Generation

| Generator | Fuel | Count | Clock | Output |
| --- | --- | --- | --- | --- |
| Coal Generator | Coal | 14 | 100% | 1050 MW |

Fuel demand: **Coal 210.00/min · Water 630.00 m³/min**, both read straight off the
Power view.

## Layout

Foundations are 8×8 m. Coal Generator 10×26 m, Water Extractor 20×20 m on water.

```
                lake (Grass Fields)                      shore              plant
row 1    [WaterEx][WaterEx][WaterEx]  ══ header A 210 m³/min ═══▶ [Gen ×5]
row 2                                                              │
row 3    [WaterEx][WaterEx][WaterEx]  ══ header B 210 m³/min ═══▶ [Gen ×5]
row 4                                                              │
row 5                                 ══ header C 210 m³/min ═══▶ [Gen ×4]
row 6
row 7    ══ Coal 210/min (1× Mk3, 78% used) ══════════════════════▶ manifold
row 8       from Coal #2, 600 m west
```

Fourteen generators in three rows of 5 / 5 / 4, each row fed by its own pipe
header off the six-extractor bank. The coal manifold runs the length of the
bank on one Mk3 belt.

About 12×14 foundations (96 m × 112 m) for the generator hall, plus the extractor
bank on the water.

## Belt and pipe segments

| # | From → To | Carries | Rate | Cap | Headroom |
| --- | --- | --- | --- | --- | --- |
| 1 | Coal #2 miner → generator manifold | Coal | 210/min | Mk3 270 | 60 |
| 2 | Extractor bank → Gen row 1 | Water | 210 m³/min | Mk1 pipe 300 | 90 |
| 3 | Extractor bank → Gen row 2 | Water | 210 m³/min | Mk1 pipe 300 | 90 |
| 4 | Extractor bank → Gen row 3 | Water | 210 m³/min | Mk1 pipe 300 | 90 |

## Power

| | MW |
| --- | --- |
| 6× Water Extractor @ 87.5% | 100.6 |
| 1× Miner Mk.2 @ 87.5% | 10.1 |
| **Draw** | **110.6** |
| 14× Coal Generator @ 100% | 1050.0 |
| **Balance** | **+939.4** |

The plant pays about 10.5% of its own output to pump the water it burns, which is
the honest cost of coal power and the reason the extractor bank is clocked to
match rather than left at 100%.
