# Tiers 1–2 — assembly and Phase 1

Set the playthrough tier to 2 on entry, then unlock every alt at or below
T2 on the Alts screen. Tier 1 is Field Research (MAM territory — no new
standard production recipes in the dataset); Tier 2 brings the Assembler,
Mk2 belts, and the first space elevator part.

## Unlocks (per library data)

- **Buildings:** Assembler (T2)
- **Belts:** Mk2 — 120/min (T2)
- **Recipes (T2):** Copper Sheet, Rotor, Modular Frame, Smart Plating,
  Solid Biofuel
- **Alts:** unlock everything with `unlock_tier <= 2` (the Alts screen
  lists them; expect the early iron/copper/screw families)

## Build objectives

1. **Iron Works upgrade** — Mk2 belts where segments were doubled up;
   add Modular Frame line (4/min) and Rotor line (4/min — needs screws,
   pull from the existing line and show the belt split).
2. **Elevator Yard** (new factory, near Iron Works) — Smart Plating at
   5/min for Space Elevator **Phase 1 (Smart Plating × 50)**. Import
   Reinforced Iron Plate and Rotor from Iron Works over a logistics link —
   this is the run's first cross-factory pull; the link's transport plan
   must be belt-viable at Mk2.
3. **Copper Works upgrade** — Copper Sheet line (10/min).

## Logistics notes

- Mk2 belts cap at 120/min. The Pure-node problem from Tier 0 eases but
  doesn't vanish — a Mk.1 miner at 250% on Pure is 300/min and still needs
  three belts.
- First logistics links appear here. Check the link planner offers a sane
  belt plan for the Iron Works → Elevator Yard distance; if it suggests
  something absurd, bug report.

## Checkpoint

- [ ] Phase 1 deliverable planned: Smart Plating at the stated rate
- [ ] The Iron Works → Elevator Yard link exists with a belt transport plan
- [ ] Validate playthrough → zero errors (warnings explained in the
      run artifact)
- [ ] No belt segment over 120/min in the layouts
- [ ] Layout artifacts: Elevator Yard (new), Iron Works + Copper Works
      (deltas only)
- [ ] Screenshots: alts screen post-unlock, elevator yard plan graph,
      validation panel
