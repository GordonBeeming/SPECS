# Run 2026-07-26-tier0-rerun

- **Playthrough:** 2026-07-26-tier0-rerun (created at Tier 0, game 1.2)
- **Status:** tier-0 done, findings reported to the run lead for filing

| Tier group | State | Issues |
| ---------- | ----- | ------ |
| tier-0     | done  | reported, not yet filed |
| tiers-1-2  | not started | — |
| tiers-3-4  | not started | — |
| tiers-5-6  | not started | — |
| tiers-7-8  | not started | — |
| tier-9     | not started | — |

## Tier 0 checkpoint

| Check | Result |
| ----- | ------ |
| Validate → no findings | pass — "No findings — everything checks out at T0. Grid: 60 MW gen / 42 MW draw (+18 MW)" |
| No belt segment over 60/min | pass — worst segments are the two at exactly 60/min in Iron Works |
| Layout artifacts for both factories | `factories/iron-works.html`, `factories/copper-works.html` |
| Screenshots: plan graphs, map with claims, validation panel | in `screenshots/` |
| Alts unlocked with `unlock_tier <= 0` | none exist at T0, so 0 unlocked — correct |

## What was built

**Claims — 4 nodes, 225 ipm total**

| Ore | Node | Purity | Extractor | Clock | Rate |
| --- | ---- | ------ | --------- | ----- | ---- |
| Iron | #1 · 1.5 km W · 0.5 km N | Pure | Miner Mk.1 | 50% | 60/min |
| Iron | #6 · 1.9 km W · 1.2 km N | Normal | Miner Mk.1 | 100% | 60/min |
| Copper | #8 · 1.7 km W · 1.3 km N | Normal | Miner Mk.1 | 100% | 60/min |
| Limestone | #3 · 1.7 km W · 1.3 km N | Pure | Miner Mk.1 | 37.5% | 45/min |

**Iron Works** — Iron Plate 20/min, Iron Rod 20/min, Screws 40/min.
6 machines, 24.0 MW, 1 Biomass Burner (+6.0 MW net).

**Copper Works** — Wire 30/min, Cable 15/min, Concrete 15/min.
5 machines, 17.6 MW, 1 Biomass Burner (+12.4 MW net).

No logistics links — correct for Tier 0, both factories are self-contained.

## Caveats on this run

- **Node → factory assignment was not set.** Every claim is still on
  `— none —`. The control is a native `<select>`, which the Tauri MCP bridge
  cannot drive (synthetic key and click events do not change a native select on
  macOS). That is a harness limitation, not an app defect — a person with a
  mouse would set it in one click. Worth noting that Validate passes anyway,
  with no complaint that four claimed nodes belong to no factory.
- **Map drag-to-pan is likewise undrivable** synthetically, so the map capture
  is a zoomed-out view rather than one centred on the claims. The zoom buttons
  are real buttons and do work.
- The app rebuilt and relaunched roughly every 2–3 minutes throughout the
  session because a teammate was editing `src-tauri/`. Several multi-step
  modals had to be redone. No finding in this run is attributable to that.
