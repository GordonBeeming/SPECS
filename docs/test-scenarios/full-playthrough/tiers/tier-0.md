# Tier 0 — onboarding

The starter kit. Everything runs on Mk1 belts (60/min) and Miner Mk.1s, and
power comes from biomass burners fed by hand — so keep factories small and
close to their nodes.

## Unlocks (per library data)

- **Buildings:** Smelter, Constructor, Miner Mk.1
- **Belts:** Mk1 — 60/min. No pipes, no fluids yet.
- **Recipes:** Iron Ingot, Iron Plate, Iron Rod, Screws, Copper Ingot, Wire,
  Cable, Concrete, Biomass (Leaves/Wood). Reinforced Iron Plate is *not* here
  — it needs an Assembler, which is Tier 2, so a Tier 0 factory can't automate
  it however much iron you have.
- **Power:** biomass burners only (manual feed — note generator counts but
  don't over-engineer)

## Build objectives

Two starter factories in the Grass Fields area, each on its own claimed
nodes:

1. **Iron Works** — claim 2 iron nodes (Mk.1, 100%). Lines: Iron Ingot →
   Iron Plate (20/min), Iron Rod (20/min), Screws (40/min). Reinforced Iron
   Plate waits for the Assembler in Tiers 1–2.
2. **Copper Works** — claim 1 copper node + 1 limestone node. Lines: Wire
   (30/min), Cable (15/min), Concrete (15/min).

Watch the belt math: a Pure iron node on a Mk.1 at 100% produces 120/min, but
a miner feeds one belt, so only 60/min can leave it at Mk1. A splitter doesn't
rescue this — it can only divide what already came through the port. Either
underclock to 50% or claim Normal nodes. The layout must show the choice.

## Logistics notes

- Everything single-belt Mk1. Any line needing >60/min of one item must show
  parallel belts and the merge points.
- No cross-factory links yet — both factories are self-contained.

## Checkpoint

- [ ] Validate playthrough → no findings (anything you cannot clear gets an
      issue and an artifact note)
- [ ] No belt segment over 60/min in the layouts
- [ ] Layout artifacts written for both factories; screenshots of each
      factory's plan graph, the map with claims, and the validation
      panel
- [ ] Issues filed for anything that fought back, `hesitations.md` emptied
