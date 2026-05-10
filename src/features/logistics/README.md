# Logistics slice (frontend)

Pairs with `src-tauri/src/features/logistics/`. Phase 5 fills in:

- `hooks/useLogisticsLinks.ts` — TanStack Query wrappers (list / get / create / update / delete).
- `hooks/usePlanLogistics.ts` — pulls ranked transport plans from the Rust planner for a given (item, ipm, distance) input.
- `components/LogisticsLinkEditor.tsx` — modal that opens from a graph edge or a factory detail row.
- `components/TransportPlanPicker.tsx` — renders the ranked plans, shows utilisation %, greys out plans behind a higher milestone tier, and lets the user pick one to persist on the link.

The shell here keeps imports stable so Phase 5 work can grow against
`logisticsApi.*` and `LogisticsLink` without churning import paths.
