# Oil Refinery

**Site:** 0.30 km E · 2.08 km N — the Northern Forest oil field on the Spire
Coast side, placed by clicking the map between the two seeps it drinks from.
**Tier introduced:** 6 (built at Tier 5–6)

## Claims

| Node | Purity | Extractor | Clock | Output |
| --- | --- | --- | --- | --- |
| Crude Oil #11 · 0.5 km E · 2.0 km N | Normal | Oil Extractor | 88% | 106 m³/min |
| Crude Oil #8 · 0.4 km E · 2.3 km N | Pure | Oil Extractor | 62.88% | 151 m³/min |

Total 257 m³/min claimed against 256.5 m³/min demanded. Oil seeps take exactly
one Oil Extractor each, so purity × clock is the only lever; there are no miner
marks to pick from.

## Production

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Plastic | 136/min | Plastic (standard) | 7× Refinery @ 97% |
| Rubber | 35/min | Rubber (standard) | 2× Refinery @ 75% |
| Fuel | 65/min | Residual Fuel | 2× Refinery @ 81% |
| Petroleum Coke | 1.5/min | Petroleum Coke | 1× Refinery @ 1% |

12 machines, 342.8 MW of process draw plus 2 Oil Extractors.

## Byproduct handling

Standard Plastic and Rubber both dump Heavy Oil Residue: 68 m³/min from the
plastic bank and 35 m³/min from the rubber bank, 103 m³/min in total. 97.5 of
that goes into Residual Fuel and comes back out as the 65/min Fuel the power
block burns. The 0.5 m³/min that doesn't divide evenly is turned into 1.5
Petroleum Coke/min and sunk — the plan graph shows it as an explicit
`BYPRODUCT → SINK` node. Nothing is left with nowhere to go.

## Power

4× Fuel Generator @ 81.2% = **812 MW**, burning 64.96 m³/min of the plant's own
65/min Fuel. Net for the site is +469 MW into the shared grid.

## Pipes

Crude oil is the only fluid leaving a node here. Mk2 pipes carry 600 m³/min at
Tier 6, so each extractor's run (106 and 151 m³/min) is a single pipe, and the
combined 257 m³/min header into the refinery bank is also one pipe.

Fuel from the refinery bank to the generator row is 65 m³/min — one pipe.

## Exports

| Item | Rate | To | Distance | Transport |
| --- | --- | --- | --- | --- |
| Plastic | 136/min | Computer Plant | 1,242 m | 1× Mk4 belt (28% used) |
| Rubber | 35/min | Elevator Yard | 2,133 m | 1× Mk4 belt (7% used) |

Both hauls are long, since this is the tier group where the map stops being one
cluster, and the link planner ranks belts, trucks and drones for them with the
above-tier options locked.
