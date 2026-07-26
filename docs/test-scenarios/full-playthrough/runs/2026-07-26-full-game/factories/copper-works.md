# Copper Works — Tier 0

**Site:** Grass Fields — roughly 0.95 km W / 1.45 km N, between the two nodes
**Built at:** Tier 0 · Mk1 belts only (60/min cap) · Miner Mk.1 only

## Claims

| Node | Purity | Coords | Extractor | Clock | Output |
| --- | --- | --- | --- | --- | --- |
| Copper Ore #3 | Normal | 1.0 km W · 1.4 km N | Miner Mk.1 | 50% | 30/min |
| Limestone #6 | Normal | 0.9 km W · 1.5 km N | Miner Mk.1 | 75% | 45/min |

The two nodes are about 140 m apart, so one plant sits between them and belts
both feeds in directly.

Clocks are picked to land exactly on demand rather than to run the miners flat
out: copper needs 30/min against a Normal node's 60/min at full clock, and
limestone needs 45/min, which is 75% of 60.

## Production

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Copper Ingot | Copper Ingot | 1× Smelter | 100% | 30/min |
| Wire | Wire | 2× Constructor | 100% | 60/min (30/min ✱ + 30/min internal) |
| Cable | Cable | 1× Constructor | 50% | 15/min ✱ |
| Concrete | Concrete | 1× Constructor | 100% | 15/min ✱ |

✱ = tier objective output.

The two Wire constructors split cleanly: one feeds Cable, the other feeds the
export. No merger is needed anywhere in this plant.

## Layout

Foundations are 8×8 m. Miners sit on their nodes off the foundation grid.

```
        col 1              col 2         col 3           col 4          col 5
row 1   [Cu Miner] ──30 Ore──▶ [Smelter] ──30 Ingot──▶ [Split S1]
row 2                                        ┌──15 Ingot──▶ [Constr W1] ──30 Wire──▶ [Constr C] ──15 Cable──▶ out
row 3                                        └──15 Ingot──▶ [Constr W2] ──30 Wire──▶ out
row 4
row 5   [LS Miner] ──45 Limestone──────────▶ [Constr Cn] ──15 Concrete──▶ out
row 6
row 7   [Biomass Burner ×1]
```

Machine footprints: Miner Mk.1 6×14 m, Smelter 6×9 m, Constructor 8×10 m,
Biomass Burner 8×8 m. The plant fits in roughly 5×7 foundations (40 m × 56 m).

## Belt segments

Every segment is Mk1, cap 60/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Cu Miner → Smelter | Copper Ore | 30/min | 30 |
| 2 | Smelter → Split S1 | Copper Ingot | 30/min | 30 |
| 3 | Split S1 → Constr W1 | Copper Ingot | 15/min | 45 |
| 4 | Split S1 → Constr W2 | Copper Ingot | 15/min | 45 |
| 5 | Constr W1 → Constr C | Wire | 30/min | 30 |
| 6 | Constr W2 → output | Wire | 30/min | 30 |
| 7 | Constr C → output | Cable | 15/min | 45 |
| 8 | LS Miner → Constr Cn | Limestone | 45/min | 15 |
| 9 | Constr Cn → output | Concrete | 15/min | 45 |

Busiest segment is the limestone feed at 45/min. Nothing needs a parallel run.

## Power

| | MW |
| --- | --- |
| 5 production machines (Power view figure) | 17.6 |
| 2× Miner Mk.1 @ 50% and 75% (not modelled by the app) | ~5.4 |
| **Draw** | **~23.0** |
| 1× Biomass Burner @ 100% | 30.0 |
| **Balance** | **+7.0** |

The plan graph reports 17.0 MW for the same five machines because it squares the
clock instead of raising it to 1.321928, so the Cable constructor at 50% comes
out as 1.0 MW there and 1.6 MW in the Power view. That's issue #45; the Power
view figure is the correct one.

Fuel: Biomass 4.00/min, hand-fed. Nothing produces it; see the run notes.
