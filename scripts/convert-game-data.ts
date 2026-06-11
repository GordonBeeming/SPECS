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
 * the recipes they unlock, which covers every standard recipe. MAM research
 * and alternate-blueprint schematics carry no tier (and no resolvable
 * requirement chain), so those fall back to hand pins, then tiers carried
 * by recipe id from the old SatisfactoryTools-derived dataset
 * (`scripts/fixtures/recipe-tiers-v1.1.json` — its EST_Alternate scan tiers
 * are still the best signal for alts), then the building's unlock tier —
 * a recipe can't run before its machine exists.
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
};
type ScSchematic = {
  className: string;
  name: string;
  /** Present on milestone schematics only — MAM/alternate nodes carry none. */
  tier?: number;
  /** Full asset paths of the recipes this schematic unlocks. */
  recipes?: string[];
};
type ScData = {
  branch: string;
  itemsData: Record<string, ScItem>;
  buildingsData: Record<string, { name?: string }>;
  recipesData: Record<string, ScRecipe>;
  schematicsData: Record<string, ScSchematic>;
};

const sc: ScData = JSON.parse(readFileSync(FIXTURE, "utf8"));
const carriedTiers: Record<string, number> = JSON.parse(readFileSync(TIER_FIXTURE, "utf8"));

/** `/Game/.../Desc_OreIron.Desc_OreIron_C` → `Desc_OreIron_C`. */
function classId(path: string): string {
  const m = path.match(/\.([A-Za-z0-9_]+)$/);
  return m ? m[1] : path;
}

// --- Item categorisation ------------------------------------------------

const FLUID_CATEGORIES = new Set(["liquid", "gas"]);

function isFluid(item: ScItem): boolean {
  return FLUID_CATEGORIES.has(item.category ?? "");
}

const RAW_PREFIXES = ["Desc_Ore", "Desc_Stone", "Desc_Coal", "Desc_Sulfur", "Desc_RawQuartz", "Desc_LiquidOil", "Desc_Water", "Desc_NitrogenGas", "Desc_Wood", "Desc_Mycelia", "Desc_Leaves", "Desc_Flower", "Desc_GenericBiomass", "Desc_SAM"];
const INGOT_PATTERN = /Ingot/;
const AMMO_PATTERNS = [/Cartridge/, /Rebar/, /Nobelisk/, /^Desc_Bullet/];
const EQUIPMENT_PATTERNS = [/JetPack/, /BladeRunners/, /Parachute/, /Rifle/, /GasMask/, /HazmatSuit/, /ZipLine/, /JumpingStilts/, /HoverPack/];
const SPECIAL_IDS = new Set([
  "Desc_WAT1_C",
  "Desc_WAT2_C",
  "Desc_AlienProtein_C",
  "Desc_AlienDNACapsule_C",
  "Desc_CrystalShard_C",
  "Desc_PowerShard_C",
  "Desc_SomersloopMK1_C",
  "Desc_MercerSphere_C",
  "Desc_HardDrive_C",
  "Desc_HogParts_C",
  "Desc_SpitterParts_C",
  "Desc_StingerParts_C",
  "Desc_HatcherParts_C",
]);

function categorise(item: ScItem): string {
  const id = item.className;
  if (isFluid(item)) return "fluid";
  if (SPECIAL_IDS.has(id)) return "special";
  for (const pat of EQUIPMENT_PATTERNS) if (pat.test(id)) return "equipment";
  for (const pat of AMMO_PATTERNS) if (pat.test(id)) return "ammo";
  if (INGOT_PATTERN.test(id)) return "ingot";
  for (const pre of RAW_PREFIXES) if (id.startsWith(pre)) return "raw";
  // Items like Plate, Rod, Wire are parts; heavy modular frames etc. components.
  if (/Modular|Frame|Computer|MotorLightweight|Stator|HighSpeedConnector|HeatSink|SuperPositionOscillator|Quantum|Ficsite/.test(id)) return "component";
  return "part";
}

// --- Building inclusion -------------------------------------------------

// The calculator dump keys machine recipes by native `Build_*_C` actor ids
// already — no Desc→Build translation needed anymore.
const POWER_MW_BY_BUILDING: Record<string, number> = {
  // Production buildings — hand-pinned from wiki values (the dump's
  // `powerUsed` is present but the manufacturer-family numbers depend on
  // overclocking we don't store on the building).
  Build_SmelterMk1_C: 4,
  Build_FoundryMk1_C: 16,
  Build_ConstructorMk1_C: 4,
  Build_AssemblerMk1_C: 15,
  Build_ManufacturerMk1_C: 55,
  Build_OilRefinery_C: 30,
  Build_Blender_C: 75,
  Build_HadronCollider_C: 1500, // Particle Accelerator – variable, max baseline
  Build_QuantumEncoder_C: 1000,
  Build_Converter_C: 250,
  Build_Packager_C: 10,
  Build_OilPump_C: 40,
  Build_WaterPump_C: 20,
  Build_FrackingExtractor_C: 150,
  Build_FrackingSmasher_C: 300,
  Build_MinerMk1_C: 5,
  Build_MinerMk2_C: 12,
  Build_MinerMk3_C: 30,
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
};

// Pinned from the dump's milestone schematics (each building's construction
// recipe sits in a tiered milestone) — the 1.0 tier reshuffle moved several
// of these from their long-remembered pre-1.0 homes (Assembler T2,
// Manufacturer T6, Converter T9 "Matter Conversion", Miner Mk.2 T4).
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
};

const INCLUDED_BUILDINGS = new Set(Object.keys(BUILDING_NAMES));

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

// MAM research nodes carry no tier in the dump and the SAM pair post-dates
// the carried 1.1 tier fixture: Reanimated SAM runs in a T0 Constructor but
// is gated behind the Alien Technology tree's SAM chain, late-game in
// practice, so pin both at T8.
const HAND_TIERS: Record<string, number> = {
  Recipe_IngotSAM_C: 8,
  Recipe_SAMFluctuator_C: 8,
};

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

  const unlockTier =
    milestoneTiers.get(id) ?? HAND_TIERS[id] ?? carriedTiers[id] ?? BUILDING_UNLOCK_TIER[buildingId] ?? 0;

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

// --- Item list ----------------------------------------------------------

type SpecsItem = {
  id: string;
  name: string;
  category: string;
  stackSize: number;
  isFluid: boolean;
  color?: string;
};

// Generator fuels and supplementals are hand-authored below but must
// resolve to real items.
const EXTRA_REFERENCED = [
  "Desc_Wood_C",
  "Desc_GenericBiomass_C",
  "Desc_Leaves_C",
  "Desc_Mycelia_C",
  "Desc_Coal_C",
  "Desc_CompactedCoal_C",
  "Desc_PetroleumCoke_C",
  "Desc_Water_C",
  "Desc_LiquidFuel_C",
  "Desc_LiquidTurboFuel_C",
  "Desc_LiquidBiofuel_C",
  "Desc_RocketFuel_C",
  "Desc_IonizedFuel_C",
  "Desc_NuclearFuelRod_C",
  "Desc_PlutoniumFuelRod_C",
  "Desc_FicsoniumFuelRod_C",
];
for (const id of EXTRA_REFERENCED) referencedItems.add(id);

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
    stackSize: it.stack ?? (cat === "fluid" ? 1 : 100),
    isFluid: cat === "fluid",
  };
  if (it.color) entry.color = it.color;
  items.push(entry);
  itemIds.add(shortId);
}
// Sanity: any referenced item missing from the dump's item table gets a
// minimal synthesised entry so the loader's validator doesn't reject the
// recipe that points at it. With the 1.2 dump this should be empty — the
// old hand-authored SAM/Ficsonium fallbacks now come from the data itself.
const synthesised: string[] = [];
for (const id of referencedItems) {
  if (itemIds.has(id)) continue;
  synthesised.push(id);
  items.push({
    id,
    name: id.replace(/^Desc_/, "").replace(/_C$/, "").replace(/_/g, " "),
    category: "part",
    stackSize: 100,
    isFluid: false,
  });
  itemIds.add(id);
}

// --- Buildings ----------------------------------------------------------

const buildings = [...INCLUDED_BUILDINGS].map((id) => ({
  id,
  name: BUILDING_NAMES[id],
  category: BUILDING_CATEGORIES[id],
  powerMw: POWER_MW_BY_BUILDING[id] ?? 0,
  unlockTier: BUILDING_UNLOCK_TIER[id] ?? 0,
}));

// --- Hand-authored: milestones, generators, miners, vehicles, belts, pipes

const milestones = [
  { id: "tier-0", tier: 0, name: "HUB Upgrade 1", unlocks: ["Build_ConstructorMk1_C", "Build_SmelterMk1_C"] },
  { id: "tier-1", tier: 1, name: "Field Research", unlocks: ["Build_AssemblerMk1_C", "Build_ConveyorBeltMk2_C"] },
  { id: "tier-2", tier: 2, name: "Logistics Mk.2", unlocks: ["Build_StorageContainerMk1_C"] },
  { id: "tier-3", tier: 3, name: "Coal Power", unlocks: ["Build_GeneratorCoal_C", "Build_FoundryMk1_C", "Build_MinerMk2_C", "Build_ConveyorBeltMk3_C"] },
  { id: "tier-4", tier: 4, name: "Advanced Steel Production", unlocks: ["Build_ConveyorBeltMk4_C"] },
  { id: "tier-5", tier: 5, name: "Oil Processing", unlocks: ["Build_OilRefinery_C", "Build_OilPump_C", "Build_Packager_C", "Build_ConveyorBeltMk5_C"] },
  { id: "tier-6", tier: 6, name: "Expanded Power Infrastructure", unlocks: ["Build_GeneratorFuel_C", "Build_PipelineMK2_C"] },
  { id: "tier-7", tier: 7, name: "Bauxite Refinement", unlocks: ["Build_ManufacturerMk1_C", "Build_Blender_C", "Build_MinerMk3_C", "Build_FrackingExtractor_C"] },
  { id: "tier-8", tier: 8, name: "Particle Enrichment", unlocks: ["Build_HadronCollider_C", "Build_GeneratorNuclear_C", "Build_Converter_C", "Build_ConveyorBeltMk6_C"] },
  { id: "tier-9", tier: 9, name: "Project Assembly Phase 5", unlocks: ["Build_QuantumEncoder_C"] },
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

// Generators: hand-authored so fuel rates + supplemental water match the
// wiki. The dump omits the fuel-per-minute breakdown.
const generators = [
  {
    id: "Build_GeneratorBiomass_C",
    name: "Biomass Burner",
    category: "burner",
    powerMw: 30,
    unlockTier: 0,
    fuels: [
      { fuelItemId: "Desc_Wood_C", fuelPerMinute: 18 },
      { fuelItemId: "Desc_GenericBiomass_C", fuelPerMinute: 4 },
      { fuelItemId: "Desc_Leaves_C", fuelPerMinute: 60 },
      { fuelItemId: "Desc_Mycelia_C", fuelPerMinute: 15 },
    ],
  },
  {
    id: "Build_GeneratorCoal_C",
    name: "Coal Generator",
    category: "burner",
    powerMw: 75,
    unlockTier: 3,
    fuels: [
      { fuelItemId: "Desc_Coal_C", fuelPerMinute: 15, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 45 },
      { fuelItemId: "Desc_CompactedCoal_C", fuelPerMinute: 7.14, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 45 },
      { fuelItemId: "Desc_PetroleumCoke_C", fuelPerMinute: 25, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 45 },
    ],
  },
  {
    id: "Build_GeneratorFuel_C",
    name: "Fuel Generator",
    category: "fluid",
    powerMw: 250,
    unlockTier: 6,
    fuels: [
      { fuelItemId: "Desc_LiquidFuel_C", fuelPerMinute: 20 },
      { fuelItemId: "Desc_LiquidTurboFuel_C", fuelPerMinute: 7.5 },
      { fuelItemId: "Desc_LiquidBiofuel_C", fuelPerMinute: 20 },
      { fuelItemId: "Desc_RocketFuel_C", fuelPerMinute: 4.17 },
      { fuelItemId: "Desc_IonizedFuel_C", fuelPerMinute: 3 },
    ],
  },
  {
    id: "Build_GeneratorNuclear_C",
    name: "Nuclear Power Plant",
    category: "nuclear",
    powerMw: 2500,
    unlockTier: 8,
    fuels: [
      { fuelItemId: "Desc_NuclearFuelRod_C", fuelPerMinute: 0.2, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 240 },
      { fuelItemId: "Desc_PlutoniumFuelRod_C", fuelPerMinute: 0.1, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 240 },
      // 1 rod / min, 1000 m³ water — closes the nuclear-waste recycle loop.
      { fuelItemId: "Desc_FicsoniumFuelRod_C", fuelPerMinute: 1, supplementalItemId: "Desc_Water_C", supplementalPerMinute: 1000, powerMwOverride: 2500 },
    ],
  },
  // Three Geothermal entries by node purity. Output is the *average* power
  // (geothermal fluctuates ±50% in-game). No fuel cost, no unlock tier
  // (built only at fixed geothermal nodes).
  {
    id: "Build_GeneratorGeoThermal_Impure_C",
    name: "Geothermal Generator (Impure)",
    category: "geothermal",
    powerMw: 100,
    unlockTier: 8,
    fuels: [],
  },
  {
    id: "Build_GeneratorGeoThermal_Normal_C",
    name: "Geothermal Generator (Normal)",
    category: "geothermal",
    powerMw: 200,
    unlockTier: 8,
    fuels: [],
  },
  {
    id: "Build_GeneratorGeoThermal_Pure_C",
    name: "Geothermal Generator (Pure)",
    category: "geothermal",
    powerMw: 400,
    unlockTier: 8,
    fuels: [],
  },
];

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

const fail = (msg: string) => {
  console.error(`VALIDATION FAILED: ${msg}`);
  process.exit(1);
};

if (sc.branch !== "Stable") fail(`expected the Stable branch dump, got ${sc.branch}`);
if (recipes.length < 211) fail(`recipe count regressed: ${recipes.length} < 211 (the 1.1 set)`);
const samRecipes = recipes.filter((r) => r.inputs.some((i) => i.itemId === "Desc_SAM_C"));
if (samRecipes.length === 0) fail("no SAM-consuming recipes — the SAM toggle would stay inert");
if (!itemIds.has("Desc_FicsiteIngot_C")) fail("Desc_FicsiteIngot_C missing");
if (!itemIds.has("Desc_SAM_C")) fail("Desc_SAM_C missing");
if (milestoneTiers.size < 100) fail(`milestone tier coverage regressed: ${milestoneTiers.size} recipes`);
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
  beltTiers,
  pipeTiers,
  generators,
  miners,
  transportVehicles,
};

writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n", "utf8");

const altCount = recipes.filter((r) => r.isAlt).length;
const tierFromMilestone = recipes.filter((r) => milestoneTiers.has(r.id)).length;
const tierDefaulted = recipes.filter(
  (r) => !milestoneTiers.has(r.id) && HAND_TIERS[r.id] === undefined && carriedTiers[r.id] === undefined,
).length;
console.log(
  `wrote ${OUT}\n  items: ${items.length} (${synthesised.length} synthesised: ${synthesised.join(", ") || "none"})\n  buildings: ${buildings.length}\n  recipes: ${recipes.length} (${altCount} alts, ${samRecipes.length} SAM-consuming, ${tierFromMilestone} tiers from milestones, ${tierDefaulted} defaulted to building tier)\n  milestones: ${milestones.length}\n  generators: ${generators.length}\n  miners: ${miners.length}\n  transportVehicles: ${transportVehicles.length}`,
);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
