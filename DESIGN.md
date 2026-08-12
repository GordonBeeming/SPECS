# SPECS Design System

The single source of truth for visual decisions in SPECS. Every PR that touches
UI references this file; if a decision needs to change, update `DESIGN.md` first
and the code afterwards.

The base palette comes from the Gordon Beeming personal brand
(`~/.claude/skills/personal-brand-guidelines/`); SPECS extends it with
app-specific tokens (success/warn/danger, transport kinds, belt tiers). Every
new pair has been spot-checked for WCAG 2.1 AA contrast against both modes.

## Brand tokens

All tokens are defined in `src/shared/theme/brand.css` and exposed as both CSS
variables and Tailwind v4 `@theme` tokens. Use Tailwind utilities (`bg-primary`,
`text-fg-muted`) in components rather than reaching for the variables directly,
unless an unusual case demands it.

### Light mode

| Token                       | Hex      | Use                                       |
| --------------------------- | -------- | ----------------------------------------- |
| `--color-bg`                | `#F8F9FA` | App background                            |
| `--color-bg-raised`         | `#FFFFFF` | Cards, modals                             |
| `--color-fg`                | `#1A1A1A` | Primary text                              |
| `--color-fg-muted`          | `#374151` | Secondary text                            |
| `--color-primary`           | `#0063B2` | Brand anchor; healthy/active links        |
| `--color-accent`            | `#0075A3` | Secondary accent                          |
| `--color-border`            | `#E9ECEF` | Borders, dividers, subtle fills           |
| `--color-success`           | `#1F7A3A` | Balanced factory, healthy throughput      |
| `--color-warning`           | `#A8590B` | Underused belt, shared signal block       |
| `--color-danger`            | `#B91C1C` | Over-capacity link, missing input         |

### Dark mode

| Token                       | Hex      | Use                                       |
| --------------------------- | -------- | ----------------------------------------- |
| `--color-bg`                | `#1A1A1A` | App background                            |
| `--color-bg-raised`         | `#232323` | Cards, modals                             |
| `--color-fg`                | `#E0E0E0` | Primary text                              |
| `--color-fg-muted`          | `#D1D5DB` | Secondary text                            |
| `--color-primary`           | `#46CBFF` | Brand anchor                              |
| `--color-accent`            | `#0063B2` | Secondary accent                          |
| `--color-border`            | `#2C2C2C` | Borders, dividers                         |
| `--color-success`           | `#4ADE80` | Balanced / healthy                        |
| `--color-warning`           | `#FBBF24` | Underused / warning                       |
| `--color-danger`            | `#F87171` | Over-capacity / failure                   |

### Transport / belt tier colours

Used for React Flow edge strokes so the user can read transport kind and belt
tier at a glance.

| Token                       | Light    | Dark     |
| --------------------------- | -------- | -------- |
| `--color-belt-mk1`          | `#6B7280` | `#9CA3AF` |
| `--color-belt-mk2`          | `#0075A3` | `#46CBFF` |
| `--color-belt-mk3`          | `#15803D` | `#4ADE80` |
| `--color-belt-mk4`          | `#CA8A04` | `#FCD34D` |
| `--color-belt-mk5`          | `#C2410C` | `#FB923C` |
| `--color-belt-mk6`          | `#7C2D92` | `#D8B4FE` |
| `--color-pipe-mk1`          | `#0D9488` | `#5EEAD4` |
| `--color-pipe-mk2`          | `#155E75` | `#67E8F9` |
| `--color-transport-truck`   | `#B45309` | `#FBBF24` |
| `--color-transport-train`   | `#1E40AF` | `#93C5FD` |
| `--color-transport-drone`   | `#7C2D92` | `#D8B4FE` |

## Typography

System sans-serif stack: `-apple-system, "Segoe UI", system-ui, sans-serif`.
System monospace for code and numerical readouts. `font-feature-settings:
"tnum" 1` is set globally so throughput numbers (45 ipm, 120 ipm, 1200 ipm) are
column-aligned.

| Use            | Tailwind class | Notes                                   |
| -------------- | -------------- | --------------------------------------- |
| Page heading   | `text-2xl font-semibold` |                                  |
| Section heading| `text-lg font-semibold`  |                                  |
| Body           | `text-sm`                |                                  |
| Caption        | `text-xs text-fg-muted`  |                                  |
| Numerical      | `tabular-nums font-mono` | for throughput / power readouts |

## Mode handling

- Tailwind v4 `@custom-variant dark (&:where(.dark, .dark *))` in `brand.css`.
- First run honours `prefers-color-scheme`. Persisted to
  `localStorage["specs.theme-mode"]` after manual toggle.
- The toggle lives in the app shell header. A future settings panel can also
  offer "system / light / dark"; current MVP is binary.

## Component standards

Branded primitives live in `src/shared/ui/`. Anything reused across slices goes
here and references brand tokens (no slice should hard-code colours).

- `Button` — `primary` and `ghost` variants. Always pair icon-only buttons
  with `aria-label`.
- `Card` — raised surface with subtle border. Default padding `p-5`.
- `Badge` — pill with `neutral / success / warning / danger` tones. Colour is
  never the only signal — pair with a Lucide icon.

Add new primitives sparingly: a primitive only earns its slot if 2+ slices use
it. Otherwise keep it inside the slice.

## React Flow styling

- Nodes are factory cards. Header colour reflects factory category (set by the
  user; falls back to `--color-primary`). Body lists net inputs/outputs in
  tabular-nums.
- Edges are logistics links. Stroke colour comes from the transport-kind token
  (or belt-tier token for belt links). Stroke width grows from 1px to 4px as
  utilisation rises 0% → 100%; over 100% switches to `--color-danger` and adds
  a `!` icon at the midpoint.
- Edges that share a train route are dashed; tooltip lists every link on the
  route.

## Game icons

We **must not** invent icons for items and buildings. Players need to recognise
"Iron Plate" or "Manufacturer" instantly.

**Pack bundled:** the 64-pixel icon set from the community-maintained
[SatisfactoryTools](https://github.com/greeny/SatisfactoryTools) project
(`www/assets/images/items/*.png`), one icon per item, building, and
generator id in the v1.1 dataset.

- **Pack name + source URL:** SatisfactoryTools icon dump — `master` branch
  at `https://github.com/greeny/SatisfactoryTools/tree/master/www/assets/images/items`.
- **Pack version pinned:** Vendored when the v1.1 buildout PR landed.
  Re-fetch with `bun run scripts/fetch-icons.ts` against the same branch
  to pull anything new (idempotent).
- **Licence:** original PNG assets remain © Coffee Stain Studios; we bundle
  under the Coffee Stain fan-content policy. The SatisfactoryTools project
  itself is MIT-licensed.
- **Item ID → filename mapping:** SF class names like `Desc_IronIngot_C`
  map to `desc-ironingot-c_64.png` in the source repo (lowercase, `_` →
  `-`, `_64.png` suffix). The fetch script normalises back to the SPECS
  class-name basename (`Desc_IronIngot_C.png`) on disk so the runtime
  `<Icon itemId>` primitive needs no mapping table.
- **Bundle path:** `src/assets/icons/satisfactory/*.png`. Vite's
  `import.meta.glob` picks them up at build time; nothing reaches the
  network at runtime.

**Icon picker tiles carry their name.** The picker grids on
`auto-fill, minmax(84px, 1fr)` with the item name captioned under each
thumbnail, not on a fixed column count with icon-only tiles. At the size a
tile can afford, several of the game's icons are near-indistinguishable —
Iron Plate against Reinforced Iron Plate is the standing example — so a
picker that shows only the art asks the player to guess and confirm. A
`title` tooltip doesn't rescue it: hover pays out one tile at a time, after
you've already decided where to point. Selected state is conveyed by more
than colour.

The About panel credits Coffee Stain Studios + SatisfactoryTools by name.
If Coffee Stain ever objects, swap to "extract from the player's local
install on first run". The `<Icon itemId="…" />` component abstracts the
source — only the glob path changes.

## Map view

The Map tab renders the bundled `src/assets/map/satisfactory-map.webp`
(2048×1981, ~325 KB) as a flat background with two layers on top:
node markers + draggable factory pins.

- **Node markers** are 6 px dots for unclaimed, 10 px for claimed.
  Purity colours: Pure `#facc15` (gold), Normal `#94a3b8` (silver),
  Impure `#b45309` (copper). Tooltip carries resource name + purity +
  current ipm when claimed.
- **Factory pins** are rounded chips with the factory's icon + name.
  The icon sits on a light `fg/20` disc — dark item renders (Modular
  Engine, coal) disappear straight onto the dark chip without it; the
  popover header uses the same disc. Drag-to-move writes straight to
  `factory.world_x/world_y` via the `set_factory_position` Tauri
  command — no intermediate buffer; the database is the source of
  truth.
- **Node data source:** the `nodes.json` catalog is derived from
  satisfactory-calculator.com's interactive-map JSON
  (`mapData/en-Stable.json`); per-purity counts + 3D coordinates for
  every ore, oil seep, fracking satellite, water well, nitrogen well,
  and geothermal vent. Credited in About.
- **Map image source:** community high-res game map (the same
  artwork SCIM uses, downsampled to 2048 px wide for bundle size).
  Used under Coffee Stain's fan-content policy.
- **Coordinate transform:** `src/features/map/transform.ts` maps
  in-game (x, y) to image pct. The world bounds are empirical
  approximations against the bundled catalog — if pins land
  off-target on the released map, tweak `WORLD_BOUNDS` rather than
  touching the renderer.
- **Factory links layer** (`MapLinksLayer`): every logistics link
  draws as one line per factory pair (items aggregate into a count
  chip; the tooltip lists them). With nothing selected the lines sit
  at 30% opacity; selecting a factory lights its lines (accent
  incoming, primary outgoing, arrowheads) and fades the rest to 8%.
  Toggleable via "Show factory links" (persisted).
- **Pin badges:** ⚡ top-right for power gear; a red top-left badge
  with a count + alert icon for unsourced inputs (colour is never the
  only signal — icon + tooltip ride along).
- **Drag-to-source:** the factory popover lists unsourced inputs
  with grab handles. Dragging one onto another pin assigns that
  factory as the source — same ghost-line gesture as node binding,
  green over a valid drop target. Self-drops are rejected.
- **Quick-create:** right-click anywhere (or arm the factory button
  in the zoom column) → click the spot → name → "Create" or "Create
  & plan" drops a pin at the cursor (and optionally opens the plan
  designer). Sketch the whole playthrough's factories first, plan
  each one later. Placement lives on the canvas only — the old
  header-level "New factory" button is gone.
- **Placement loadout:** a pill at the top-right of the canvas shows
  the miner mark + clock new claims use and the defaults for water
  extractor groups ("Mk2 @ 150.5% · 4× @ 100%"); clicking expands
  the editor card. Persisted globally, like the filters.
- **Water extractor groups:** extractors are free-placed in game, so
  they get their own marker instead of a node claim — the droplet
  button in the zoom column arms placement (the cursor becomes a
  droplet), one click drops a group with the loadout defaults. A
  group holds up to two banks ("40 @ 100% and 2 @ 45%"), shows its
  total m³/min, binds to a factory like a node claim, and feeds the
  same supply pool the planner and ledgers read. Groups start
  unlocked (drag moves them); the lock in the popover pins them in
  place, after which dragging starts the bind-to-factory gesture —
  the same ghost line nodes use. Bound groups follow the node
  visibility rule (hidden unless their factory is selected) with a
  "Show water extractors" toggle to force them all visible, and get
  the same detach button on their input line.
- **Ledger link supply:** every factory ledger row carries
  `fromLinksPerMinute` — what arrives via incoming logistics links —
  next to the node supply. The popover's raw-demand rollup subtracts
  it before tracing to raw, so a factory importing its Copper Ingot
  never reads as "ore missing", and the ledger table only paints a
  deficit red when links don't cover it.
- **Clock inputs:** every clock control pairs the slider (whole
  steps, coarse scrubbing) with a typed input where decimals are
  first-class — 100.01–250.00, matching the x100 storage precision.
  Sliders alone are banned; precision lives in the text field.
- **Node card placement:** the selected-node card renders beside the
  marker it describes, not in a dock — claiming is a pointing action,
  and a card across the canvas from the thing pointed at has to be
  re-verified every time. It flips to the other side of the pointer
  rather than clipping, and both boxes (card and viewport) are
  measured from the DOM: a card grows and shrinks with its conditional
  rows, so an assumed height puts the Claim button off-screen. When the
  camera moves itself to a node, the anchor is where that marker
  actually landed — the pan clamps to keep bare canvas out of frame, so
  a node near the world's edge doesn't end up centred and a card pinned
  to the middle would point at empty map.
- **A pre-filled default has to be defensible, or there shouldn't be
  one.** A fresh claim's factory is picked in falling order of how much
  the app actually knows: the factory whose card is open, the only
  factory there is, the nearest factory *that's currently short of this
  resource*, then the nearest factory of any kind. Need outranks
  distance because distance alone answers a question nobody asked —
  offering a copper plant for an iron node is confidently wrong, and a
  plausible wrong answer gets accepted without reading in a way that
  "— none —" never does. Where none of those rules applies (two
  factories, neither placed, neither short) the picker stays empty
  rather than pre-binding a coin toss dressed as a measurement. The
  shortfall this reads is the same one the factory card's "Claim a
  node" button is built on, so the default can't disagree with the
  number that sent the player here.
- **The open card's node ignores the filters.** Whatever is selected
  stays rendered even when a resource, purity or claimed-node filter
  would hide it. The alternative — switching filters off to make room —
  rewrites preferences the player set deliberately, and they persist,
  so a one-off action would permanently change the saved view.
- **Stacked markers:** markers hold a constant on-screen size while
  the gap between them grows with zoom, so a cluster separates by
  zooming in. Below the zoom that separates them the top marker is the
  only route to the ones it covers, so activating it again pages
  through the stack, and a pager above the card names the position
  ("2 of 3 nodes stacked here"). The pager sits outside the card,
  which is keyed by node id: inside it, paging would unmount the
  button being pressed.

  A cluster belongs to the *place*, not to the marker you happened to
  ask. Membership is transitive — A covers B and B covers C without A
  covering C, and all three are one pile — so every member sees the
  same list in the same order. Built the other way, as "what overlaps
  this one", the count changes as you page, paging wanders into
  markers that were never in the pile, and the far members become
  unreachable: they can't be clicked either, because something is
  covering them.
- **Marker naming:** the accessible name describes the node (resource,
  purity, rate, coordinates, claim state) and stops there. Gesture
  hints — "click to bind or drag onto a factory" — live in `title`
  only: a name is re-announced on every focus pass, and click/drag
  name gestures a keyboard user doesn't have. Markers activate on
  Enter and Space, and Escape closes any open map card.

## Factory editor

There's one factory editor: the production plan designer below. The old
standalone "detail" view — a built-machines `@xyflow/react` graph with inline
machine editing — is gone, and every factory click (factories list, Home,
Network, Map pin, Space Elevator, validation findings) opens the designer
instead. The three things that pane uniquely offered now live in the designer's
header:

- **Ledger** toggle → left panel with the per-item current-flow table
  (`FactoryLedgerTable` over `factory_ledger`): produced vs consumed vs net for
  the machines actually built.
- **Add machine** toggle → left panel with `AddMachineForm` to add a machine by
  hand, outside the plan. Hand-added machines coexist with plan-materialised ones
  (`plan_node_key = NULL`).
- **Add power** toggle → left panel with this factory's generated / consumed /
  net figures and a form to add generators. It sits beside the ledger and
  add-machine panels rather than navigating away: the draw it balances against
  is already printed in the same header, so leaving the factory to act on it
  loses the number you came for. The whole-grid view stays one ghost button
  away, and the panel is the only route to power in a popped-out factory
  window, which has no app nav to jump to.

## Production plan designer

Factory design is outcome-first: the user names what the factory
should make ("60/min Cable", plus any other products) and the app
computes the whole production graph back to raw. The designer is a
**full-screen surface** (route `plan`) opened from anywhere a factory
is clicked — the sidebar hides, a back button returns to where the
user came from. The word "derive" never
appears in the UI; the feature is the **Production plan**, compute
is automatic on every edit, and the only verb is **Save plan**.

Layout, top to bottom:

1. **Header bar** — back button, factory name, targets strip
   (chip per product: icon + name + inline ipm input + remove,
   plus "Add product" backed by the tier-grouped item
   `FilterSelect`), totals, Save plan button
   (primary; dirty-state dot when unsaved edits exist).
   Totals read `N machines + M extractors · X MW`: the MW figure
   includes the factory's bound extractors, so the count names them
   too rather than letting the two numbers count different sets.
   The extractor half only appears when there are any, and the
   machine/extractor MW split sits in the tooltip.
2. **Sink strip** — raised strip naming what the plan throws away
   (`Sinking 145.5/min Petroleum Coke`), biggest first. In an oil
   plan, how much is being sunk is the number that separates a
   balanced refinery from one burning a third of its throughput, and
   it must not require finding a node on the canvas. Neutral card
   with an amber `Recycle` label, deliberately not the warnings
   banner's amber wash — sinking surplus is a fact about the plan,
   not a gap to close.
3. **Warnings banner** — amber strip listing supply gaps,
   unsourced inputs, cap shortfalls, and steps that need a tier the
   playthrough hasn't reached. Warn, don't block: the
   plan still renders and still saves.
4. **Canvas** — `@xyflow/react` + dagre (LR), one node per item.

Node cards (all 250 px wide, `tabular-nums` for rates):

- **Step** (`recipe:*` keys) — neutral card: item icon + name,
  `count× Building @ clock%`, MW, out-rate. EVERY step carries the
  recipe `FilterSelect` (standard + unlocked alts; Unpackage
  filtered) so any link in the chain re-recipes in place — node
  keys are item-based so the card keeps its position. Recipe
  options carry an `io` payload, so the dropdown reads like the
  in-game build menu: a second line per option with input icons +
  rates `→` output icons + rates (per machine at 100% clock,
  wrapping for 4-input Manufacturer alts; the panel widens to
  32rem when any option has the strip). The same strip shows in
  the factory graph's machine editor picker. Footer:
  **Sources** (opens the sources panel) and **Export** (offers the
  item to other factories — see exports below). Product steps get a
  primary border + `Product` badge and edit their export slice
  inline.
- **Input** (`import:*`) — accent-bordered card for the item share
  that arrives from other factories. Lists each allocation
  (factory + ipm); unassigned demand shows the amber **Unsourced**
  badge ("a future factory will supply this") — a fully valid,
  saveable state. An item can be **mixed**: external sources absorb
  up to their caps and the local line elastically builds the
  remainder (a self-source row marks "build it here"). Removing the
  local source makes it a full import; "Build it here too" brings
  it back.
- **Sources panel** — docked right of the canvas per item: the
  local line ("Build it here", with a rate field that pins how much
  to build locally; empty = elastic remainder), external rows
  (cap-editable, each with the source factory's icon and what the
  last solve actually pulled from it), and a searchable add-list in
  four named groups: factories whose remaining export covers the
  whole need, factories that make it but haven't opened an export
  slice, factories that make it but not enough, and everyone else
  ("plan it there later"). Making the item is what earns a place in
  the list, not declaring an export — a factory with the item fully
  spare is a source you can have, and filing it under "plan it
  there later" hides a working flow behind a screen nobody has a
  reason to open. Remaining capacity = export − what others already
  draw; 0 stays selectable.
  Every row carries the way through with it. A factory that makes
  enough and exports none offers **Export it**: one click opens the
  slice and takes the source, no extra machines. One that would have
  to build more offers **Raise target**. A source already in the list
  gets the same affordance on its own row, asking for what it sends
  now plus the whole uncovered gap (raising any one short source
  closes it, so rows don't each ask for a share), and it lifts its
  own cap when the cap is what's binding. Gaps under 0.05/min are
  never mentioned, because they print as "0.0/min" and read as a
  warning about nothing.
  Each raise reports what it cost the exporter, wording a gap it
  opened differently from one it merely widened, and a collapsed
  tally holds the running cost of every raise in the session —
  after five of them that total otherwise only exists on the
  Validate screen. Accounting, never cascading edits: what closes an
  upstream gap is the user's call.
  An uncapped source only delivers what its plan
  actually offers — picking a factory that exports nothing leaves
  production local instead of tearing the local line to zero. An
  explicit cap is the user's override and wins regardless.
  "A future factory" stays available for fully unsourced inputs.
- **Exports** — a target's `export_ipm` is the slice offered to
  other factories ("produce 500, export 300, keep 200"). The Export
  button on any step adds the item as a product at its current
  rate; the slice is editable inline on the node and shows as an ↗
  badge on the product chip.
- **Raw** (`raw:*`) — leaf card for mined/pumped items: demand vs
  claimed-node supply, success tone when covered, danger + icon
  when short.
- **Byproduct** (`byproduct:*`) — sink card for surplus outputs
  nobody consumes (no netting in v1; honesty over magic). Warning
  tone, heavier dashed border, `Recycle` glyph, full-strength item
  name and rate: sunk output is throughput the factory is paying
  for and discarding, so it's never the quietest card on the
  canvas. A fluid surplus takes the danger tone instead — it can't
  be sunk at all.

The graph is computed by an **optimizer**, not a top-down recipe
walk: a small linear program picks the recipe mix that minimises
rarity-weighted raw consumption (weights = the whole map's yield per
resource at a fixed Mk3 @ 100% basis, iron ≈ 1.0; water is treated
as nearly free because extractors aren't node-bound). Byproducts net
against demand inside the balance constraints, so recycling loops
(scrap water back into alumina) and partial byproduct coverage
(silica from the alumina refinery topped up from quartz) come out
the way satisfactorytools renders them. Solid surplus goes to a
"Byproduct → sink" card; a fluid surplus has no sink in game, so its
card goes red and a warning names the stalled liquid. Recipe pins
still hold (a pinned item excludes other primary producers), and if
the solver fails or blows its time budget (2 s, tunable via the
`specs:solver:budget-ms` localStorage key until a settings page
exists) the greedy single-recipe chain renders instead, with a
banner line saying so.

Tier gating follows the **whole input chain**, never a recipe's own
`unlock_tier`: a recipe stamped Tier 5 whose ingredients don't ground
out until Tier 7 is a Tier 7 recipe. The optimizer's candidates are
gated on it, so a Tier 6 plan can't be handed a Tier 7 chain, and
the product picker groups on it, so a product's heading is the tier
it can really be made at (`Tier 7 — not unlocked yet` above the
playthrough's tier, with an `above your tier` hint). Products above
tier stay pickable (planning the endgame backwards is the point),
and the plan then carries an above-tier warning naming the tier it
needs and the steps that are out of reach. Alts count as available
at their own unlock tier, matching how the planner already plans
with alts before they're collected.

Rate fields accept fractions (`step="any"`): 2.5/min Computers and
37.5/min Screws are ordinary targets, and a whole-number step makes
the browser cancel the submit before any handler runs — a dialog
that silently refuses to close. Forms carrying a rate set
`noValidate` and own the check themselves, so a rejected value
always comes with a message.

Each plan has a **SAM** toggle in the header
(persisted in `factory_plan_option`): off by default, it removes
recipes whose chain needs SAM; a product that can only be made with
SAM forces it on and disables the switch (the 1.2 dataset carries
the full SAM/converter chain, so the gate is live).

Edges carry the item name + ipm as their label; items with several
producers emit a proportional edge from each (local lines, imports,
byproduct flows alike). A byproduct feeding back into the chain is a
**reuse** line: amber stroke and a "(reuse)" label suffix, because
piping those wrong is exactly how a line stalls — they must not read
like ordinary flows. Node
drags persist to `factory_plan_layout` (sparse; missing row = dagre
position). **The camera never moves on its own** — no fit/zoom/pan
on click or recompute; `Auto-arrange` is the explicit button that
re-runs the layout (and refits, since the user asked). Selection
survives recompute too: when an edit swaps an item's node kind
(recipe ↔ import), the selection follows the item instead of
silently clearing. Plans
**auto-save** once edits settle, and Back flushes any remainder —
leaving the designer can't lose work. Saving runs in one
transaction: plan inputs persist, the graph recomputes server-side,
plan-managed machines regenerate (manual machines survive via
`plan_node_key IS NULL`), and sourced inputs become logistics links
(self rows never do — they're the local-production marker).

**A saved plan keeps the recipes it was saved with.** The recipe each
step landed on is written back with the plan, so every later solve
rebuilds the same sheet. This matters because the pool the solver may
choose from widens on its own as the playthrough reaches new tiers,
and plenty of saves happen to a factory the player isn't looking at —
raising an exporter's target from someone else's Sources panel, or
dropping an unsourced input onto a pin. A plan is a build sheet for
machines already standing in the game, so a better plan arriving that
way puts the app and the factory quietly out of step with no record of
what moved. Collecting alts changes none of this. The checklist is an
inventory of hard drives; plans are computed against every alt
*reachable* at the current tier, and an uncollected one comes back as a
shopping-list note beside the graph.

**Re-optimize** is the only way in to a redesign, so it's always
available; a plan that already holds recipes is exactly the plan worth
re-solving, and a disabled button there leaves the player nothing to
press. It names the tier it would solve against rather than a count of
recipes, because "drops your 4 pinned recipes" reads as a threat to work
the player did when most of those recipes were the solver's own choice
and they pinned nothing. The confirmation says what can move — the
recipes, plus the imports and links a recipe change drags with them —
and an Undo rides the save.

**A plan save carries a link forward; it never rebuilds one.** The
transport kind, the plan under it, the notes beside it and the train it
rides are answers only the player can give, and a save that regenerated
the link row would quietly reset all four, on a re-optimize and on any
ordinary edit that re-saves the plan. A route still in the plan keeps its
link row and its id (a train route attaches by that id), and only the
throughput and the map-measured distance are restated. That's what lets
the Undo mean what it says: put the recipes back and the factory is as
it was. The one thing it can't return is a route the new recipes stopped
needing — that link is gone, and undoing brings the route back as a
plain belt. Both confirmations say so, because a partial undo the player
doesn't know is partial is worse than no undo: it removes the reason to
be careful.

The offer that sends people there lives on **Home**, under the tier
picker, since reaching a tier is what makes a better plan possible.
Every factory it names carries both sides of its machine and power
figures and the recipes that would swap. Applying is per factory,
because the whole point is being able to redesign the new plant and
leave the one already standing in the game alone.

**Both re-optimizes carry the same guard rails, because they are the
same act.** Neither is a redesign one click can reach, and both leave an
Undo on screen afterwards. Home's needs them more if anything: the
designer's edits a draft that still has to be saved, where Home's writes
the plan the moment it's confirmed, and its confirmation says as much.
Its Undo puts back the recipes the re-solve dropped rather than solving
again, since solving again is what produced the plan being undone.
Guard rails belong to the action, not to the screen it was pressed
from. Give one surface a cheaper version and that surface becomes the
way to redesign a factory by accident.

The header edits the factory in place: click the name to rename,
the icon to open the icon picker, the trash to delete (the
confirmation lists factories that currently draw inputs from this
one). New factories place-first on the map (canvas arm button or
right-click → click the spot → name → straight into the designer).

**Anywhere the player types a map position, they type the coordinates
the app already shows them.** Positions are stored in Unreal `cm`, and
that unit appears nowhere in the UI: a distance box in kilometres and a
compass select, echoing back the same `1.9km W · 1.2km N` string the map
and the resource rows print. Labelling a raw `World X` field with its
unit would make it legible but still unusable — the number the player
holds comes off a map pin, and there's no path from that to a cm value
without doing arithmetic in your head. Direction lives in the compass select and only
there, so a stray minus sign can't silently mirror a factory across the
map.
An empty plan — first run, or after clearing every product — shows
a centered modal: large title, icon preview that fills in as you
pick, the tier-grouped product `FilterSelect`, a big rate field,
primary **OK**, and a red **Cancel & delete this factory** (worded
"Delete this factory" once the factory has history). The first
product stamps the factory icon when none is set. Destructive
buttons use the Button `danger`/`danger-solid` variants — never
`text-danger` layered onto ghost, which loses the stylesheet-order
coin-toss against the variant's own text colour.

The legacy "Build to target" panel, the stage-list preview, and the
cross-factory Planner wizard are retired; manual "Add machine"
remains available behind a disclosure on factory detail for legacy
factories.

## Validate playthrough

The header's Validate button (ShieldCheck icon, next to the
playthrough switcher, disabled with no playthrough open) opens a
right-hand slide-over (`max-w-xl`, backdrop `bg-black/40`) that runs
the whole-playthrough sweep on mount. Presentation rules:

- Summary chips up top: error count in a `danger` pill, warning count
  in a `warning` pill, note count in a `primary` pill, current tier in
  a neutral pill, then the grid one-liner (danger-toned when net is
  negative). All three counts carry colour, icon and label together —
  `CircleAlert`, `TriangleAlert`, `Info`. The tier chip stays bare on
  purpose: it's metadata rather than a status, and the icon is what
  separates them rather than a font weight.
- Findings group under four sentence-case headings: "Above your
  tier", "Cross-factory flows", "Supply & power", "Alts you haven't
  collected". Rows are `bg-bg-raised` cards with a severity icon
  (CircleAlert danger / TriangleAlert warning / Info note); clickable
  rows deep-link to the owning view and close the panel.
- **Three severities, and the third one earns its place.** A note is
  something true the player should know that no action of theirs will
  ever retire. Two shapes qualify: nothing to fix (a hand-fed Biomass
  Burner has no node to claim, so counting it as a shortfall is an
  accusation the player can never answer), and nothing the app can see
  fixed (a segment carrying 280/min is four parallel belts, which is
  ordinary play, and laying them leaves it reading 280/min). Notes
  stay out of the error and warning counts, and the panel keeps its
  all-clear with the notes listed underneath, phrased as facts rather
  than demands: "needs 3 belts at Mk.2", never "or an underclock". A
  note that does describe an action has to describe one the player can
  actually take — Liquid Biofuel arrives by pipe, so the row names the
  hand-gathering at the root of its chain instead of telling anyone to
  hand-feed a fluid. Anything the player can fix *and the app then
  reads as fixed* stays a warning: a miner clocked past its single
  output port is unbuildable, and the warning clears the moment the
  claim's clock comes down. Softening a warning to a note to reach a
  clean sweep is the failure this level exists to prevent.
- **One port is one belt, wherever the port is.** The aggregate/single
  split is about how many ports the flow leaves through, not about
  extractors versus machines. A machine has one output port per item
  it makes, exactly as a miner does, and a splitter after either only
  divides what already came through. So a bank's rate divided by its
  machine count, above the best carrier unlocked, warns and names the
  two moves that exist — clock it down, or spread the same output over
  more machines — instead of a belt count. Several recipes reach that
  from one machine at stock clock: Biomass (Wood) is 300/min against
  Tier 0's 60/min belt. What's left for the note is flow that
  genuinely does leave through several ports and merge. The warning's
  unit is the producing node, never the segment, because one machine
  feeding two consumers splits into two under-cap segments while its
  single port still carries the sum.
- The hard-drive shopping list is its own warning-tinted card above
  the categories — it's the actionable output, not just another
  finding row.
- Validation reports, never blocks: nothing in the panel disables
  editing anywhere. Pairs with the planner rule that recipe pickers
  offer every tier-reachable alt, suffixing uncollected ones with
  "· not collected".

## Launch, app icon & window

- **App icon** is the Hexgauge mark — a gauge needle buried near the
  redline inside a hex-nut outline, signal cyan on `#1a1a1a`, with a
  ~9% transparent margin so the macOS dock size matches its
  neighbours. `app-icon.svg` at the repo root is the source of
  truth; rasterise to `app-icon.png` (1024², transparent corners)
  and run `bun run tauri icon app-icon.png` to regenerate
  `src-tauri/icons` (the ios/android outputs are deleted — no
  mobile targets).
- **Splash:** `index.html` ships a static splash (the Hexgauge mark
  + "Loading" with cycling dots) so launch never flashes white in
  dark mode. Theme comes from the stored `specs.theme-mode`,
  mirrored onto `<html>` by `public/splash.js` before first paint,
  with `prefers-color-scheme` as the fallback. The script is a
  separate file because the production CSP is `script-src 'self'`
  — inline scripts never run there. The window itself paints
  `#1a1a1a` (`backgroundColor` in `tauri.conf.json`) before the
  webview loads, and `main.tsx` fades the splash out once React
  mounts.
- **Window state:** `tauri-plugin-window-state` restores size,
  position and maximized/fullscreen across launches. Minimized is
  never recorded as a state, so closing a minimized window restores
  the last real geometry.

## Accessibility

- Every text/background pair WCAG AA verified before committing a token change.
  A spot-check helper script lives at `scripts/check-contrast.ts` _(planned)_.
- **Text on a coloured fill picks its colour per token, never `text-white`
  by default.** `primary` and `success` invert between modes (dark on light
  mode, bright on dark mode), so text on those fills must be `text-bg`, which
  inverts with them — white on dark-mode `success` (`#4ADE80`) is about 1.7:1.
  `accent` is a dark blue in *both* modes, so it keeps `text-white`. A single
  token across every fill always fails one of them.
- Focus is never left on `document.body`. A floating card takes focus on open
  and returns it to the control that opened it on close; anything that
  remounts mid-interaction keeps its controls outside the remounting subtree.
- Motion that moves the viewport or loops (camera flights, pulsing rings) is
  guarded by `prefers-reduced-motion` — `motion-safe:` for CSS animation, a
  zero duration for scripted transforms.
- `*:focus-visible` shows a 2px primary outline with 2px offset.
- Never colour-only signalling. Every red gets an icon. Every dashed edge gets
  a tooltip. Every status badge has both colour + icon + label.

## Reference screenshots

Light + dark reference screenshots at 1280×800 live under `docs/screens/`
_(added in the branding pass, Phase 11 of the build plan)_. Run them past your
eyes whenever you change anything visual.
