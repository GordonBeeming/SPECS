# Nuclear Power Station — Tier 8 (new)

**Site:** 0.70 km W · 0.20 km N — on the Grass Fields lakes, north of the uranium.
**Built at:** Tier 8 · Mk5 belts (780/min cap) · Mk2 pipes (600 m³/min cap)

## Why here

Nuclear wants 480 m³/min of water and 16.7/min of uranium ore, so the siting
question answers itself: **ore travels, water doesn't.** Putting the plant on the
lake and belting the ore 676 m north costs one belt at 2% of a Mk5. Putting it on
the uranium node instead would have meant a kilometre of pipe carrying half a Mk2's
worth of water, which is a much worse thing to build.

The pin was placed by dragging it on the map, and the app's own claim distance
confirmed the result: 676 m from the plant to the uranium node, 481 m to the water
group.

## Claims

| Node | Purity | Extractor | Clock | Output | Distance |
| --- | --- | --- | --- | --- | --- |
| Uranium #2 · 0.8 km W · 0.5 km S | Normal | Miner Mk.3 | 7% | 17 ipm | 676 m |

Uranium is the one resource where a 7% clock is the right answer. Two reactors burn
0.4 Uranium Fuel Rod/min between them, the rod chain needs 16.7 uranium ore/min, and
a Mk.3 miner on a Normal node makes 240/min at 100%, so the node runs at a
fourteenth of its capacity and the other four uranium nodes on the map stay
untouched.

Water is a group: **5× Water Extractor @ 87.7% = 526.2 m³/min** on the Grass Fields
lakes at 0.47 km W · 0.62 km N, 481 m from the plant, against 480 m³/min for the
reactors plus 45.9 m³/min for the process lines.

## Power

| | MW |
| --- | --- |
| 2× Nuclear Power Plant @ 100% | **5,000.0** |
| Process draw (27 machines) | −164.5 |
| **Balance** | **+4,835.5** into the shared grid |

Fuel demand reads `Uranium Fuel Rod 0.40 /min` and `Water 480.00 m³/min`. Two
reactors is the exact match for a 0.4/min rod line, and it takes the whole
playthrough from −683 MW to +4,172 MW in one build.

## Production

27 machines, all of them feeding one product.

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Uranium Fuel Rod | 0.4/min ✱ | Uranium Fuel Rod | 1× Manufacturer @ 67% |
| Encased Uranium Cell | 13.3/min | Alternate: Infused Uranium Cell | 1× Manufacturer @ 67% |
| Electromagnetic Control Rod | 1.3/min | Electromagnetic Control Rod | 1× Assembler @ 33% |
| Crystal Oscillator | 0.4/min | Crystal Oscillator | 1× Manufacturer @ 21% |
| AI Limiter | 1.7/min | AI Limiter | 1× Assembler @ 22% |

✱ = tier objective output.

The rest is the chain underneath those five: caterium to quickwire for the AI
Limiter, quartz to crystal for the oscillator, iron and copper for the rods and
stators. Twenty-two machines of it, almost all under 50% clock, because a 0.4/min
fuel-rod line is a very small factory wearing a very long tail.

## Waste, and why this section is short

**The tier page asks for the waste path to be stated explicitly, and the app has
nowhere to state it.**

In Satisfactory a Nuclear Power Plant burning Uranium Fuel Rods emits Uranium Waste,
which you either sink, store, or reprocess into plutonium. In SPECS none of that
exists:

- The Nuclear Power Plant generator has **no waste output** in the data model. Its
  fuel panel lists inputs only (`Uranium Fuel Rod 0.40 /min`, `Water 480.00 m³/min`)
  and there is no output row of any kind.
- **Uranium Waste has no producing recipe**, so nothing downstream can be planned
  from it.
- The product picker therefore **silently drops the entire plutonium chain**.
  Searching for Plutonium Fuel Rod, Encased Plutonium Cell, Plutonium Pellet,
  Non-Fissile Uranium or Ficsonium all return "No matches.", the same empty state
  a typo gives.
- The fuel picker, two screens away, **offers Plutonium Fuel Rod as a nuclear
  fuel** at 0.10/min + 240 Water. One screen says the item exists; the other says
  it doesn't.

So the honest statement of this plant's waste path is: **2 reactors × 0.2 rods/min
= 0.4 Uranium Fuel Rod/min consumed, producing 10 Uranium Waste/min in the real
game, for which this plan has no route because the app cannot represent it.** In a
real playthrough that waste goes into storage containers until plutonium
reprocessing is built. The checkpoint item can't be satisfied inside the app, and
that gap is reported rather than papered over.

## Pipes

| Segment | Rate | Cap at T8 | Lines |
| --- | --- | --- | --- |
| Lake group → reactor row | Water 480 m³/min | Mk2 600 | 1 |
| Lake group → process lines | Water 45.9 m³/min | Mk2 600 | 1 |

480 m³/min is 80% of one Mk2 pipe, which is the tightest fluid run in the
playthrough so far and still legal on a single line.

## Belts

| Segment | Rate | Cap at T8 | Lines |
| --- | --- | --- | --- |
| Uranium miner → Encased Cell bank | 17/min | Mk5 780 | 1 |
| Encased Uranium Cell → Fuel Rod | 13.3/min | Mk5 780 | 1 |
| Fuel Rod → reactor row | 0.4/min | Mk5 780 | 1 |

Nothing here is near a cap. A nuclear plant moves almost nothing on belts; it moves
water.

## What isn't finished

Validate shows nine supply warnings against this factory: Coal 1.0, Crude Oil 3.0,
Nitrogen Gas 2.1, Copper Ore 13.7, Caterium Ore 12.7, Iron Ore 18.3, Raw Quartz 7.6,
Limestone 3.3 and Sulfur 16.7 per minute, none of them claimed. They're all the same
problem as the Aluminum Plant's: the twenty-two-machine tail under the fuel rod is
built on site instead of imported, because Caterium Electronics, Steel Mill, Iron
Works and Copper Works have no spare export capacity at Tier 8.

The right fix is the same one. Scale those factories, then pull AI Limiter,
Crystal Oscillator, Stator, Rotor and Steel Pipe in over links, which would take
this plant from 27 machines to about 5.
