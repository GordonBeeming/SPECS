# Copper Works — Tier 0

**Site:** Grass Fields — roughly 0.95 km W / 1.45 km N, between the two nodes
**Built at:** Tier 0 · Mk1 belts only (60/min cap) · Miner Mk.1 only

## Claims

| Node | Purity | Coords | Extractor | Clock | Output |
| --- | --- | --- | --- | --- | --- |
| Copper Ore #3 | Normal | 1.0 km W · 1.4 km N | Miner Mk.1 | 50% | 30/min |
| Limestone #6 | Normal | 0.9 km W · 1.5 km N | Miner Mk.1 | 75% | 45/min |

The two nodes are about 140 m apart, so one plant sits between them and belts
both feeds in directly.

Clocks are picked to land exactly on demand rather than to run the miners flat
out: copper needs 30/min against a Normal node's 60/min at full clock, and
limestone needs 45/min, which is 75% of 60.

## Production

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Copper Ingot | Copper Ingot | 1× Smelter | 100% | 30/min |
| Wire | Wire | 2× Constructor | 100% | 60/min (30/min ✱ + 30/min internal) |
| Cable | Cable | 1× Constructor | 50% | 15/min ✱ |
| Concrete | Concrete | 1× Constructor | 100% | 15/min ✱ |

✱ = tier objective output.

The two Wire constructors split cleanly: one feeds Cable, the other feeds the
export. No merger is needed anywhere in this plant.

## Layout

Foundations are 8×8 m. Miners sit on their nodes off the foundation grid.

```
        col 1              col 2         col 3           col 4          col 5
row 1   [Cu Miner] ──30 Ore──▶ [Smelter] ──30 Ingot──▶ [Split S1]
row 2                                        ┌──15 Ingot──▶ [Constr W1] ──30 Wire──▶ [Constr C] ──15 Cable──▶ out
row 3                                        └──15 Ingot──▶ [Constr W2] ──30 Wire──▶ out
row 4
row 5   [LS Miner] ──45 Limestone──────────▶ [Constr Cn] ──15 Concrete──▶ out
row 6
row 7   [Biomass Burner ×1]
```

Machine footprints: Miner Mk.1 6×14 m, Smelter 6×9 m, Constructor 8×10 m,
Biomass Burner 8×8 m. The plant fits in roughly 5×7 foundations (40 m × 56 m).

## Belt segments

Every segment is Mk1, cap 60/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Cu Miner → Smelter | Copper Ore | 30/min | 30 |
| 2 | Smelter → Split S1 | Copper Ingot | 30/min | 30 |
| 3 | Split S1 → Constr W1 | Copper Ingot | 15/min | 45 |
| 4 | Split S1 → Constr W2 | Copper Ingot | 15/min | 45 |
| 5 | Constr W1 → Constr C | Wire | 30/min | 30 |
| 6 | Constr W2 → output | Wire | 30/min | 30 |
| 7 | Constr C → output | Cable | 15/min | 45 |
| 8 | LS Miner → Constr Cn | Limestone | 45/min | 15 |
| 9 | Constr Cn → output | Concrete | 15/min | 45 |

Busiest segment is the limestone feed at 45/min. Nothing needs a parallel run.

## Power

| | MW |
| --- | --- |
| 5 production machines (Power view figure) | 17.6 |
| 2× Miner Mk.1 @ 50% and 75% (not modelled by the app) | ~5.4 |
| **Draw** | **~23.0** |
| 1× Biomass Burner @ 100% | 30.0 |
| **Balance** | **+7.0** |

The plan graph reports 17.0 MW for the same five machines because it squares the
clock instead of raising it to 1.321928, so the Cable constructor at 50% comes
out as 1.0 MW there and 1.6 MW in the Power view. That's issue #45; the Power
view figure is the correct one.

Fuel: Biomass 4.00/min, hand-fed. Nothing produces it; see the run notes.

---

# Copper Works — Tier 2 delta

The smallest change of the three: one new line, one clock bump, one burner.

| | Tier 0 | Tier 2 |
| --- | --- | --- |
| Machines | 5 | 7 |
| Draw | ~23 MW | 32.3 MW |
| Generators | 1× Biomass Burner | 2× Biomass Burner |
| Copper claimed | 30/min | 60/min |

## Claim change

Copper Ore #3 went from 50% to 100% — 30/min to 60/min — to feed the new Copper
Sheet line. Limestone #6 is untouched at 75% / 45 ipm.

## Production

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Copper Ingot | Copper Ingot | 2× Smelter | 83% | 50/min |
| Copper Sheet | Copper Sheet | 1× Constructor | 100% | 10/min ✱ |
| Wire | Wire | 2× Constructor | 100% | 60/min (30 ✱ + 30 internal) |
| Cable | Cable | 1× Constructor | 50% | 15/min ✱ |
| Concrete | Concrete | 1× Constructor | 100% | 15/min ✱ |

✱ = tier objective output.

## The alt I turned down

Unlocking the T1/T2 alts made the solver rebuild the Wire line on Alternate: Iron
Wire, which is a better recipe in isolation, and it quietly gave Copper Works a
33.3/min iron ore demand. Copper Works has no iron node anywhere near it, and
every claimed iron node was already committed to Iron Works a kilometre west. The
plan still showed green, because claimed supply is pooled across the whole
playthrough rather than checked against the factory that claimed it.

Belting iron ore a kilometre to a copper plant isn't a factory anyone would build,
and Tier 2 has no truck or train to turn that haul into a real logistics link
either. I put the Wire line back on the standard Copper Ingot recipe so Copper
Works stays self-contained on its own two nodes. Reported separately.

## Belt segments

Every segment is Mk2, cap 120/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Cu Miner → Smelter bank | Copper Ore | 50/min | 70 |
| 2 | Smelter bank → Copper Sheet | Copper Ingot | 20/min | 100 |
| 3 | Smelter bank → Wire | Copper Ingot | 30/min | 90 |
| 4 | Wire → Cable | Wire | 30/min | 90 |
| 5 | Wire → output | Wire | 30/min | 90 |
| 6 | Cable → output | Cable | 15/min | 105 |
| 7 | Copper Sheet → output | Copper Sheet | 10/min | 110 |
| 8 | LS Miner → Concrete | Limestone | 45/min | 75 |
| 9 | Concrete → output | Concrete | 15/min | 105 |

Busiest segment is 50/min against a 120 cap. Nothing needs a parallel run, and
the Tier 0 limestone feed that sat at 45/60 now sits at 45/120.

## Power

| | MW |
| --- | --- |
| 7 production machines | 23.9 |
| 2× Miner Mk.1 (100% and 75%) | 8.4 |
| **Draw** | **32.3** |
| 2× Biomass Burner @ 100% | 60.0 |
| **Balance** | **+27.7** |

Fuel: Biomass 8.00/min, hand-fed.

---

# Copper Works — Tier 3–4 delta

**Belts upgraded Mk2 → Mk3 (270/min).** 7 machines → **21 machines · 88.5 MW**.
Copper Works becomes the run's wire, cable and concrete supplier, feeding both new
factories.

## Claims — changed

| Node | Was | Now | Why |
| --- | --- | --- | --- |
| Copper Ore Normal #3 · 1.0 km W · 1.4 km N | Mk.1 @ 100% · 60/min | unchanged | |
| Copper Ore Pure #1 · 0.3 km W · 1.5 km N | — | **Mk.1 @ 75% · 90/min** | wire demand went from 60 to 260/min |
| Limestone Normal #6 · 0.9 km W · 1.5 km N | Mk.1 @ 75% · 45/min | unchanged | |
| Limestone Pure #14 · 0.6 km W · 1.3 km N | — | **Mk.1 @ 50% · 60/min** | concrete 15 → 35/min |

Copper 60 → 150/min against a plan that draws exactly 150. Limestone 45 → 105/min
against a plan that draws exactly 105. Both new claims are inside 650 m.

## Production — changed

| Item | Recipe | Machines | Clock | Rate |
| --- | --- | --- | --- | --- |
| Copper Ingot | Copper Ingot | 5× Smelter | 100% | 150/min |
| Wire | Wire | 9× Constructor | 96% | 260/min (130 free) |
| Cable | Cable | 3× Constructor | 72% | 65/min |
| Concrete | Concrete | 3× Constructor | 78% | 35/min |
| Copper Sheet | Copper Sheet | 1× Constructor | 100% | 10/min |

Copper Ingot and Concrete are **pinned to their standard recipes**. Unlocking the
Tier 3–4 alts silently re-solved this plant onto Copper Alloy Ingot (needs iron
ore) and Fine Concrete via Cheap Silica (needs raw quartz), neither of which is
claimed within a kilometre. Pinning both puts it back on copper and limestone.

## Exports — new

| Item | Rate | To | Distance (map) | Transport |
| --- | --- | --- | --- | --- |
| Wire | 100/min | Motor Works | 583 m | 1× Mk3 belt (37% used) |
| Cable | 50/min | Motor Works | 583 m | 1× Mk3 belt (19% used) |
| Concrete | 20/min | Steel Mill | 792 m | 1× Mk3 belt (7% used) |

30 Wire, 15 Cable, 15 Concrete and 10 Copper Sheet per minute stay free.

## Belt segments — changed

Every segment is Mk3, cap 270/min.

| # | From → To | Carries | Rate | Headroom |
| --- | --- | --- | --- | --- |
| 1 | Cu Normal #3 → Smelter bank | Copper Ore | 60/min | 210 |
| 2 | Cu Pure #1 → Smelter bank | Copper Ore | 90/min | 180 |
| 3 | Smelter bank → Wire bank | Copper Ingot | 130/min | 140 |
| 4 | Smelter bank → Copper Sheet | Copper Ingot | 20/min | 250 |
| 5 | Wire bank → Cable | Wire | 130/min | 140 |
| 6 | Wire bank → out | Wire | 130/min | 140 |
| 7 | LS Normal #6 → Concrete | Limestone | 45/min | 225 |
| 8 | LS Pure #14 → Concrete | Limestone | 60/min | 210 |
| 9 | Cable → out | Cable | 65/min | 205 |
| 10 | Concrete → out | Concrete | 35/min | 235 |

The Wire bank's own output is 260/min — 96% of a single Mk3 — but it never runs as
one line: the nine Constructors split straight into the 130/min cable feed and the
130/min export line. Merging them first would saturate.

## Power — changed

| | MW |
| --- | --- |
| 21 machines + 4 extractors | 88.5 |
| **Draw** | **88.5** |
| 2× Biomass Burner @ 100% | 60.0 |
| **Balance** | **−28.5** |

Carried by the shared grid from Coal Power Station, 780 m south-east.
