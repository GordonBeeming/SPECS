# Run — 2026-07-26-full-game

One continuous Tier 0 → Tier 9 playthrough, recorded end to end. Each tier group
appends to this folder rather than starting its own.

Playthrough created in-app on 26 Jul 2026, starting tier 0, game stamp `1.2`.

## Tier index

| Tier group | Status | Validate | Frames |
| --- | --- | --- | --- |
| Tier 0 | Complete | No findings — 60 MW gen / 42 MW draw (+18 MW) | 00001–00096 |

From Tier 1 onward the map is the primary surface: claim on the node, place the
factory where it belongs spatially, and let list screens cover only what the map
can't do.

## Tier 0

### What was built

| Factory | Site | Products | Machines | Power |
| --- | --- | --- | --- | --- |
| [Iron Works](./factories/iron-works.md) | 1.9 km W · 1.2 km N | Iron Plate 20/min, Iron Rod 20/min, Screws 40/min | 6 | 1× Biomass Burner, +2 MW |
| [Copper Works](./factories/copper-works.md) | 0.95 km W · 1.45 km N | Wire 30/min, Cable 15/min, Concrete 15/min | 5 | 1× Biomass Burner, +7 MW |

Four nodes claimed, 135 ipm total: two Normal iron at 50%, one Normal copper at
50%, one Normal limestone at 75%. Every miner is a Mk.1 and every belt is Mk1.
The busiest segment in either plant carries 45/min against the 60/min cap, so
nothing needs a parallel run yet.

### Checkpoint

- [x] Validate playthrough → no findings
- [x] No belt segment over 60/min in the layouts (worst is 45/min)
- [x] Layout artifacts written for both factories; screenshots of each plan
      graph, the map with claims, and the validation panel
- [x] `hesitations.md` emptied into the findings report

### Alternates

No alt recipe in the library unlocks at or below T0, so nothing was unlocked. The
earliest is Cast Screws at T1. The Alts screen will still let you tick a T7
recipe while sitting at T0, which is reported separately.

### Skipped

Nothing this tier is skipped by choice. Biomass is the one T0 recipe without a
production line, and that isn't a judgement call: its inputs are Leaves and Wood,
which have no extractor in the game at any tier, and the app's product picker
returns "No matches." for Biomass anyway. Both burners are hand-fed at 4.00/min
each, which is how Tier 0 power works in-game.

No equipment, ammo, filters or FICSMAS items exist at T0.

### Map pass

Both factories were created from the Factories list, so both pins spawned on the
same default coordinate and had to be dragged onto their nodes by hand. The map
has a better route for this that I found afterwards: an unlabelled rail button,
"Place a factory — click, then click the map", which opens a small "New factory
here" card and creates the factory at the clicked point. Tier 1 onward uses that.

The map also carries a full claim flow. Clicking an unclaimed node opens a card
with the resource, purity, coordinates, extractor, clock and factory binding, and
a Claim button. It only works one way though: clicking an *already claimed* node
does nothing at all, so the map can start a claim but can't review or change one.

I ran two probes and reverted both: a map claim on Iron Ore Normal #11, which I
had to remove from the Resources list because the map can't unclaim, and a
throwaway "Placement Probe" factory created from the map and removed with "Cancel
& delete this factory". Validate still reports no findings afterwards, with the
same four claims at 135 ipm.

### Screenshots

- `2026-07-26-full-game-t0-iron-works-plan-graph.png`
- `2026-07-26-full-game-t0-copper-works-plan-graph.png`
- `2026-07-26-full-game-t0-map-claims-and-factories.png`
- `2026-07-26-full-game-t0-resources-claims.png`
- `2026-07-26-full-game-t0-validate-clean.png`
- `2026-07-26-full-game-t0-home-machine-count-8-vs-11.png`
- `2026-07-26-full-game-t0-power-hides-ungenerated-factory.png`
- `2026-07-26-full-game-t0-map-factory-card-oreiron.png`
- `2026-07-26-full-game-t0-map-pins-stacked-default.png`
- `2026-07-26-full-game-t0-icon-search-no-match-iron-plate.png`
- `2026-07-26-full-game-t0-alts-t7-tickable-at-t0.png`
- `2026-07-26-full-game-t0-biomass-no-matches-in-product-picker.png`
- `2026-07-26-full-game-t0-map-filtered-to-iron.png`
- `2026-07-26-full-game-t0-map-node-card-negative-coords.png`
- `2026-07-26-full-game-t0-map-placing-loadout-mk2-default-at-t0.png`
- `2026-07-26-full-game-t0-map-factory-pill-occludes-its-nodes.png`
- `2026-07-26-full-game-t0-network-light-theme-cards.png`
- `2026-07-26-full-game-t0-logistics-distance-not-derived-from-map.png`
- `2026-07-26-full-game-t0-logistics-item-picker-whole-catalogue.png`
