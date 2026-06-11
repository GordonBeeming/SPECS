# Constraints — the rulebook

Every plan the run produces must be buildable in the actual game at the tier
it's planned in. These rules are how the run stays honest.

## Source of truth

The app's own library data (belt tiers, pipe tiers, recipe unlock tiers,
extractor options per node, machine specs) governs the run. Don't import
numbers from the wiki or memory into a plan. If you know the game disagrees
with the app, the plan still follows the app and the discrepancy gets a bug
report — the run exists to find exactly those gaps.

## Logistics

- **No belt segment may carry more than the best belt unlocked at the current
  tier.** Per library data: Mk1 60/min at T0, Mk2 120 at T2, Mk3 270 at T4,
  Mk4 480 at T5, Mk5 780 at T7, Mk6 1200 at T9.
- Needing more than one belt's worth is normal — run parallel belts and merge.
  Moving 120/min at Tier 1 means two Mk1 belts into a merger, not one
  imaginary fast belt. Layouts must show the split/merge points.
- Pipes follow the same rule once unlocked (Mk1 300 m³/min at T3, Mk2 600 at
  T6 per library data). Fluids never ride belts.
- Cross-factory transfers use logistics links with a transport plan the app
  ranks as viable (belt, pipe, truck, tractor, drone, train) — and the chosen
  transport must itself be unlocked at the current tier.

## Extraction

- Every claim uses an extractor the node actually accepts — the app's picker
  enforces this (miner marks for ore, Oil Extractor for oil seeps, Resource
  Well Pressuriser for well satellites). If a picker ever offers something
  the game wouldn't allow, that's a bug report.
- Miner marks are tier-gated: Mk.1 at T0, Mk.2 at T4, Mk.3 at T8. Oil
  Extractor at T5; resource wells at T8.
- Clocks range 1–250%, but shards above 100% must be plausible: no
  shard-boosted extractors before Power Shards are producible (T3 MAM-ish),
  and use them sparingly early.
- **Water extractors only go on real water.** Place groups only at named
  water bodies and record which one each group sits on. Approved spots, by
  in-app map coordinates (x km E/W, y km N/S):
  - Grass Fields lakes (~0.5 W, 0.5 N) — the starter lakes west of the
    plains spawn
  - The big lake at Lake Forest (~0.9 E, 0.9 N)
  - Gold Coast shoreline (~2.5 W, 0.5 S) — ocean, effectively unlimited
  - Dune Desert oasis (~1.9 E, 2.7 N) — the only water in the desert; small
  - Blue Crater lake (~0.4 W, 2.7 S)
  - Eastern ocean shoreline (~3.0 E, anywhere S) — unlimited
  - If a factory sits somewhere else, pipe water in from one of these and
    show the pipe run in the layout. **No extractors in the middle of the
    desert.**
- Geysers feed geothermal generators in the Power view, nothing else.

## Scale — milestone-driven

- Each tier group must produce every part its milestones cost, plus the
  space elevator phase parts for that group, at rates that finish the phase
  in a reasonable sitting (state the rate on the tier page's objective —
  e.g. "Smart Plating at 5/min").
- Every newly unlocked **production component** (parts that feed other
  recipes, milestones, or the elevator) gets a real production line.
  Equipment, ammo, filters, and FICSMAS event items are optional — note them
  as skipped on the tier artifact if you skip them.
- Later tiers are expected to upgrade earlier factories (faster belts,
  higher miner marks, more machines) and to pull shared intermediates from
  existing factories over logistics links instead of rebuilding everything
  on-site. Document upgrades as deltas in that tier's artifacts.

## Power

- Every factory's power balance must be ≥ 0 at each tier checkpoint, using
  generators available at that tier (biomass burners at T0, coal at T3, fuel
  at T5+, nuclear at T8). Geothermal is allowed once claimed.
- A shared grid is fine (the game has one), but the run must show total
  generation ≥ total draw per tier, and the layouts must say which factory
  hosts which generators.

## Driving the app

- Flows go through the real UI: creating factories, claiming nodes, editing
  plans, adding machines, linking factories. `ipc_execute_command` and
  backend-state reads are for assertions only.
- Screenshot every tier checkpoint (the tier pages say what to capture).
- If a UI flow dead-ends, misleads, or makes the realistic plan impossible,
  file a bug. If it blocks the run entirely, severity is `showstopper`: stop,
  write it up, hand back.

## Alternates

On entering a tier group, unlock every alt recipe whose `unlock_tier` is at
or below the new current tier (the Alts screen has the full list). The run
assumes the pioneer collects all reachable hard drives the moment a tier
opens. Plans are free to use any unlocked alt — the optimizer will pick.

## Layout realism

- Foundations are 8×8 m. Machine footprints, belt runs, splitters/mergers,
  and pipe runs all live on that grid in the layout artifacts.
- Every belt segment in a layout carries a label: mark + items/min actually
  flowing. A segment over its mark's capacity is a broken layout — fix it or
  file the bug that makes it unavoidable.
- Extractors sit on their nodes; factories sit near their claimed nodes at
  the map positions recorded in the app. Long hauls are logistics links, not
  imaginary belts across the map.
