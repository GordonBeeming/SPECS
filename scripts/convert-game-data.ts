#!/usr/bin/env bun
/**
 * Convert satisfactory-calculator.com's gameData dump into the SPECS dataset
 * shape under `src-tauri/game-data/v1.2.json`.
 *
 * Source: `static.satisfactory-calculator.com/data/json/gameData/en-Stable.json`
 * — the same site (and the same attribution) the resource-node catalog
 * already uses. We moved off the SatisfactoryTools dump because its updates
 * lag the game by months; the calculator tracks the Stable branch within
 * days, which is what makes 1.2 (and the SAM/converter chain) available at
 * all. Re-fetching is a manual step (Cloudflare gates non-browser UAs) —
 * drop a fresh copy at the fixture path and re-run.
 *
 * The conversion is intentionally lossy: we only need the slices SPECS
 * reasons about (items, production buildings, in-machine recipes) plus the
 * hand-authored structures the dump doesn't carry cleanly (miner rate
 * tables, generators, transport-vehicle specs, belt/pipe tier marks,
 * milestones).
 *
 * Recipe unlock tiers: milestone schematics in the dump carry a `tier` and
 * the recipes they unlock, which covers every standard recipe. Alternates
 * are gated by Hard Drives and MAM research instead, so they carry no
 * `tier`, but each alt schematic's own `requirements` array names the
 * progression schematic (`Schematic_<tier>-<milestone>_C`) that gates it —
 * occasionally indirectly, via another alt schematic's requirements. That
 * chain resolves all but a handful of alts (the ones gated purely by a MAM
 * research node, which the dump doesn't tier at all). Anything still
 * unresolved falls back to hand pins, then tiers carried by recipe id from
 * the old SatisfactoryTools-derived dataset (`scripts/fixtures/recipe-tiers-
 * v1.1.json` — its EST_Alternate scan tiers are still the best signal for
 * the remaining alts, except a carried tier of exactly 0, which is
 * known-impossible for an alt and is treated as stale rather than trusted),
 * then the building's unlock tier — a recipe can't run before its machine
 * exists.
 *
 * Re-run with `bun run scripts/convert-game-data.ts`. The fixture under
 * `scripts/fixtures/satisfactory-calculator-gamedata-1.2.json` is checked
 * in so the output is deterministic across machines.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const FIXTURE = resolve(REPO, "scripts/fixtures/satisfactory-calculator-gamedata-1.2.json");
const TIER_FIXTURE = resolve(REPO, "scripts/fixtures/recipe-tiers-v1.1.json");
const OUT = resolve(REPO, "src-tauri/game-data/v1.2.json");

const GAME_VERSION = "1.2";

for (const f of [FIXTURE, TIER_FIXTURE]) {
  if (!existsSync(f)) {
    console.error(`fixture missing: ${f}`);
    console.error(
      "gameData: fetch a fresh copy from https://static.satisfactory-calculator.com/data/json/gameData/en-Stable.json (browser UA required) and drop it at the path above.",
    );
    process.exit(1);
  }
}

type ScRecipe = {
  className: string;
  name: string;
  /** full asset path → amount per craft (fluids in liters). */
  ingredients?: Record<string, number>;
  produce?: Record<string, number>;
  mProducedIn?: string[];
  mManufactoringDuration?: number;
};
type ScItem = {
  className: string;
  name: string;
  category?: string;
  stack?: number;
  color?: string;
  /** Burn energy. MJ per unit for solids, MJ per *litre* for fluids. */
  energy?: number;
};
type ScBuilding = {
  name?: string;
  category?: string;
  /** Single-figure draw, MW. Production buildings with a fixed draw. */
  powerUsed?: number;
  /** Recipe id → `[min, max]` MW, for the variable-draw machines
   * (Particle Accelerator, Quantum Encoder, Converter). */
  powerUsedRecipes?: Record<string, [number, number]>;
  /** MW produced. A plain number, or `purity → [min, max]` for the
   * Geothermal Generator, whose output fluctuates. */
  powerGenerated?: number | Record<string, [number, number]>;
  /** Short item ids this generator will burn. */
  acceptedFuels?: string[];
  /** Coolant a generator draws alongside its fuel — water, for Coal
   * and Nuclear. */
  supplementalLoadType?: string;
  supplementalLoadRatio?: number;
  /** Extractor output per purity, `RP_Inpure` / `RP_Normal` / `RP_Pure`.
   * Solids are items per minute; fluids are litres per minute. */
  extractionRate?: Record<string, number>;
};
type ScSchematic = {
  className: string;
  name: string;
  /** Present on milestone schematics only — MAM/alternate nodes carry none. */
  tier?: number;
  /** Full asset paths of the recipes this schematic unlocks. */
  recipes?: string[];
  /** Full asset paths of the schematics that must be unlocked first. */
  requirements?: string[];
};
type ScData = {
  branch: string;
  itemsData: Record<string, ScItem>;
  /** Hand equipment (Portable Miner, Chainsaw, …). Kept apart from
   * `itemsData` in the dump even when a recipe produces one. */
  toolsData: Record<string, ScItem>;
  buildingsData: Record<string, ScBuilding>;
  recipesData: Record<string, ScRecipe>;
  schematicsData: Record<string, ScSchematic>;
};

const sc: ScData = JSON.parse(readFileSync(FIXTURE, "utf8"));
const carriedTiers: Record<string, number> = JSON.parse(readFileSync(TIER_FIXTURE, "utf8"));

// Annotated on the *variable* rather than the arrow, which is what lets
// TypeScript treat a `fail()` call as terminating control flow — so the
// checks below narrow their subjects instead of needing a cast afterwards.
const fail: (msg: string) => never = (msg) => {
  console.error(`VALIDATION FAILED: ${msg}`);
  process.exit(1);
};

/** `/Game/.../Desc_OreIron.Desc_OreIron_C` → `Desc_OreIron_C`. */
function classId(path: string): string {
  const m = path.match(/\.([A-Za-z0-9_]+)$/);
  return m ? m[1] : path;
}

/** Reading a hand-authored table by id. A missing entry stops the
 * conversion: defaulting instead hands the caller the most permissive
 * value there is (0 MW, Tier 0), which looks identical to a correct
 * answer and reaches the app as silent, confident nonsense. */
function requireEntry<T>(table: Record<string, T>, id: string, tableName: string): T {
  const value = table[id];
  if (value === undefined) fail(`${tableName} has no entry for ${id}`);
  return value;
}

function dumpBuilding(id: string): ScBuilding {
  const b = sc.buildingsData[id];
  if (!b) fail(`the dump has no building ${id}`);
  return b;
}

function dumpItem(id: string): ScItem {
  const it = sc.itemsData[id];
  if (!it) fail(`the dump has no item ${id}`);
  return it;
}

// --- Item categorisation ------------------------------------------------

const FLUID_CATEGORIES = new Set(["liquid", "gas"]);

function isFluid(item: ScItem): boolean {
  return FLUID_CATEGORIES.has(item.category ?? "");
}

// Exact ids, not prefixes: `Desc_SAM` also matches the SAM Fluctuator,
// which is manufactured, and a prefix match filed it as something you
// dig out of the ground. Reanimated SAM and Sulfuric Acid match the
// same loose prefixes and are only saved by an earlier branch catching
// them first, which is a fragile way to be right.
//
// Everything an extractor pulls up, plus what the player picks off the
// ground: the app treats the whole set as supply a factory draws on
// rather than a product it can be planned around.
//
// "Raw" is not "extractable". Wood is raw and no extractor reaches it;
// the Rust side answers the extractor question from
// `EXTRACTED_RESOURCES`, and a consumer that reads this category as a
// stand-in for it gets the opposite answer. Biomass used to sit here
// and is the reason that's worth spelling out — four Constructor
// recipes make it, so it belongs with the parts.
const RAW_IDS = new Set([
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
  "Desc_Wood_C",
  "Desc_Leaves_C",
  "Desc_Mycelia_C",
]);
// Exact ids for the same reason as `RAW_IDS`: `/Ingot/` also matches
// Desc_SAMIngot_C (Reanimated SAM), which is a Constructor product in
// the SAM line rather than anything a Smelter pours.
const INGOT_IDS = new Set([
  "Desc_IronIngot_C",
  "Desc_CopperIngot_C",
  "Desc_GoldIngot_C",
  "Desc_SteelIngot_C",
  "Desc_AluminumIngot_C",
  "Desc_FicsiteIngot_C",
]);
const AMMO_PATTERNS = [/Cartridge/, /Rebar/, /Nobelisk/, /^Desc_Bullet/];
// Wearable gear (Jetpack, Blade Runners, Hazmat Suit, ...) lives in the
// dump's `toolsData`, never in `itemsData`, so it reaches the dataset
// through `categoriseTool` and there is nothing here for a pattern over
// item ids to match. The equivalent list of patterns used to sit here
// matching nothing at all.
//
// Same for Somersloops, Mercer Spheres, Hard Drives and the four
// creature drops: all `toolsData`, all already categorised `special`
// by the dump's own category. Only ids that genuinely appear in
// `itemsData` earn a place here.
const SPECIAL_IDS = new Set([
  "Desc_AlienProtein_C",
  "Desc_AlienDNACapsule_C",
  "Desc_CrystalShard_C",
  // Power slugs are world pickups like the creature drops, and were
  // the one group of them filed as ordinary parts.
  "Desc_Crystal_C",
  "Desc_Crystal_mk2_C",
  "Desc_Crystal_mk3_C",
]);

/** A `toolsData` entry's category. The dump splits its tools into gear
 * you equip ("hand", "back", "weapon", …) and the "special" pile —
 * creature remains, Somersloops, foraged food — which is the same set
 * `SPECIAL_IDS` covers on the item side. */
function categoriseTool(tool: ScItem): string {
  return tool.category === "special" ? "special" : "equipment";
}

function categorise(item: ScItem): string {
  const id = item.className;
  // Raw before fluid: Crude Oil, Water and Nitrogen Gas are all three
  // of them raw *and* fluid, and `isFluid` answering first filed them
  // as manufacturable products a factory could be planned around. The
  // `isFluid` flag is read straight off the dump, so nothing is lost by
  // letting the category say the more useful thing.
  if (RAW_IDS.has(id)) return "raw";
  if (isFluid(item)) return "fluid";
  if (SPECIAL_IDS.has(id)) return "special";
  for (const pat of AMMO_PATTERNS) if (pat.test(id)) return "ammo";
  if (INGOT_IDS.has(id)) return "ingot";
  // Items like Plate, Rod, Wire are parts; heavy modular frames etc. components.
  if (/Modular|Frame|Computer|MotorLightweight|Stator|HighSpeedConnector|HeatSink|SuperPositionOscillator|Quantum|Ficsite/.test(id)) return "component";
  return "part";
}

// --- Building inclusion -------------------------------------------------

// The calculator dump keys machine recipes by native `Build_*_C` actor ids
// already — no Desc→Build translation needed anymore.
//
// Every figure here is cross-checked against the dump's own `powerUsed` in
// `checkAuthoredPower` below. The variable-draw machines (Particle
// Accelerator, Quantum Encoder, Converter) carry a per-recipe range in the
// dump rather than one number, so for those the authored value is a chosen
// point inside the range and the check is a band rather than an equality.
//
// A building the dump gives no draw at all draws nothing: generators
// produce power, and a Resource Well Extractor is fed by its Pressuriser.
const POWER_MW_BY_BUILDING: Record<string, number> = {
  Build_SmelterMk1_C: 4,
  Build_FoundryMk1_C: 16,
  Build_ConstructorMk1_C: 4,
  Build_AssemblerMk1_C: 15,
  Build_ManufacturerMk1_C: 55,
  Build_OilRefinery_C: 30,
  Build_Blender_C: 75,
  Build_HadronCollider_C: 1500, // Particle Accelerator — top of the dump's band
  Build_QuantumEncoder_C: 1000,
  Build_Converter_C: 250,
  Build_Packager_C: 10,
  Build_OilPump_C: 40,
  Build_WaterPump_C: 20,
  Build_FrackingExtractor_C: 0,
  Build_FrackingSmasher_C: 150,
  Build_MinerMk1_C: 5,
  Build_MinerMk2_C: 15,
  Build_MinerMk3_C: 45,
  Build_GeneratorNuclear_C: 0,
};

const BUILDING_NAMES: Record<string, string> = {
  Build_SmelterMk1_C: "Smelter",
  Build_FoundryMk1_C: "Foundry",
  Build_ConstructorMk1_C: "Constructor",
  Build_AssemblerMk1_C: "Assembler",
  Build_ManufacturerMk1_C: "Manufacturer",
  Build_OilRefinery_C: "Refinery",
  Build_Blender_C: "Blender",
  Build_HadronCollider_C: "Particle Accelerator",
  Build_QuantumEncoder_C: "Quantum Encoder",
  Build_Converter_C: "Converter",
  Build_Packager_C: "Packager",
  Build_OilPump_C: "Oil Extractor",
  Build_WaterPump_C: "Water Extractor",
  Build_FrackingExtractor_C: "Resource Well Extractor",
  Build_FrackingSmasher_C: "Resource Well Pressuriser",
  Build_MinerMk1_C: "Miner Mk.1",
  Build_MinerMk2_C: "Miner Mk.2",
  Build_MinerMk3_C: "Miner Mk.3",
  // A generator earns a place in `buildings` only when it hosts recipes,
  // because this table is the referent set for `recipes[].buildingId`.
  // The Nuclear Power Plant does: burning a fuel rod is the only thing in
  // the game that produces Uranium and Plutonium Waste, and without those
  // recipes the whole plutonium branch has no way to come into existence.
  // Its generation side stays in `generators` — see the power note above.
  Build_GeneratorNuclear_C: "Nuclear Power Plant",
};

const BUILDING_CATEGORIES: Record<string, string> = {
  Build_SmelterMk1_C: "smelting",
  Build_FoundryMk1_C: "smelting",
  Build_ConstructorMk1_C: "manufacturing",
  Build_AssemblerMk1_C: "manufacturing",
  Build_ManufacturerMk1_C: "manufacturing",
  Build_OilRefinery_C: "manufacturing",
  Build_Blender_C: "manufacturing",
  Build_HadronCollider_C: "manufacturing",
  Build_QuantumEncoder_C: "manufacturing",
  Build_Converter_C: "manufacturing",
  Build_Packager_C: "manufacturing",
  Build_OilPump_C: "extraction",
  Build_WaterPump_C: "extraction",
  Build_FrackingExtractor_C: "extraction",
  Build_FrackingSmasher_C: "extraction",
  Build_MinerMk1_C: "extraction",
  Build_MinerMk2_C: "extraction",
  Build_MinerMk3_C: "extraction",
  Build_GeneratorNuclear_C: "power",
};

// Each building's construction recipe sits in a tiered milestone schematic,
// so `derivedBuildingTier` recovers all but three of these from the dump and
// `checkAuthoredBuildingTier` fails the build on any disagreement. The 1.0
// tier reshuffle moved several from their long-remembered pre-1.0 homes
// (Assembler T2, Manufacturer T6, Converter T9 "Matter Conversion", Miner
// Mk.2 T4), which is exactly the drift the check now catches.
const BUILDING_UNLOCK_TIER: Record<string, number> = {
  Build_MinerMk1_C: 0,
  Build_MinerMk2_C: 4,
  Build_MinerMk3_C: 8,
  Build_SmelterMk1_C: 0,
  Build_FoundryMk1_C: 3,
  Build_ConstructorMk1_C: 0,
  Build_AssemblerMk1_C: 2,
  Build_ManufacturerMk1_C: 6,
  Build_OilRefinery_C: 5,
  Build_Blender_C: 7,
  Build_HadronCollider_C: 8,
  Build_QuantumEncoder_C: 9,
  Build_Converter_C: 9,
  Build_Packager_C: 5,
  Build_OilPump_C: 5,
  Build_WaterPump_C: 3,
  Build_FrackingExtractor_C: 8,
  Build_FrackingSmasher_C: 8,
  Build_GeneratorNuclear_C: 8,
};

// The three buildings whose construction recipe no schematic in the dump
// unlocks, plus the Geothermal Generator, whose recipe hangs off a MAM
// research node that carries no tier. Their tiers stay hand-authored, and
// membership here is closed: a building that stops deriving has to be added
// deliberately rather than sliding into hand-authored silence.
const UNDERIVABLE_BUILDING_TIERS = new Set([
  "Build_OilRefinery_C",
  "Build_OilPump_C",
  "Build_GeneratorGeoThermal_C",
]);

const INCLUDED_BUILDINGS = new Set(Object.keys(BUILDING_NAMES));

// The three building tables are read by id all over the conversion, and a
// building present in one but absent from another would surface as a 0 MW
// Tier 0 row rather than an error. Check the keys agree up front.
for (const id of INCLUDED_BUILDINGS) {
  requireEntry(POWER_MW_BY_BUILDING, id, "POWER_MW_BY_BUILDING");
  requireEntry(BUILDING_CATEGORIES, id, "BUILDING_CATEGORIES");
  requireEntry(BUILDING_UNLOCK_TIER, id, "BUILDING_UNLOCK_TIER");
}
for (const table of [
  { name: "POWER_MW_BY_BUILDING", keys: Object.keys(POWER_MW_BY_BUILDING) },
  { name: "BUILDING_CATEGORIES", keys: Object.keys(BUILDING_CATEGORIES) },
  { name: "BUILDING_UNLOCK_TIER", keys: Object.keys(BUILDING_UNLOCK_TIER) },
]) {
  for (const id of table.keys) {
    if (!INCLUDED_BUILDINGS.has(id)) fail(`${table.name} has ${id}, which BUILDING_NAMES doesn't`);
  }
}

// --- Recipe conversion --------------------------------------------------

type SpecsIo = { itemId: string; perMinute: number };
type SpecsRecipe = {
  id: string;
  name: string;
  buildingId: string;
  isAlt: boolean;
  unlockTier: number;
  cycleSeconds: number;
  inputs: SpecsIo[];
  outputs: SpecsIo[];
};

const referencedItems = new Set<string>();

function toFlows(map: Record<string, number> | undefined, cycle: number): SpecsIo[] {
  return Object.entries(map ?? {}).map(([path, amount]) => {
    const itemId = classId(path);
    const item = sc.itemsData[itemId];
    // Fluid amounts are stored in liters; SPECS rates are m³/min.
    const perCraft = item && isFluid(item) ? amount / 1000 : amount;
    referencedItems.add(itemId);
    return { itemId, perMinute: round2((perCraft * 60) / cycle) };
  });
}

// Milestone schematics carry a tier plus the recipes they unlock — the
// authoritative 1.2 source for every standard recipe. Min wins so a recipe
// shared across milestones gets its earliest unlock.
const milestoneTiers = new Map<string, number>();
for (const schem of Object.values(sc.schematicsData)) {
  if (schem.tier === undefined) continue;
  for (const path of schem.recipes ?? []) {
    const rid = classId(path);
    const prev = milestoneTiers.get(rid);
    if (prev === undefined || schem.tier < prev) milestoneTiers.set(rid, schem.tier);
  }
}

// A building is built from its own construction recipe (`Build_Foo_C` is
// erected from `Recipe_Foo_C`, which produces `Desc_Foo_C`), and that recipe
// sits in a milestone schematic like any other. Following that chain gives
// the dump a say over `BUILDING_UNLOCK_TIER`, which is otherwise the one
// hand-authored table nothing upstream can contradict — and it is the table
// the recipe-can't-precede-its-machine invariant rests on.
const recipesByProduct = new Map<string, string[]>();
for (const r of Object.values(sc.recipesData)) {
  for (const path of Object.keys(r.produce ?? {})) {
    const produced = classId(path);
    if (!recipesByProduct.has(produced)) recipesByProduct.set(produced, []);
    recipesByProduct.get(produced)!.push(classId(r.className));
  }
}

function derivedBuildingTier(buildingId: string): number | undefined {
  const constructed = buildingId.replace(/^Build_/, "Desc_");
  const tiers = (recipesByProduct.get(constructed) ?? [])
    .map((rid) => milestoneTiers.get(rid))
    .filter((t): t is number => t !== undefined);
  return tiers.length > 0 ? Math.min(...tiers) : undefined;
}

/** Fails when the dump disagrees with the authored tier, and when a
 * building neither derives nor is on the closed hand-authored list. */
function checkAuthoredBuildingTier(buildingId: string, authored: number): void {
  const derived = derivedBuildingTier(buildingId);
  if (derived === undefined) {
    if (!UNDERIVABLE_BUILDING_TIERS.has(buildingId)) {
      fail(
        `${buildingId} has no milestone schematic for its construction recipe — pin it in UNDERIVABLE_BUILDING_TIERS with a reason, or fix the derivation`,
      );
    }
    return;
  }
  if (derived !== authored) {
    fail(`${buildingId} is authored at tier ${authored} but the dump's milestones put it at ${derived}`);
  }
}

// MAM research nodes carry no tier in the dump and the SAM pair post-dates
// the carried 1.1 tier fixture: Reanimated SAM runs in a T0 Constructor but
// is gated behind the Alien Technology tree's SAM chain, late-game in
// practice, so pin both at T8.
const HAND_TIERS: Record<string, number> = {
  Recipe_IngotSAM_C: 8,
  Recipe_SAMFluctuator_C: 8,
};

const schematicsById = new Map<string, ScSchematic>();
for (const schem of Object.values(sc.schematicsData)) schematicsById.set(classId(schem.className), schem);

/** `.../Schematic_5-1.Schematic_5-1_C` → 5. Regexed off the raw path — the
 * numeric ids contain a hyphen `classId()` doesn't treat as part of a class
 * name, so it can't round-trip through that helper. */
function tierFromRequirementPath(path: string): number | undefined {
  const m = path.match(/Schematic_(\d+)-\d+/);
  return m ? Number(m[1]) : undefined;
}

// Alt schematics occasionally gate on another alt schematic instead of a
// progression schematic directly (Alternate: Gunpowder requires Alternate:
// Compacted Coal) — resolve one level of indirection recursively. `seen`
// guards against a cycle hanging the converter if the dump ever grows one;
// nothing in the 1.2 dump chains more than a single hop.
function resolveSchematicTier(schematicId: string, seen: Set<string>): number | undefined {
  if (seen.has(schematicId)) return undefined;
  seen.add(schematicId);
  const schem = schematicsById.get(schematicId);
  if (!schem) return undefined;
  let best: number | undefined;
  for (const reqPath of schem.requirements ?? []) {
    const resolved = tierFromRequirementPath(reqPath) ?? resolveSchematicTier(classId(reqPath), seen);
    // A schematic's requirements are AND'd — every one must be unlocked
    // before the schematic is — so its own tier is the latest of them, not
    // the earliest.
    if (resolved !== undefined && (best === undefined || resolved > best)) best = resolved;
  }
  return best;
}

// Recipe id -> earliest tier reachable through the schematic(s) that unlock
// it. MAM research schematics carry neither a `tier` nor a `requirements`
// chain the dump can resolve, so alts gated purely by a research node (no
// progression schematic anywhere in the chain) are absent here and fall
// through to the next signal below.
const altUnlockTiers = new Map<string, number>();
for (const schem of Object.values(sc.schematicsData)) {
  if (!/\/Alternate\//.test(schem.className)) continue;
  const tier = resolveSchematicTier(classId(schem.className), new Set());
  if (tier === undefined) continue;
  for (const recipePath of schem.recipes ?? []) {
    const rid = classId(recipePath);
    const prev = altUnlockTiers.get(rid);
    if (prev === undefined || tier < prev) altUnlockTiers.set(rid, tier);
  }
}

const recipes: SpecsRecipe[] = [];
for (const r of Object.values(sc.recipesData)) {
  const id = classId(r.className);
  const producedIn = (r.mProducedIn ?? []).map(classId);
  const buildingId = producedIn.find((b) => INCLUDED_BUILDINGS.has(b));
  // Build-gun, workshop and vehicle recipes have no machine entry — out.
  if (!buildingId) continue;
  // The dump models extraction as pseudo-recipes (Iron Ore → Iron Ore
  // in a Miner). SPECS models extraction via node claims, and a
  // self-producing "recipe" would make raw items look craftable to the
  // planner — drop the whole extraction family.
  if (BUILDING_CATEGORIES[buildingId] === "extraction") continue;
  const cycle = r.mManufactoringDuration ?? 0;
  if (cycle <= 0) continue;
  if (!r.produce || Object.keys(r.produce).length === 0) continue;

  const inputs = toFlows(r.ingredients, cycle);
  const outputs = toFlows(r.produce, cycle);

  // Alternates are identified by the game's own naming convention — the
  // alternate-blueprint schematics exist in the dump but carry no tier, so
  // the name prefix is just as reliable and simpler.
  const isAlt = id.startsWith("Recipe_Alternate_") || r.name.startsWith("Alternate:");

  // A carried (1.1-era) tier of exactly 0 for an alt is known-impossible —
  // no alternate recipe unlocks at tier 0 — so it's stale rather than a real
  // signal; skip it and let a later fallback (typically the building's own
  // unlock tier) supply something trustworthy instead.
  const carriedTier = carriedTiers[id];
  const trustedCarriedTier = isAlt && carriedTier === 0 ? undefined : carriedTier;

  const buildingTier = requireEntry(BUILDING_UNLOCK_TIER, buildingId, "BUILDING_UNLOCK_TIER");
  const derivedTier =
    milestoneTiers.get(id) ??
    HAND_TIERS[id] ??
    altUnlockTiers.get(id) ??
    trustedCarriedTier ??
    buildingTier;
  // A recipe can't be usable before its own machine exists, but the dump's
  // tutorial-era schematics (HUB Upgrades 1-3, tier 0) teach several
  // standard recipes — Reinforced Iron Plate among them — well ahead of the
  // building those recipes actually run in. The building's own unlock tier
  // is always a hard floor regardless of what an earlier schematic claims.
  const unlockTier = Math.max(derivedTier, buildingTier);

  recipes.push({
    id,
    name: r.name,
    buildingId,
    isAlt,
    unlockTier,
    cycleSeconds: cycle,
    inputs,
    outputs,
  });
}

// --- Generators ---------------------------------------------------------
//
// Everything numeric about a generator comes out of the dump. Burn rate is
// `powerGenerated / energy × 60`; coolant is `powerGenerated ×
// supplementalLoadRatio × 0.06` (the ratio is litres per MW-second, so ×60
// for a minute and ÷1000 for m³), and both reproduce the wiki's figures
// exactly. Only the id, the display name, the category and *which* of the
// game's accepted fuels SPECS offers are authored here.
//
// The SPECS ids are load-bearing in a way the rest isn't: saved power-gen
// rows reference them, so `Build_GeneratorBiomass_C` and the three
// per-purity Geothermal ids stay as they are and carry the dump id
// separately rather than being renamed to match it.

type SpecsGeneratorFuel = {
  fuelItemId: string;
  fuelPerMinute: number;
  supplementalItemId?: string;
  supplementalPerMinute?: number;
  byproductItemId?: string;
  byproductPerMinute?: number;
};

type GeneratorSpec = {
  id: string;
  dumpId: string;
  name: string;
  category: string;
  /** Undefined means "derive it"; set only where the dump can't. */
  unlockTier?: number;
  /** Which accepted fuels to offer, in display order. Empty for the
   * geothermal entries, which burn nothing. */
  fuelItemIds: string[];
  /** Geothermal only: which purity band of the dump's output range this
   * entry represents. */
  geothermalPurity?: "impure" | "normal" | "pure";
};

// The Biomass Burner also accepts Flower Petals, Fabric, Packaged Liquid
// Biofuel and the two alien-remains parts. They're left out because SPECS
// plans production chains and none of those has one worth planning — this
// list is the one part of a generator still chosen by hand, so a fuel the
// game doesn't accept fails below, but a fuel we simply never offered can't
// be caught by anything except reading it.
const GENERATOR_SPECS: GeneratorSpec[] = [
  {
    id: "Build_GeneratorBiomass_C",
    dumpId: "Build_GeneratorBiomass_Automated_C",
    name: "Biomass Burner",
    category: "burner",
    fuelItemIds: ["Desc_Wood_C", "Desc_GenericBiomass_C", "Desc_Leaves_C", "Desc_Mycelia_C", "Desc_Biofuel_C"],
  },
  {
    id: "Build_GeneratorCoal_C",
    dumpId: "Build_GeneratorCoal_C",
    name: "Coal Generator",
    category: "burner",
    fuelItemIds: ["Desc_Coal_C", "Desc_CompactedCoal_C", "Desc_PetroleumCoke_C"],
  },
  {
    id: "Build_GeneratorFuel_C",
    dumpId: "Build_GeneratorFuel_C",
    name: "Fuel Generator",
    category: "fluid",
    fuelItemIds: [
      "Desc_LiquidFuel_C",
      "Desc_LiquidTurboFuel_C",
      "Desc_LiquidBiofuel_C",
      "Desc_RocketFuel_C",
      "Desc_IonizedFuel_C",
    ],
  },
  {
    id: "Build_GeneratorNuclear_C",
    dumpId: "Build_GeneratorNuclear_C",
    name: "Nuclear Power Plant",
    category: "nuclear",
    fuelItemIds: ["Desc_NuclearFuelRod_C", "Desc_PlutoniumFuelRod_C", "Desc_FicsoniumFuelRod_C"],
  },
  // Geothermal output fluctuates ±50% in-game, so each purity band takes
  // the average of the dump's range. Built only at fixed vents, and gated
  // by a MAM research node the dump doesn't tier.
  {
    id: "Build_GeneratorGeoThermal_Impure_C",
    dumpId: "Build_GeneratorGeoThermal_C",
    name: "Geothermal Generator (Impure)",
    category: "geothermal",
    unlockTier: 8,
    fuelItemIds: [],
    geothermalPurity: "impure",
  },
  {
    id: "Build_GeneratorGeoThermal_Normal_C",
    dumpId: "Build_GeneratorGeoThermal_C",
    name: "Geothermal Generator (Normal)",
    category: "geothermal",
    unlockTier: 8,
    fuelItemIds: [],
    geothermalPurity: "normal",
  },
  {
    id: "Build_GeneratorGeoThermal_Pure_C",
    dumpId: "Build_GeneratorGeoThermal_C",
    name: "Geothermal Generator (Pure)",
    category: "geothermal",
    unlockTier: 8,
    fuelItemIds: [],
    geothermalPurity: "pure",
  },
];

function generatorPowerMw(spec: GeneratorSpec): number {
  const generated = dumpBuilding(spec.dumpId).powerGenerated;
  if (spec.geothermalPurity) {
    if (typeof generated !== "object" || generated === null) {
      fail(`${spec.dumpId} was expected to carry a per-purity output range`);
    }
    const band = generated[spec.geothermalPurity];
    if (!Array.isArray(band) || band.length !== 2) {
      fail(`${spec.dumpId} has no ${spec.geothermalPurity} output range`);
    }
    return (band[0] + band[1]) / 2;
  }
  if (typeof generated !== "number" || !(generated > 0)) {
    fail(`${spec.dumpId} has no single power-generated figure`);
  }
  return generated;
}

/** A generator's byproduct, if the game gives it one. Uranium and
 * Plutonium Waste are ordinary recipes in the dump, keyed to the plant by
 * `mProducedIn` and to the rod by being its only ingredient — burning the
 * rod is the only thing that produces them, which is why the plutonium
 * branch is unreachable without this. */
function generatorByproduct(
  spec: GeneratorSpec,
  fuelItemId: string,
  fuelPerMinute: number,
): { itemId: string; perMinute: number } | undefined {
  for (const r of Object.values(sc.recipesData)) {
    const producedIn = (r.mProducedIn ?? []).map(classId);
    if (!producedIn.includes(spec.dumpId)) continue;
    const ingredients = Object.entries(r.ingredients ?? {});
    if (ingredients.length !== 1 || classId(ingredients[0][0]) !== fuelItemId) continue;
    const cycle = r.mManufactoringDuration ?? 0;
    if (cycle <= 0) fail(`byproduct recipe ${classId(r.className)} has no cycle time`);
    // The recipe states the rod burn rate too; if it disagrees with the
    // rate derived from burn energy, one of the two is being misread.
    const impliedFuelPerMinute = (ingredients[0][1] * 60) / cycle;
    if (Math.abs(impliedFuelPerMinute - fuelPerMinute) > 0.01) {
      fail(
        `${spec.id} burns ${fuelItemId} at ${fuelPerMinute}/min by energy but ${classId(r.className)} implies ${impliedFuelPerMinute}/min`,
      );
    }
    const produced = Object.entries(r.produce ?? {});
    if (produced.length !== 1) {
      fail(`byproduct recipe ${classId(r.className)} produces ${produced.length} items, expected 1`);
    }
    const itemId = classId(produced[0][0]);
    const item = dumpItem(itemId);
    const perCraft = isFluid(item) ? produced[0][1] / 1000 : produced[0][1];
    referencedItems.add(itemId);
    return { itemId, perMinute: round2((perCraft * 60) / cycle) };
  }
  return undefined;
}

const generators = GENERATOR_SPECS.map((spec) => {
  const building = dumpBuilding(spec.dumpId);
  const powerMw = generatorPowerMw(spec);
  const accepted = new Set(building.acceptedFuels ?? []);
  const fuels: SpecsGeneratorFuel[] = spec.fuelItemIds.map((fuelItemId) => {
    if (!accepted.has(fuelItemId)) {
      fail(`${spec.id} is authored to burn ${fuelItemId}, which ${spec.dumpId} doesn't accept`);
    }
    const item = dumpItem(fuelItemId);
    if (!item.energy || item.energy <= 0) fail(`${fuelItemId} carries no burn energy`);
    // Fluid energy is per litre; SPECS rates fluids in m³/min.
    const perMinuteRaw = ((powerMw / item.energy) * 60) / (isFluid(item) ? 1000 : 1);
    const fuelPerMinute = round2(perMinuteRaw);
    referencedItems.add(fuelItemId);
    const fuel: SpecsGeneratorFuel = { fuelItemId, fuelPerMinute };
    if (building.supplementalLoadType && building.supplementalLoadRatio) {
      const supplementalItemId = building.supplementalLoadType;
      referencedItems.add(supplementalItemId);
      fuel.supplementalItemId = supplementalItemId;
      fuel.supplementalPerMinute = round2(powerMw * building.supplementalLoadRatio * 0.06);
    }
    const byproduct = generatorByproduct(spec, fuelItemId, perMinuteRaw);
    if (byproduct) {
      fuel.byproductItemId = byproduct.itemId;
      fuel.byproductPerMinute = byproduct.perMinute;
    }
    return fuel;
  });
  const unlockTier = spec.unlockTier ?? derivedBuildingTier(spec.dumpId);
  if (unlockTier === undefined) {
    fail(`${spec.id} has no derivable unlock tier and no authored one`);
  }
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    powerMw,
    unlockTier,
    fuels,
  };
});

// The dump's ingredients for a generator-hosted "recipe" (burning a fuel
// rod for waste) never include the reactor's coolant — that's modeled as
// the building's own supplementalLoad, not a recipe ingredient — so
// without this fold-in, a default planner chain through nuclear waste
// would understate raw Water demand by the coolant load each plant
// actually draws. The recipe's own cycle time already matches the rate
// the generator computed its fuel/coolant figures at, so the two
// per-minute numbers share the same clock and can be combined directly.
for (const recipe of recipes) {
  const generator = generators.find((g) => g.id === recipe.buildingId);
  if (!generator) continue;
  const fuelItemId = recipe.inputs[0]?.itemId;
  const fuel = generator.fuels.find((f) => f.fuelItemId === fuelItemId);
  if (fuel?.supplementalItemId !== undefined && fuel.supplementalPerMinute) {
    recipe.inputs.push({ itemId: fuel.supplementalItemId, perMinute: fuel.supplementalPerMinute });
  }
}

// --- Item list ----------------------------------------------------------

type SpecsItem = {
  id: string;
  name: string;
  category: string;
  stackSize: number;
  isFluid: boolean;
  color?: string;
};

// Generator fuels, coolants and byproducts register themselves in
// `referencedItems` as the generators are built above, so this list runs
// after that block rather than carrying a parallel hand-typed copy of it.
const items: SpecsItem[] = [];
const itemIds = new Set<string>();
for (const [shortId, raw] of Object.entries(sc.itemsData)) {
  // itemsData is keyed by the short class id; the entry's own className
  // is the full asset path — normalise to the short id everywhere.
  const it: ScItem = { ...raw, className: shortId };
  if (!referencedItems.has(shortId)) continue;
  if (itemIds.has(shortId)) continue;
  const cat = categorise(it);
  const entry: SpecsItem = {
    id: shortId,
    name: it.name,
    category: cat,
    stackSize: it.stack ?? (isFluid(it) ? 1 : 100),
    isFluid: isFluid(it),
  };
  if (it.color) entry.color = it.color;
  items.push(entry);
  itemIds.add(shortId);
}
// Sanity: any referenced item missing from the dump's item table gets a
// minimal synthesised entry so the loader's validator doesn't reject the
// recipe that points at it.
//
// The dump keeps equipment and creature drops in `toolsData` rather
// than `itemsData`, and a recipe can produce one (the Portable Miner
// has an Assembler alt). Those carry a real name and are gear or
// forage, not a production part — without the lookup the app offers
// the raw blueprint id as a buildable product.
const synthesised: string[] = [];
for (const id of referencedItems) {
  if (itemIds.has(id)) continue;
  synthesised.push(id);
  const tool = sc.toolsData[id];
  items.push({
    id,
    name: tool?.name ?? id.replace(/^Desc_/, "").replace(/_C$/, "").replace(/_/g, " "),
    category: tool ? categoriseTool(tool) : "part",
    stackSize: tool?.stack ?? 100,
    isFluid: false,
  });
  itemIds.add(id);
}

// --- Buildings ----------------------------------------------------------

const buildings = [...INCLUDED_BUILDINGS].map((id) => ({
  id,
  name: requireEntry(BUILDING_NAMES, id, "BUILDING_NAMES"),
  category: requireEntry(BUILDING_CATEGORIES, id, "BUILDING_CATEGORIES"),
  powerMw: requireEntry(POWER_MW_BY_BUILDING, id, "POWER_MW_BY_BUILDING"),
  unlockTier: requireEntry(BUILDING_UNLOCK_TIER, id, "BUILDING_UNLOCK_TIER"),
}));

// --- Hand-authored: milestones, generators, miners, vehicles, belts, pipes

const MILESTONE_NAMES: Record<number, string> = {
  0: "HUB Upgrade 1",
  1: "Field Research",
  2: "Logistics Mk.2",
  3: "Coal Power",
  4: "Advanced Steel Production",
  5: "Oil Processing",
  6: "Expanded Power Infrastructure",
  7: "Bauxite Refinement",
  8: "Particle Enrichment",
  9: "Project Assembly Phase 5",
};

/** `mark` → the pipe the player actually builds. Belts follow
 * `Build_ConveyorBeltMk<mark>_C` mechanically; pipes don't (Mk1 has no
 * mark in its id at all), so the two ids are written out. */
const PIPE_BUILDING_BY_MARK: Record<number, string> = {
  1: "Build_Pipeline_C",
  2: "Build_PipelineMK2_C",
};

/** Milestone unlocks with no cross-checkable source anywhere else in
 * the conversion. Everything derivable is derived below instead. */
const MILESTONE_EXTRA_UNLOCKS: Record<number, string[]> = {
  2: ["Build_StorageContainerMk1_C"],
};

/**
 * What a tier gives the player, assembled from the tables that already
 * carry the answer rather than typed out a second time.
 *
 * `BUILDING_UNLOCK_TIER` is cross-checked against the dump's own
 * milestone schematics (`checkAuthoredBuildingTier` fails the
 * conversion on a disagreement), and `beltTiers` / `pipeTiers` carry
 * their own unlock tiers. A hand-typed list next to all that drifts
 * silently and reads as authoritative: the old one told a player that
 * Coal Power unlocks the Miner Mk.2 while the table two hundred lines
 * up said Tier 4, put the Manufacturer and the Converter a tier out
 * each, and never mentioned the Water Extractor at all — which is the
 * building the whole Water chain now hangs its tier on.
 *
 * MAM research is deliberately not folded in. A Geothermal Generator
 * comes off the Caterium tree, not off a milestone, so listing it
 * under one would misdescribe how the player gets it.
 */
function milestoneUnlocks(tier: number): string[] {
  const buildings = Object.entries(BUILDING_UNLOCK_TIER)
    .filter(([, t]) => t === tier)
    .map(([id]) => id);
  const gens = generators
    .filter((g) => g.unlockTier === tier && !g.id.includes("GeoThermal"))
    .map((g) => g.id);
  const belts = beltTiers
    .filter((b) => b.unlockTier === tier)
    .map((b) => `Build_ConveyorBeltMk${b.mark}_C`);
  const pipes = pipeTiers
    .filter((p) => p.unlockTier === tier)
    .map((p) => requireEntry(PIPE_BUILDING_BY_MARK, String(p.mark), "PIPE_BUILDING_BY_MARK"));
  // The Nuclear Power Plant is both a production building and a
  // generator, so it appears in two of these sources.
  return [
    ...new Set([...buildings, ...gens, ...belts, ...pipes, ...(MILESTONE_EXTRA_UNLOCKS[tier] ?? [])]),
  ];
}

// Space Elevator / Project Assembly phases. The dump carries the part items
// and their recipes but not the per-phase delivery requirements, so these are
// hand-authored from the official wiki's "Initial phase requirements" table
// (https://satisfactory.wiki.gg/wiki/Space_Elevator). The first three phases
// each unlock two tiers, the fourth unlocks Tier 9, and the fifth launches the
// project (no tier unlock). `unlocksTiers` is empty for the final phase.
const spaceElevatorPhases = [
  {
    phase: 1,
    name: "Distribution Platform",
    unlocksTiers: [3, 4],
    parts: [{ itemId: "Desc_SpaceElevatorPart_1_C", quantity: 50 }],
  },
  {
    phase: 2,
    name: "Construction Dock",
    unlocksTiers: [5, 6],
    parts: [
      { itemId: "Desc_SpaceElevatorPart_1_C", quantity: 500 },
      { itemId: "Desc_SpaceElevatorPart_2_C", quantity: 500 },
      { itemId: "Desc_SpaceElevatorPart_3_C", quantity: 100 },
    ],
  },
  {
    phase: 3,
    name: "Main Body",
    unlocksTiers: [7, 8],
    parts: [
      { itemId: "Desc_SpaceElevatorPart_2_C", quantity: 2500 },
      { itemId: "Desc_SpaceElevatorPart_4_C", quantity: 500 },
      { itemId: "Desc_SpaceElevatorPart_5_C", quantity: 100 },
    ],
  },
  {
    phase: 4,
    name: "Propulsion",
    unlocksTiers: [9],
    parts: [
      { itemId: "Desc_SpaceElevatorPart_7_C", quantity: 500 },
      { itemId: "Desc_SpaceElevatorPart_6_C", quantity: 500 },
      { itemId: "Desc_SpaceElevatorPart_8_C", quantity: 250 },
      { itemId: "Desc_SpaceElevatorPart_9_C", quantity: 100 },
    ],
  },
  {
    phase: 5,
    name: "Assembly",
    unlocksTiers: [],
    parts: [
      { itemId: "Desc_SpaceElevatorPart_9_C", quantity: 1000 },
      { itemId: "Desc_SpaceElevatorPart_10_C", quantity: 1000 },
      { itemId: "Desc_SpaceElevatorPart_12_C", quantity: 256 },
      { itemId: "Desc_SpaceElevatorPart_11_C", quantity: 200 },
    ],
  },
];

const beltTiers = [
  { mark: 1, itemsPerMinute: 60, unlockTier: 0 },
  { mark: 2, itemsPerMinute: 120, unlockTier: 2 },
  { mark: 3, itemsPerMinute: 270, unlockTier: 4 },
  { mark: 4, itemsPerMinute: 480, unlockTier: 5 },
  { mark: 5, itemsPerMinute: 780, unlockTier: 7 },
  { mark: 6, itemsPerMinute: 1200, unlockTier: 9 },
];

const pipeTiers = [
  { mark: 1, cubicMetersPerMinute: 300, unlockTier: 3 },
  { mark: 2, cubicMetersPerMinute: 600, unlockTier: 6 },
];

const milestones = Object.entries(MILESTONE_NAMES).map(([tier, name]) => ({
  id: `tier-${tier}`,
  tier: Number(tier),
  name,
  unlocks: milestoneUnlocks(Number(tier)),
}));

// Miners: base items-per-minute at 100% clock on normal-purity nodes.
// Impure = base/2, Pure = base*2. Matches the wiki Mk1=60 / Mk2=120 /
// Mk3=240 baseline. Unlock tiers mirror BUILDING_UNLOCK_TIER above
// (pinned from the dump's milestone schematics).
const miners = [
  { id: "Build_MinerMk1_C", mark: 1, baseItemsPerMinute: 60, unlockTier: BUILDING_UNLOCK_TIER.Build_MinerMk1_C },
  { id: "Build_MinerMk2_C", mark: 2, baseItemsPerMinute: 120, unlockTier: BUILDING_UNLOCK_TIER.Build_MinerMk2_C },
  { id: "Build_MinerMk3_C", mark: 3, baseItemsPerMinute: 240, unlockTier: BUILDING_UNLOCK_TIER.Build_MinerMk3_C },
];

// Transport vehicles: stack-based throughput baseline per the plan. Cycle
// time is computed at request-time from distance × default speed +
// load/unload overhead in `plan_vehicles()`.
const transportVehicles = [
  { id: "Build_Tractor_C", name: "Tractor", kind: "tractor", slots: 25, baseItemsPerMinute: 60, batteryPerKm: 0, unlockTier: 3 },
  { id: "Build_Truck_C", name: "Truck", kind: "truck", slots: 48, baseItemsPerMinute: 120, batteryPerKm: 0, unlockTier: 5 },
  { id: "Build_Explorer_C", name: "Explorer", kind: "tractor", slots: 12, baseItemsPerMinute: 30, batteryPerKm: 0, unlockTier: 3 },
  { id: "Build_DroneTransport_C", name: "Drone", kind: "drone", slots: 9, baseItemsPerMinute: 250, batteryPerKm: 1, unlockTier: 7 },
];

// --- Validation ---------------------------------------------------------

if (sc.branch !== "Stable") fail(`expected the Stable branch dump, got ${sc.branch}`);
if (recipes.length < 211) fail(`recipe count regressed: ${recipes.length} < 211 (the 1.1 set)`);
const samRecipes = recipes.filter((r) => r.inputs.some((i) => i.itemId === "Desc_SAM_C"));
if (samRecipes.length === 0) fail("no SAM-consuming recipes — the SAM toggle would stay inert");
if (!itemIds.has("Desc_FicsiteIngot_C")) fail("Desc_FicsiteIngot_C missing");
if (!itemIds.has("Desc_SAM_C")) fail("Desc_SAM_C missing");
if (milestoneTiers.size < 100) fail(`milestone tier coverage regressed: ${milestoneTiers.size} recipes`);

// The hand-authored building tables are the ones nothing upstream used to
// contradict, so a typo in them reached the app looking exactly like a
// correct number. Everything below gives the dump the deciding vote.
for (const id of INCLUDED_BUILDINGS) {
  const authored = requireEntry(POWER_MW_BY_BUILDING, id, "POWER_MW_BY_BUILDING");
  const dump = dumpBuilding(id);
  if (typeof dump.powerUsed === "number") {
    if (dump.powerUsed !== authored) {
      fail(`${id} is authored at ${authored} MW but the dump says ${dump.powerUsed} MW`);
    }
  } else {
    const bands = Object.values(dump.powerUsedRecipes ?? {});
    if (bands.length > 0) {
      // A variable-draw machine: the authored figure is a chosen point in
      // the range the dump gives per recipe, so bound it rather than pin it.
      const low = Math.min(...bands.map((b) => b[0]));
      const high = Math.max(...bands.map((b) => b[1]));
      if (authored < low || authored > high) {
        fail(`${id} is authored at ${authored} MW, outside the dump's ${low}–${high} MW range`);
      }
    } else if (authored !== 0) {
      fail(`${id} is authored at ${authored} MW but the dump gives it no draw at all`);
    }
  }
  checkAuthoredBuildingTier(id, requireEntry(BUILDING_UNLOCK_TIER, id, "BUILDING_UNLOCK_TIER"));
}
for (const spec of GENERATOR_SPECS) {
  if (spec.unlockTier === undefined) continue;
  checkAuthoredBuildingTier(spec.dumpId, spec.unlockTier);
}

// A hand pin that the dump can now tier itself is stale, not a fallback —
// leaving it in means a real signal is being overridden by a guess.
for (const rid of Object.keys(HAND_TIERS)) {
  if (!sc.recipesData[rid]) fail(`HAND_TIERS pins ${rid}, which isn't in the dump`);
  if (milestoneTiers.has(rid)) {
    fail(`HAND_TIERS pins ${rid}, but the dump's milestones now tier it at ${milestoneTiers.get(rid)}`);
  }
}

// Miner marks feed both the resource budget and the extractor draw, and
// the dump states both per mark — so neither has to be taken on trust.
for (const m of miners) {
  const normal = dumpBuilding(m.id).extractionRate?.RP_Normal;
  if (normal !== m.baseItemsPerMinute) {
    fail(`${m.id} is authored at ${m.baseItemsPerMinute} ipm but the dump says ${normal}`);
  }
}
// Endgame recipes run in low-tier machines — exactly the case the
// building-tier fallback gets wrong. Pin a few so a regression in the
// schematic parsing can't silently demote them.
const TIER_PINS: Record<string, number> = {
  Recipe_FicsiteMesh_C: 9, // Ficsite Trigon — T0 Constructor, T9 unlock
  Recipe_SingularityCell_C: 9, // T6 Manufacturer, T9 unlock
  Recipe_SpaceElevatorPart_11_C: 9, // Ballistic Warp Drive — Phase 5
};
for (const [rid, want] of Object.entries(TIER_PINS)) {
  const got = recipes.find((r) => r.id === rid)?.unlockTier;
  if (got !== want) fail(`${rid} unlockTier ${got} != ${want}`);
}
for (const r of recipes) {
  if (!INCLUDED_BUILDINGS.has(r.buildingId)) fail(`recipe ${r.id} uses excluded building ${r.buildingId}`);
  for (const io of [...r.inputs, ...r.outputs]) {
    if (!itemIds.has(io.itemId)) fail(`recipe ${r.id} references unknown item ${io.itemId}`);
  }
}
// A recipe can't be usable before its own machine exists — this is the
// invariant that would have caught the tier-0-alt bug outright, since every
// alt whose derivation and carried-tier fixture both came up empty used to
// default straight to 0 instead of its building's real unlock tier.
const belowBuildingTier = recipes.filter(
  (r) => r.unlockTier < requireEntry(BUILDING_UNLOCK_TIER, r.buildingId, "BUILDING_UNLOCK_TIER"),
);
if (belowBuildingTier.length > 0) {
  fail(
    `${belowBuildingTier.length} recipe(s) unlock before their building does: ${belowBuildingTier
      .map((r) => `${r.id} (tier ${r.unlockTier} < ${r.buildingId} tier ${BUILDING_UNLOCK_TIER[r.buildingId]})`)
      .join(", ")}`,
  );
}
// No alternate recipe unlocks at tier 0 in the game — a tier-0 alt means the
// derivation chain fell all the way through without ever finding a real
// signal.
const zeroTierAlts = recipes.filter((r) => r.isAlt && r.unlockTier === 0);
if (zeroTierAlts.length > 0) {
  fail(`${zeroTierAlts.length} alt recipe(s) landed at tier 0: ${zeroTierAlts.map((r) => r.id).join(", ")}`);
}
// Burning a fuel rod is the only source of nuclear waste in the game, so
// without these byproducts the plutonium branch — Plutonium Pellet,
// Encased Plutonium Cell, Non-Fissile Uranium, Ficsonium and the Space
// Elevator parts behind them — has nothing to ground out against and the
// planner refuses every target in it.
const nuclearGen = generators.find((g) => g.id === "Build_GeneratorNuclear_C");
if (!nuclearGen) fail("the Nuclear Power Plant is missing from the generator list");
for (const [fuelItemId, wasteItemId] of [
  ["Desc_NuclearFuelRod_C", "Desc_NuclearWaste_C"],
  ["Desc_PlutoniumFuelRod_C", "Desc_PlutoniumWaste_C"],
]) {
  const fuel = nuclearGen.fuels.find((f) => f.fuelItemId === fuelItemId);
  if (!fuel) fail(`the Nuclear Power Plant no longer burns ${fuelItemId}`);
  if (fuel.byproductItemId !== wasteItemId) {
    fail(`${fuelItemId} should leave ${wasteItemId} behind, got ${fuel.byproductItemId ?? "nothing"}`);
  }
}
for (const wasteItemId of ["Desc_NuclearWaste_C", "Desc_PlutoniumWaste_C"]) {
  if (!recipes.some((r) => r.outputs.some((o) => o.itemId === wasteItemId))) {
    fail(`no recipe produces ${wasteItemId} — the plutonium branch would be unplannable`);
  }
}

if (spaceElevatorPhases.length !== 5) fail(`expected 5 Space Elevator phases, got ${spaceElevatorPhases.length}`);
for (const ph of spaceElevatorPhases) {
  if (ph.parts.length === 0) fail(`Space Elevator phase ${ph.phase} has no parts`);
  for (const p of ph.parts) {
    if (!itemIds.has(p.itemId)) fail(`Space Elevator phase ${ph.phase} references unknown item ${p.itemId}`);
    if (!(p.quantity > 0)) fail(`Space Elevator phase ${ph.phase} part ${p.itemId} has non-positive quantity`);
  }
}
// The dump has no per-phase delivery data (see the hand-authored comment
// above), so a transcription slip here has no other signal to catch it.
// Pin the wiki-sourced quantities directly.
const SPACE_ELEVATOR_PART_PINS: Record<number, Record<string, number>> = {
  2: { Desc_SpaceElevatorPart_1_C: 500, Desc_SpaceElevatorPart_2_C: 500, Desc_SpaceElevatorPart_3_C: 100 },
};
for (const [phase, wantQuantities] of Object.entries(SPACE_ELEVATOR_PART_PINS)) {
  const ph = spaceElevatorPhases.find((p) => p.phase === Number(phase));
  if (!ph) fail(`Space Elevator phase ${phase} missing for pinned-quantity check`);
  else {
    for (const [itemId, want] of Object.entries(wantQuantities)) {
      const got = ph.parts.find((p) => p.itemId === itemId)?.quantity;
      if (got !== want) fail(`Space Elevator phase ${phase} ${itemId} quantity ${got} != ${want}`);
    }
  }
}

// --- Output -------------------------------------------------------------

const output = {
  version: GAME_VERSION,
  gameVersion: GAME_VERSION,
  items: items.sort((a, b) => a.name.localeCompare(b.name)),
  buildings: buildings.sort((a, b) => a.name.localeCompare(b.name)),
  recipes: recipes.sort((a, b) => {
    if (a.isAlt !== b.isAlt) return a.isAlt ? 1 : -1;
    return a.name.localeCompare(b.name);
  }),
  milestones,
  spaceElevatorPhases,
  beltTiers,
  pipeTiers,
  generators,
  miners,
  transportVehicles,
};

writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n", "utf8");

const altCount = recipes.filter((r) => r.isAlt).length;
const tierFromMilestone = recipes.filter((r) => milestoneTiers.has(r.id)).length;
const tierFromAltSchematic = recipes.filter((r) => !milestoneTiers.has(r.id) && altUnlockTiers.has(r.id)).length;
const tierDefaulted = recipes.filter(
  (r) =>
    !milestoneTiers.has(r.id) &&
    HAND_TIERS[r.id] === undefined &&
    !altUnlockTiers.has(r.id) &&
    (carriedTiers[r.id] === undefined || (r.isAlt && carriedTiers[r.id] === 0)),
).length;
const altTierHistogram = recipes
  .filter((r) => r.isAlt)
  .reduce<Record<number, number>>((hist, r) => {
    hist[r.unlockTier] = (hist[r.unlockTier] ?? 0) + 1;
    return hist;
  }, {});
console.log(
  `wrote ${OUT}\n  items: ${items.length} (${synthesised.length} synthesised: ${synthesised.join(", ") || "none"})\n  buildings: ${buildings.length}\n  recipes: ${recipes.length} (${altCount} alts, ${samRecipes.length} SAM-consuming, ${tierFromMilestone} tiers from milestones, ${tierFromAltSchematic} alt tiers from schematic requirements, ${tierDefaulted} defaulted to building tier)\n  alt tier distribution: ${Object.entries(altTierHistogram)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([tier, count]) => `T${tier}:${count}`)
    .join(" ")}\n  milestones: ${milestones.length}\n  generators: ${generators.length}\n  miners: ${miners.length}\n  transportVehicles: ${transportVehicles.length}`,
);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
