# Caterium Electronics

**Site:** 1.75 km W · 0.85 km N — on the caterium node itself, a short belt from
Iron Works and Steel Mill.
**Tier introduced:** 6 (built at Tier 5–6)

## Claims

| Node | Purity | Extractor | Clock | Output |
| --- | --- | --- | --- | --- |
| Caterium Ore (Pure) · 1.8 km W · 0.8 km N | Pure | Miner Mk.2 | 33.75% | 81 ipm |

81 ipm claimed against 81 ipm demanded. Miner Mk.3 is Tier 8 and the extractor
picker correctly doesn't offer it.

## Production

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Caterium Ingot | 27/min (15 free) | Caterium Ingot | 2× Smelter @ 90% |
| Quickwire | 60/min | Quickwire | 1× Constructor @ 100% |

3 machines, 13.8 MW including the miner.

## Why the standard recipes

The solver's first pass reached for Pure Caterium Ingot (24 ore + 24 water) and
Fused Quickwire (caterium ingot + copper ingot), which would have needed a water
extractor and a copper haul at a site that has neither; the nearest approved
water body is the Grass Fields lakes, 1.4 km away. Both nodes were pinned back
to the standard recipes, which run on caterium alone.

## Belts

| Segment | Rate | Cap at T6 | Lines |
| --- | --- | --- | --- |
| Miner → Smelter bank | 81/min | Mk4 480 | 1 |
| Smelter bank → Constructor | 12/min | Mk4 480 | 1 |
| Smelter bank → out (Caterium Ingot free) | 15/min | Mk4 480 | 1 |

Nothing here is close to the belt cap.

## Skipped

**AI Limiter** belongs to this plant and is deliberately not built: it is a
Tier 7 recipe and this group is Tier 6. The app will happily plan it anyway,
which is reported.

## Power

No generators on site. 13.8 MW drawn from the shared grid.
