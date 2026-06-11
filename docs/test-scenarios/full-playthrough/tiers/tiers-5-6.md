# Tiers 5–6 — oil, caterium, and Phase 3

Set tier to 6 on entry; unlock alts ≤ T6. Oil processing is the heart of
this group — plastic, rubber, and fuel power — plus caterium electronics
and the Manufacturer for the big four-input parts.

## Unlocks (per library data)

- **Buildings:** Refinery, Packager, Oil Extractor (T5); Manufacturer (T6)
- **Belts/pipes:** Mk4 belts — 480/min (T5); Mk2 pipes — 600 m³/min (T6)
- **Recipes:** T5 — Plastic, Rubber, Fuel + residual chain, Petroleum
  Coke, Circuit Board, Caterium Ingot, Quickwire, packaged fluids; T6 —
  Computer, Heavy Modular Frame, Modular Engine, Adaptive Control Unit
- **Power:** fuel generators

## Build objectives

1. **Oil Refinery** (new, at an oil field — Gold Coast or the eastern
   spire coast; oil seeps take exactly one Oil Extractor each, purity ×
   clock only) — Plastic 40/min, Rubber 30/min, residual fuel into a fuel
   power block. Byproduct handling must be explicit: heavy oil residue is
   consumed or sunk, never orphaned (the planner's fluid-surplus warnings
   must be clear on the saved plans).
2. **Caterium Electronics** (new, near a caterium node) — Caterium Ingot
   15/min, Quickwire 60/min, AI Limiter waits for T7 (it's tier-gated —
   confirm the app gates it; if it's offered early, bug report).
3. **Computer Plant** (extend Copper Works or new) — Circuit Board 10/min,
   Computer 2.5/min via Manufacturer. Plastic via link from the refinery.
4. **Elevator Yard** — Modular Engine 1/min and Adaptive Control Unit
   1/min for **Phase 3 (Versatile Framework + Modular Engine + Adaptive
   Control Unit)**; motors and plates via links.
5. **Fuel power block** — fuel generators on refinery fuel; restate the
   grid totals.

## Logistics notes

- Crude oil and fuel move by Mk1/Mk2 pipe; watch the 300/600 caps around
  big refinery banks.
- This group usually triggers the first long-haul links (oil coast →
  inland). If belts rank as the planner's best option over multi-km
  distances, sanity-check against trucks/trains and bug-report weird
  rankings.

## Checkpoint

- [ ] Phase 3 parts planned at stated rates, imports wired
- [ ] No orphaned byproducts on any saved plan
- [ ] Validate playthrough → zero errors (this covers the oil-extractor
      claims and the grid with fuel power online; restate both in the
      artifact)
- [ ] Belt ≤ 480/min, pipe ≤ 600 m³/min everywhere
- [ ] Layouts + screenshots (refinery plan graph with byproduct edges,
      validation panel)
