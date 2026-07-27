# Magnet Works — Tier 9 (new)

**Site:** 1.0 km W · 0.9 km N
**Built at:** Tier 9 · Mk6 belts (1200/min cap) · Mk2 pipes (600 m³/min cap)

This layout is reconstructed from the `.specsdb`, not written live: the agent
that built it stopped before filing its own report. Everything below is what
the database, the game's recipe data, and the two Tier 9 screenshots can
establish. Where that isn't enough, namely the actual reasoning behind the
site pick and any belt routing inside the plant, it's left unstated rather
than guessed.

## Why here

Magnet Works sits closest to its busiest import: 301 m from Motor Works, then
618 m from Elevator Yard and 842 m from Caterium Electronics. Like Director
Works, it holds no resource claim of its own. The site favors the shortest
of its three supply lines rather than any ore underfoot.

## Claims

None. Every raw input this factory's chain needs arrives already refined,
over a logistics link.

## Imports

| Item | Rate | From | Distance | Transport |
| --- | --- | --- | --- | --- |
| Stator | 0.75/min | Motor Works | 301 m | belt |
| AI Limiter | 0.5/min | Caterium Electronics | 842 m | belt |
| Versatile Framework | 1.25/min | Elevator Yard | 618 m | belt |

None of the three links carries a committed belt mark in the database
(`transport_plan_json` is empty on all three), so there's no cap check to
report. Just the rate and distance the app derived.

## Production

Two machines: one intermediate, one Space Elevator part.

| Product | Rate | Recipe | Machines |
| --- | --- | --- | --- |
| Electromagnetic Control Rod | 0.5/min | Electromagnetic Control Rod | 1× Assembler @ 12.5% |
| Magnetic Field Generator | 0.5/min ✱ | Magnetic Field Generator | 1× Assembler @ 50% |

✱ = Space Elevator Phase 4 objective output.

The two machines feed each other in sequence. Electromagnetic Control Rod
takes Stator 0.75/min and AI Limiter 0.5/min at 12.5% clock, both imported
and matching the table above exactly, and outputs 0.5/min, which is
precisely what the Magnetic Field Generator machine needs alongside its
1.25/min of imported Versatile Framework. Nothing is over- or under-built.

Caterium Electronics went from 47 to 38 machines the first time this import
flow was used, per the Tier 9 write-up; Magnet Works is the second example,
going from a planned 22 machines down to these 2.

## What isn't finished

Magnetic Field Generator is also built in a second, separate line at Quantum
Lab (0.5/min, feeding that factory's own AI Expansion Server rather than
importing from here). See the Space Elevator section of `RUN.md` and
`quantum-lab.md` for that. Nothing about Magnet Works itself is short: it has
no unclaimed raw inputs, because it has no raw inputs at all.
