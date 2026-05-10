# Worked example — `health` slice (React)

The frontend half of the `health` slice. Pairs with
[`../rust/examples.md`](../rust/examples.md). It renders a small badge in the
app shell that proves the Rust core is reachable.

## Files

- [`src/features/health/api.ts`](../../../src/features/health/api.ts)
- [`src/features/health/types.ts`](../../../src/features/health/types.ts)
- [`src/features/health/hooks/useHealth.ts`](../../../src/features/health/hooks/useHealth.ts)
- [`src/features/health/components/HealthBadge.tsx`](../../../src/features/health/components/HealthBadge.tsx)
- [`src/features/health/README.md`](../../../src/features/health/README.md)

## What it does

`useHealth()` calls `invoke("health_check")`, caches the result via TanStack
Query, and surfaces `{ data, isPending, isError }` to consumers. `HealthBadge`
renders the three states using the shared `Badge` primitive.

## What to copy from it

- `api.ts` shape — a single object exporting one function per command.
- `types.ts` shape — flat interface mirroring the Rust DTO (camelCase).
- `hooks/useHealth.ts` shape — `useQuery({ queryKey, queryFn })`.
- `components/HealthBadge.tsx` shape — three visual states (loading, error,
  ok), each with an icon + label, never colour-only.

## Where it plugs in

`AppShell` imports `HealthBadge` directly:
```tsx
import { HealthBadge } from "@/features/health/components/HealthBadge";
```

That's the only place the slice is consumed. Adding it to a different surface
later is a one-line import — the slice has no internal coupling to the shell.
