# Space Elevator slice (frontend)

Pairs with `src-tauri/src/features/elevator/`. Renders the "Space Elevator"
sidebar tab: every Project Assembly phase, what each one needs delivered, and
how that lines up with your current production.

- `api.ts` / `types.ts` — `elevatorApi.overview()` and the DTO mirror.
- `hooks/useElevatorOverview.ts` — TanStack Query wrapper, gated on (and keyed
  by) the active playthrough.
- `components/SpaceElevatorView.tsx` — phase cards with a per-part row (icon,
  required quantity, current rate, status). Future phases are greyed out based
  on the playthrough's current tier. Expanding a part lists the factories
  making it, splitting each factory's output into used-here / shipped-out /
  free; clicking a factory deep-links to it via the nav store.
