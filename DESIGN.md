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
  Drag-to-move writes straight to `factory.world_x/world_y` via the
  `set_factory_position` Tauri command — no intermediate buffer; the
  database is the source of truth.
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
- **Quick-create:** right-click anywhere → name → "Create" or
  "Create & plan" drops a pin at the cursor (and optionally opens
  the plan designer). Sketch the whole playthrough's factories
  first, plan each one later.

## Factory graph view

Factory detail no longer renders machines as a table — the canonical
view is an `@xyflow/react` graph laid out with `dagre` (LR rank
direction, 240×110 px cards, 80 px rank gap). Drag persists per
machine via a new `factory_machine_layout` table so the user's
nudges survive reloads. Edges are heuristically drawn between any
two machines whose recipes share an input/output item; they animate
to convey flow direction. This is a stand-in for true machine-to-
machine routing (factories currently only model bulk inputs/outputs
at their boundaries) and will tighten when that lands.

**Inline machine editing.** The pencil on a node card flips it into
expanded mode (320 px wide, no overlay) with: recipe `FilterSelect`
filtered to recipes for the same `building_id` so a swap never
violates the backend's `recipe.building_id != building_id` check;
count `±` stepper; clock slider + numeric input capped by
`clockCapForShards`; somersloop stepper bounded by
`ampSlotsForBuilding`; power-shard stepper (0–3). When the user
enters edit mode the canvas refits (`useReactFlow().fitView()` after
a `requestAnimationFrame`) so the larger card doesn't spill off the
visible area. Save/Cancel buttons in-card; every save pushes through
`useUndoStore` so a single ⌘Z restores the prior state.

## Production plan designer

Factory design is outcome-first: the user names what the factory
should make ("60/min Cable", plus any other products) and the app
computes the whole production graph back to raw. The designer is a
**full-screen surface** (route `plan`) opened from factory detail,
the factories list, or a map pin — the sidebar hides, a back button
returns to where the user came from. The word "derive" never
appears in the UI; the feature is the **Production plan**, compute
is automatic on every edit, and the only verb is **Save plan**.

Layout, top to bottom:

1. **Header bar** — back button, factory name, targets strip
   (chip per product: icon + name + inline ipm input + remove,
   plus "Add product" backed by the tier-grouped item
   `FilterSelect`), totals (`N machines · X MW`), Save plan button
   (primary; dirty-state dot when unsaved edits exist).
2. **Warnings banner** — amber strip listing supply gaps,
   unsourced inputs and cap shortfalls. Warn, don't block: the
   plan still renders and still saves.
3. **Canvas** — `@xyflow/react` + dagre (LR), one node per item.

Node cards (all 250 px wide, `tabular-nums` for rates):

- **Step** (`recipe:*` keys) — neutral card: item icon + name,
  `count× Building @ clock%`, MW, out-rate. A recipe `FilterSelect`
  (standard + unlocked alts producing that item; Unpackage filtered)
  swaps the recipe in place — node keys are item-based so the card
  keeps its position. Footer action: **Supply from elsewhere**,
  which collapses the upstream subtree into an Input node. Target
  steps get a primary-coloured border + a `Target` badge.
- **Input** (`import:*`) — accent-bordered card for items that
  arrive from another factory. Lists each assigned source (factory
  `FilterSelect` + optional ipm cap) and the demand it covers. With
  no source it shows an amber **Unsourced** badge ("a future
  factory will supply this") — a fully valid, saveable state; the
  whole point of planning the endgame backwards. Footer action:
  **Build it here** (removes the cut, the subtree re-expands).
- **Raw** (`raw:*`) — leaf card for mined/pumped items: demand vs
  claimed-node supply, success tone when covered, danger + icon
  when short.
- **Byproduct** (`byproduct:*`) — muted sink card for surplus
  outputs nobody consumes (no netting in v1; honesty over magic).

Edges carry the item name + ipm as their label. Node drags persist
to `factory_plan_layout` (sparse; missing row = dagre position).
Saving runs everything in one transaction: plan inputs persist, the
graph recomputes server-side, plan-managed machines regenerate
(manual machines survive via `plan_node_key IS NULL`), sourced
inputs become logistics links, and the action lands on the undo
stack as one group.

The legacy "Build to target" panel, the stage-list preview, and the
cross-factory Planner wizard are retired; manual "Add machine"
remains available behind a disclosure on factory detail for legacy
factories.

## Accessibility

- Every text/background pair WCAG AA verified before committing a token change.
  A spot-check helper script lives at `scripts/check-contrast.ts` _(planned)_.
- `*:focus-visible` shows a 2px primary outline with 2px offset.
- Never colour-only signalling. Every red gets an icon. Every dashed edge gets
  a tooltip. Every status badge has both colour + icon + label.

## Reference screenshots

Light + dark reference screenshots at 1280×800 live under `docs/screens/`
_(added in the branding pass, Phase 11 of the build plan)_. Run them past your
eyes whenever you change anything visual.
