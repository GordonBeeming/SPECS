import { useMemo, useState } from "react";
import { CheckSquare, Search, Square } from "lucide-react";

import { useRecipes } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";

import { useSetAlts, useToggleAlt, useUnlockedAlts } from "../hooks/useAlts";

/**
 * Alts checklist. Lists every recipe with `isAlt = true` from bundled
 * game data and renders a checkbox per row; toggling persists through
 * `toggle_alt_recipe`. Filters by name to keep the list scannable when
 * the dataset grows past a couple hundred alts.
 */
export function AltsView() {
  const playthrough = useCurrentPlaythrough();
  const recipes = useRecipes();
  const unlocked = useUnlockedAlts();
  const toggle = useToggleAlt();
  const setAlts = useSetAlts();
  const [filter, setFilter] = useState("");

  const alts = useMemo(() => {
    return (recipes.data ?? [])
      .filter((r) => r.isAlt)
      .filter((r) =>
        filter.trim() === ""
          ? true
          : r.name.toLowerCase().includes(filter.trim().toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [recipes.data, filter]);

  // Drive the Select all / none disabled states off the visible (filtered) rows.
  const unlockedSet = unlocked.data ?? new Set<string>();
  const allVisibleUnlocked = alts.length === 0 || alts.every((r) => unlockedSet.has(r.id));
  const noneVisibleUnlocked = alts.length === 0 || alts.every((r) => !unlockedSet.has(r.id));

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
          {filter.trim() === ""
            ? "No alt recipes in the bundled dataset yet."
            : "No alts match that filter."}
        </div>
      )}
      {alts.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {alts.map((r) => {
            const isUnlocked = unlocked.data?.has(r.id) ?? false;
            return (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <input
                  id={`alt-${r.id}`}
                  type="checkbox"
                  checked={isUnlocked}
                  onChange={(e) =>
                    toggle.mutate({
                      recipeId: r.id,
                      unlocked: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-border"
                />
                <label htmlFor={`alt-${r.id}`} className="flex flex-1 cursor-pointer items-center gap-3">
                  {/* The first output's item icon doubles as the recipe
                      glyph — most alt recipes are named after their
                      primary output ("Pure Iron Ingot" → iron ingot icon). */}
                  <Icon
                    itemId={r.outputs[0]?.itemId ?? r.id}
                    alt={r.name}
                    className="h-7 w-7"
                  />
                  <div>
                    <div className="text-sm font-medium text-fg">{r.name}</div>
                    <div className="text-xs text-fg-muted">
                      {r.id} · unlocks at T{r.unlockTier}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
