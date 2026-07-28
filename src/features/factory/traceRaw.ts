import type { Recipe } from "@/features/library/types";

/**
 * Walk the recipe graph leaves-first from each factory input, summing
 * the total raw-resource demand. Mirrors the planner's two-pass logic
 * (collect demand → leaf) but without supply gating or alt preference
 * — we're surfacing 'if this factory's inputs were all made from raws,
 * how much raw would you need?', not picking a chain.
 *
 * `extracted` is what the walk grounds out on, and it has to be the
 * planner's own set (`useExtractedResources` → `is_extracted_resource`)
 * rather than a list written here. Two hand-maintained copies of the
 * same 14 ids fail silently: this walk would recurse past a raw
 * resource hunting for a producing recipe, and the factory's raw-demand
 * readout would disagree with the plan on the same screen with nothing
 * erroring.
 *
 * Returns a flat `itemId → ipm` map. Ignores Unpackage_* recipes for
 * the same reason the planner does (they all carry unlockTier 0 and
 * dragged item-tier classification down to T0 — same trap on raw
 * tracing).
 */
export function traceRawDemand(
  inputs: Array<{ itemId: string; ratePerMin: number }>,
  recipes: Recipe[],
  extracted: ReadonlySet<string>,
): Record<string, number> {
  const recipesByOutput = new Map<string, Recipe[]>();
  for (const r of recipes) {
    if (r.id.startsWith("Recipe_Unpackage")) continue;
    for (const out of r.outputs) {
      const bucket = recipesByOutput.get(out.itemId) ?? [];
      bucket.push(r);
      recipesByOutput.set(out.itemId, bucket);
    }
  }

  const raw: Record<string, number> = {};
  // Memoise picked recipe per item so the same item under different
  // dependency paths stays on one recipe choice.
  const picked = new Map<string, Recipe | null>();
  const visiting = new Set<string>();

  const pickRecipe = (itemId: string): Recipe | null => {
    if (picked.has(itemId)) return picked.get(itemId) ?? null;
    const candidates = recipesByOutput.get(itemId) ?? [];
    // Prefer non-alt + highest per-minute output for the item.
    const ranked = [...candidates]
      .map((r) => ({
        r,
        rate: r.outputs.find((o) => o.itemId === itemId)?.perMinute ?? 0,
      }))
      .filter(({ rate }) => rate > 0)
      .sort((a, b) => {
        if (a.r.isAlt !== b.r.isAlt) return a.r.isAlt ? 1 : -1;
        return b.rate - a.rate;
      });
    const chosen = ranked[0]?.r ?? null;
    picked.set(itemId, chosen);
    return chosen;
  };

  const walk = (itemId: string, demand: number) => {
    if (extracted.has(itemId)) {
      raw[itemId] = (raw[itemId] ?? 0) + demand;
      return;
    }
    if (visiting.has(itemId)) return; // cycle guard
    const recipe = pickRecipe(itemId);
    if (!recipe) {
      // No recipe known + not flagged as extracted — treat as
      // terminal raw so the demand still surfaces somewhere.
      raw[itemId] = (raw[itemId] ?? 0) + demand;
      return;
    }
    const per = recipe.outputs.find((o) => o.itemId === itemId)?.perMinute ?? 0;
    if (per === 0) return;
    const ratio = demand / per;
    visiting.add(itemId);
    for (const inp of recipe.inputs) {
      walk(inp.itemId, inp.perMinute * ratio);
    }
    visiting.delete(itemId);
  };

  for (const input of inputs) {
    walk(input.itemId, input.ratePerMin);
  }
  return raw;
}
