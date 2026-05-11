import type { Recipe } from "@/features/library/types";

const EXTRACTED: ReadonlySet<string> = new Set([
  "Desc_OreIron_C",
  "Desc_OreCopper_C",
  "Desc_OreGold_C",
  "Desc_Stone_C",
  "Desc_Coal_C",
  "Desc_Sulfur_C",
  "Desc_OreBauxite_C",
  "Desc_RawQuartz_C",
  "Desc_OreUranium_C",
  "Desc_SAM_C",
  "Desc_LiquidOil_C",
  "Desc_Water_C",
  "Desc_NitrogenGas_C",
  "Desc_Geyser_C",
]);

/**
 * Walk the recipe graph leaves-first from each factory input, summing
 * the total raw-resource demand. Mirrors the planner's two-pass logic
 * (collect demand → leaf) but without supply gating or alt preference
 * — we're surfacing 'if this factory's inputs were all made from raws,
 * how much raw would you need?', not picking a chain.
 *
 * Returns a flat `itemId → ipm` map. Ignores Unpackage_* recipes for
 * the same reason the planner does (they all carry unlockTier 0 and
 * dragged item-tier classification down to T0 — same trap on raw
 * tracing).
 */
export function traceRawDemand(
  inputs: Array<{ itemId: string; ratePerMin: number }>,
  recipes: Recipe[],
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
    if (EXTRACTED.has(itemId)) {
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
