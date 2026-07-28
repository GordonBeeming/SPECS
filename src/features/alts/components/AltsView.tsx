import { useMemo, useState } from "react";
import { CheckSquare, Search, Square } from "lucide-react";

import { TierBadge } from "@/features/library/components/TierBadge";
import { useRecipes } from "@/features/library/hooks/useLibrary";
import type { Recipe } from "@/features/library/types";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { Icon } from "@/shared/ui/Icon";

import { useSetAlts, useToggleAlt, useUnlockedAlts } from "../hooks/useAlts";

/** Every tier the game gates alt recipes by, for the tier filter dropdown. */
const TIER_FILTER_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
  value: String(i),
  label: `Tier ${i}`,
}));

/**
 * Alts checklist. Lists every recipe with `isAlt = true` from bundled
 * game data and renders a checkbox per row; toggling persists through
 * `toggle_alt_recipe`. Filters by name and, separately, by exact tier —
 * text search alone can't answer "show me only T2" since the tier only
 * appears in body text, not the recipe name (#71). Rows group under a
 * tier header, mirroring the plan designer's product picker so the same
 * question ("what's reachable right now?") reads the same way on both
 * screens (#60).
 */
export function AltsView() {
  const playthrough = useCurrentPlaythrough();
  const recipes = useRecipes();
  const unlocked = useUnlockedAlts();
  const toggle = useToggleAlt();
  const setAlts = useSetAlts();
  const [filter, setFilter] = useState("");
  const [tierFilter, setTierFilter] = useState<string | null>(null);

  const alts = useMemo(() => {
    return (recipes.data ?? [])
      .filter((r) => r.isAlt)
      .filter((r) =>
        filter.trim() === ""
          ? true
          : r.name.toLowerCase().includes(filter.trim().toLowerCase()),
      )
      .filter((r) => tierFilter === null || r.unlockTier === Number(tierFilter))
      // Tier first so the grouped headers below come out in tier order;
      // name within a tier for a stable, scannable sub-order.
      .sort((a, b) => (a.unlockTier === b.unlockTier ? a.name.localeCompare(b.name) : a.unlockTier - b.unlockTier));
  }, [recipes.data, filter, tierFilter]);

  // Group the already tier-sorted list into per-tier buckets for the
  // headered rendering below — same shape as `buildTargetOptions`'
  // "TIER 0" / "TIER 2" headers in the product picker.
  const groups = useMemo(() => {
    const byTier = new Map<number, typeof alts>();
    for (const r of alts) {
      const bucket = byTier.get(r.unlockTier);
      if (bucket) bucket.push(r);
      else byTier.set(r.unlockTier, [r]);
    }
    return [...byTier.entries()].sort(([a], [b]) => a - b);
  }, [alts]);

  // Drive the Select all / none disabled states off the visible (filtered) rows.
  // Until the unlocked-alts query has loaded, both stay disabled: acting on an
  // empty fallback set would mark every visible recipe as "changed" and push a
  // bogus entry onto the undo stack (an undo would then lock already-unlocked
  // alts).
  const unlockedReady = unlocked.data !== undefined;
  const unlockedSet = unlocked.data ?? new Set<string>();
  const allVisibleUnlocked =
    !unlockedReady || alts.length === 0 || alts.every((r) => unlockedSet.has(r.id));
  const noneVisibleUnlocked =
    !unlockedReady || alts.length === 0 || alts.every((r) => !unlockedSet.has(r.id));

  // "Select all" deliberately reaches above tier too (warn, don't block —
  // someone may really have the hard drive early). But every tier group in
  // the recorded playthrough has wanted the narrower action instead: only
  // the alts actually reachable right now, without also pulling in the
  // next tier's alts sitting in the same filtered list (#97).
  const currentTier = playthrough.data?.currentTier ?? 0;
  const reachableAlts = useMemo(
    () => alts.filter((r) => r.unlockTier <= currentTier),
    [alts, currentTier],
  );
  const allReachableUnlocked =
    !unlockedReady || reachableAlts.length === 0 || reachableAlts.every((r) => unlockedSet.has(r.id));

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Alt recipes</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to track Hard Drive
          alternates.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-primary">Alt recipes</h1>
          <p className="text-xs text-fg-muted">
            {playthrough.data.displayName} · T{playthrough.data.currentTier}
            {unlocked.data ? ` · ${unlocked.data.size} unlocked` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() =>
              setAlts.mutate({
                recipeIds: reachableAlts.map((r) => r.id),
                unlocked: true,
                currentlyUnlocked: unlocked.data ?? new Set(),
              })
            }
            disabled={allReachableUnlocked}
            title={
              filter.trim()
                ? `Unlock every alt matching the filter that's reachable at T${currentTier}`
                : `Unlock every alt reachable at T${currentTier} (leaves later-tier alts alone)`
            }
            className="px-2.5 py-1.5 text-xs"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            Select reachable
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setAlts.mutate({
                recipeIds: alts.map((r) => r.id),
                unlocked: true,
                currentlyUnlocked: unlocked.data ?? new Set(),
              })
            }
            disabled={allVisibleUnlocked}
            title={filter.trim() ? "Unlock every alt matching the filter" : "Unlock every alt"}
            className="px-2.5 py-1.5 text-xs"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            Select all
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setAlts.mutate({
                recipeIds: alts.map((r) => r.id),
                unlocked: false,
                currentlyUnlocked: unlocked.data ?? new Set(),
              })
            }
            disabled={noneVisibleUnlocked}
            title={filter.trim() ? "Lock every alt matching the filter" : "Lock every alt"}
            className="px-2.5 py-1.5 text-xs"
          >
            <Square className="h-3.5 w-3.5" />
            Select none
          </Button>
          <div className="w-32">
            <FilterSelect
              ariaLabel="Filter alts by tier"
              compact
              placeholder="All tiers"
              value={tierFilter}
              onChange={setTierFilter}
              options={TIER_FILTER_OPTIONS}
            />
          </div>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
            <input
              type="search"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 w-48 rounded-md border border-border bg-bg pl-7 pr-2 text-sm text-fg outline-none focus:border-primary"
            />
          </label>
        </div>
      </div>

      {recipes.isPending && <div className="text-sm text-fg-muted">Loading…</div>}
      {recipes.data && alts.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
          {filter.trim() === "" && tierFilter === null
            ? "No alt recipes in the bundled dataset yet."
            : tierFilter !== null
              ? `No alts unlock at Tier ${tierFilter}${filter.trim() ? " matching that filter" : ""}.`
              : "No alts match that filter."}
        </div>
      )}
      {groups.length > 0 && (
        <div className="flex flex-col gap-4">
          {groups.map(([tier, rows]) => {
            const tierAboveCurrent = tier > currentTier;
            return (
              <div key={tier}>
                <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                  {/* Reuses the Library tables' own tier indicator (#60)
                      rather than a second "not unlocked yet" label. */}
                  <TierBadge unlockTier={tier} />
                </div>
                <ul className="flex flex-col divide-y divide-border">
                  {rows.map((r) => (
                    <AltRow
                      key={r.id}
                      recipe={r}
                      isUnlocked={unlocked.data?.has(r.id) ?? false}
                      aboveTier={tierAboveCurrent}
                      onToggle={(next) => toggle.mutate({ recipeId: r.id, unlocked: next })}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AltRow({
  recipe: r,
  isUnlocked,
  aboveTier,
  onToggle,
}: {
  recipe: Recipe;
  isUnlocked: boolean;
  aboveTier: boolean;
  onToggle: (next: boolean) => void;
}) {
  // The screen deliberately doesn't block ticking an above-tier alt
  // (warn, don't block — someone may really have found the hard drive
  // early), but the pre-fix state was silent about it. Validate now
  // flags it too (`UnlockedAltAboveTier`) — the row tint below is the
  // up-front half of that fix, so ticking one is never a silent
  // surprise. A row that's above tier and *not* ticked gets a quieter
  // dimmed treatment instead — "you can't reach this yet" rather than
  // "you did something unusual" — so the two above-tier states read
  // differently at a glance. The tier itself is already named once, on
  // the group header directly above (`TierBadge`, shared with the
  // Library tables) — repeating it per row would just be noise, so the
  // row's own signal is this tint, not a second badge.
  return (
    <li
      className={`flex items-center gap-3 py-2 ${
        isUnlocked && aboveTier
          ? "rounded-md border border-warning/30 bg-warning/5 px-2"
          : aboveTier
            ? "opacity-60"
            : ""
      }`}
    >
      <input
        id={`alt-${r.id}`}
        type="checkbox"
        checked={isUnlocked}
        onChange={(e) => onToggle(e.target.checked)}
        className="h-4 w-4 rounded border-border"
      />
      <label htmlFor={`alt-${r.id}`} className="flex flex-1 cursor-pointer items-center gap-3">
        {/* The first output's item icon doubles as the recipe
            glyph — most alt recipes are named after their
            primary output ("Pure Iron Ingot" → iron ingot icon). */}
        <Icon itemId={r.outputs[0]?.itemId ?? r.id} alt={r.name} className="h-7 w-7" />
        <div>
          <div className="text-sm font-medium text-fg">{r.name}</div>
          <div className="text-xs text-fg-muted">{r.id}</div>
        </div>
      </label>
    </li>
  );
}
