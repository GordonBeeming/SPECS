# Tier 0 — onboarding

The starter kit. Everything runs on Mk1 belts (60/min) and Miner Mk.1s, and
power comes from biomass burners fed by hand — so keep factories small and
close to their nodes.

## Unlocks (per library data)

- **Buildings:** Smelter, Constructor, Miner Mk.1
- **Belts:** Mk1 — 60/min. No pipes, no fluids yet.
- **Recipes:** Iron Ingot, Iron Plate, Iron Rod, Screws, Reinforced Iron
  Plate, Copper Ingot, Wire, Cable, Concrete, Biomass (Leaves/Wood)
- **Power:** biomass burners only (manual feed — note generator counts but
  don't over-engineer)

## Build objectives

Two starter factories in the Grass Fields area, each on its own claimed
nodes:

1. **Iron Works** — claim 2 iron nodes (Mk.1, 100%). Lines: Iron Ingot →
   Iron Plate (20/min), Iron Rod (20/min), Screws (40/min), Reinforced Iron
   Plate (5/min).
2. **Copper Works** — claim 1 copper node + 1 limestone node. Lines: Wire
   (30/min), Cable (15/min), Concrete (15/min).

Watch the belt math: a Pure iron node on a Mk.1 at 100% already saturates a
Mk1 belt (120/min > 60/min cap). Either underclock, split the output onto
two belts at the miner, or claim Normal nodes. The layout must show the
choice.

## Logistics notes

- Everything single-belt Mk1. Any line needing >60/min of one item must show
  parallel belts and the merge points.
- No cross-factory links yet — both factories are self-contained.

## Checkpoint

- [ ] Both factories' ledgers show no missing inputs
- [ ] No belt segment over 60/min in the layouts
- [ ] Power balance ≥ 0 in both factories
- [ ] Layout artifacts written for both factories; screenshots of each
      factory's plan graph and the map with claims
- [ ] Bugs filed for anything that fought back
