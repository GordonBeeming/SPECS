# Tiers 7–8 — aluminum, nuclear, and Phase 4

Set tier to 8 on entry; unlock alts ≤ T8. The heavy group: the aluminum
chain with its water recycling, quartz electronics, then nuclear power and
the first resource wells. Expect this group to stress the planner's
byproduct netting harder than anything before it.

## Unlocks (per library data)

- **Buildings:** Blender (T7); Miner Mk.3, Particle Accelerator, Resource
  Well Pressuriser + Extractor (T8)
- **Belts:** Mk5 — 780/min (T7)
- **Recipes:** T7 — alumina/aluminum chain, sulfuric acid, Battery, Quartz
  Crystal, Silica, Crystal Oscillator, AI Limiter, High-Speed Connector,
  Radio Control Unit, Supercomputer, Rocket Fuel; T8 — nitric acid,
  nitrogen-based parts, Cooling System, Fused Modular Frame, Turbo Motor,
  uranium + plutonium chains, Nuclear Pasta, Magnetic Field Generator,
  Thermal Propulsion Rocket, Reanimated SAM, SAM Fluctuator
- **Power:** nuclear (T8)

## Build objectives

1. **Aluminum Plant** (new, at a bauxite claim) — Aluminum Ingot 60/min
   feeding Alclad Sheet 30/min and Casing 40/min. The recycled-water loop
   must show as reuse edges on the plan; silica byproduct consumed or
   sunk. This is the canonical optimizer check — compare machine counts
   against satisfactorytools and bug-report drift.
2. **Quartz Electronics** (extend Caterium Electronics) — Quartz Crystal
   22.5/min, Silica 37.5/min, Crystal Oscillator 1/min, AI Limiter 5/min,
   High-Speed Connector 2/min, Radio Control Unit 1/min, Supercomputer
   0.75/min.
3. **Battery Line** (Aluminum Plant annex) — sulfuric acid → Battery
   15/min.
4. **Nitrogen Wells** — claim a nitrogen resource well (pressuriser +
   satellites; each satellite is its own claim at 30/60/120 by purity);
   Cooling System 5/min, Fused Modular Frame 1.5/min at the Aluminum
   Plant.
5. **Nuclear Power** (new, uranium claim + lake water) — Encased Uranium
   Cell 10/min, Uranium Fuel Rod 0.4/min, nuclear generators; plutonium
   reprocessing for **waste handling stated explicitly** (sink path or
   storage note).
6. **Elevator Yard** — **Phase 4: Assembly Director System + Magnetic
   Field Generator + Nuclear Pasta + Thermal Propulsion Rocket**, each at
   ≥ 0.5/min equivalents, imports wired. Particle Accelerator power spikes
   noted in the power artifact.
7. **Miner Mk.3 upgrades** — re-claim the bottleneck nodes; Mk5 belts
   where the upgrade pushes a segment past 480.

## Logistics notes

- A Mk.3 miner at 250% on a Pure node is 1200/min — over even Mk5's 780.
  Belt math at the miner mouth gets real; show the splits.
- Resource wells: the pressuriser is the clocked building; satellites
  carry purity. The app's claims are per-satellite — verify the totals
  match pressuriser × satellites and bug-report mismatches.

## Checkpoint

- [ ] Phase 4 parts planned at stated rates
- [ ] Aluminum water loop closed (reuse edges, no fluid surplus warnings
      left unexplained)
- [ ] Validate playthrough → no findings (covers the per-satellite well
      claims, supply, the grid with nuclear online, and any tier
      slippage); waste path stated in the artifact
- [ ] Belt ≤ 780/min, pipes ≤ 600 m³/min
- [ ] Layouts + screenshots (aluminum plan with reuse edges, power view,
      validation panel)
