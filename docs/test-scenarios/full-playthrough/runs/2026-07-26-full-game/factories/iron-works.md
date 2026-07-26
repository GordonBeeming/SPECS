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

- **Pure node (#1, 1.5 km W · 0.5 km N) at 100%:** 120/min, double the belt cap.
  It needs the miner output split onto two parallel Mk1 belts running at 60/min
  each with zero headroom, four smelters instead of two, and it makes three times
  the ore this tier can eat. Rejected.
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
