# Quantum Lab — Tier 9 (new)

**Site:** 2.0 km W · 0.5 km N
**Built at:** Tier 9 · Mk6 belts (1200/min cap) · Mk2 pipes (600 m³/min cap)

This layout is reconstructed from the `.specsdb` and the game's recipe data,
not written live: the agent that built it stopped before filing its own
report. The production breakdown below is a full material-balance
reconciliation, checked against every import and export, rather than a
guess; the site reasoning and any internal belt routing aren't in the
database, so they're left unstated rather than invented.

## Why here

Quantum Lab holds no resource claim, and unlike every other Tier 9 factory
it has no import links either. Nothing feeds it from elsewhere in the
network. The only logistics link touching it is outbound: Superposition
Oscillator to Warp Drive Final, 696 m away. There's no evidence in the
database for why this particular spot was chosen; it isn't near a claimed
node and it isn't near a supplier the way the other five new factories are.

## Claims

None.

## Exports

| Item | Rate | To | Distance | Transport |
| --- | --- | --- | --- | --- |
| Superposition Oscillator | 1.0/min | Warp Drive Final | 696 m | belt |

Fully committed (`export_ipm_x100` matches the plan target exactly): every
drop of this factory's Superposition Oscillator output is spoken for.

## Production

Five explicit plan targets, one of them the Phase 5 objective:

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| AI Expansion Server | 0.5/min ✱ | AI Expansion Server | 1× Quantum Encoder @ 12.5% |
| Time Crystal | 3.0/min | Time Crystal | 2× Converter @ 98.61% |
| Dark Matter Crystal | 3.0/min | Alternate: Dark Matter Crystallization + Alternate: Dark Matter Trap | 2× Particle Accelerator @ 34–9% |
| Superposition Oscillator | 1.0/min (exported) | Superposition Oscillator | 1× Quantum Encoder @ 30% |
| Neural-Quantum Processor | 0.75/min | Neural-Quantum Processor | 1× Quantum Encoder @ 41.67% |

✱ = Space Elevator Phase 5 objective output. The other four are the tier
page's late-game side objectives, not elevator parts.

68 machines carry those five outputs. AI Expansion Server needs Magnetic
Field Generator 0.5/min, Neural-Quantum Processor 4/min, Superposition
Oscillator 4/min and Excited Photonic Matter 100/min at full rate; at this
factory's 12.5% clock that's a small enough draw that a second, self-feeding
Magnetic Field Generator line (1× Assembler @ 50%, the same "Made at" gap
covered in the Space Elevator section of `RUN.md`) plus an Electromagnetic
Control Rod line underneath it can cover the Magnetic Field Generator side
entirely on site.

The rest of the 68 splits into four families. A full aluminum chain (Bauxite
→ Alumina Solution → Aluminum Ingot → Alclad Sheet, three Smelters and two
Assemblers) and a standard ore-processing chain (iron, copper, caterium and
quartz through Refinery alternates, feeding circuit boards, wire, quickwire
and electromagnetic-control-rod sub-lines) cover most of the raw-material
side. A SAM and Ficsite chain (Reanimated SAM, Ficsite Trigon, Ficsite
Ingot (Aluminum) and Quantum Energy, four Converters and two Constructors)
sits underneath the Dark Matter and quantum lines; this is a partial build
toward the Ficsonium loop the tier page asks for, though the loop itself
isn't complete (see below). And a Converter trio (Bauxite→Copper,
Caterium Ore→Copper, Sulfur→Iron) supplements the ore chain by trading
surplus ore types for ones this factory is short on, all at low clocks.

## What isn't finished

Quantum Lab has no import to lean on, so its raw-material gap is the widest
of the four large Tier 9 factories after Warp Drive Final. Reconciling every
machine's draw against on-site supply: Coal 237.3/min, Copper Ore 173.2/min,
Water 281.8/min (net, after 44.9/min recycled internally), Iron Ore
115.6/min, SAM 90.3/min, Crude Oil 41.6/min, Raw Quartz 19.2/min and Sulfur
26.6/min, none of it claimed anywhere. The tier page's **Ficsonium loop** and
**SAM Conversion Works** objectives are both listed as unbuilt in the Tier 9
"what this group did not reach" section, and the partial SAM/Ficsite chain
described above doesn't contradict that: it's an ingredient run toward those
objectives, not the loop itself, and Ficsonium is never planned as a target
anywhere in the database.
