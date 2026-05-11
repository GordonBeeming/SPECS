#!/usr/bin/env bun
/**
 * Convert satisfactorytools' community game-data dump into the SPECS dataset
 * shape under `src-tauri/game-data/v1.1.json`.
 *
 * The conversion is intentionally lossy: we only need the slices of the SF
 * data that SPECS reasons about (items, production buildings, in-machine
 * recipes, milestones, generators) plus a few hand-authored structures that
 * SF's data doesn't carry cleanly (miner rate tables, transport-vehicle
 * specs, belt/pipe tier marks).
 *
 * Re-run with `bun run scripts/convert-game-data.ts`. The fixture under
 * `scripts/fixtures/satisfactorytools-data-v1.1.json` is checked in so the
 * output is deterministic across machines.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const FIXTURE = resolve(REPO, "scripts/fixtures/satisfactorytools-data-v1.1.json");
const OUT = resolve(REPO, "src-tauri/game-data/v1.1.json");

if (!existsSync(FIXTURE)) {
  console.error(`fixture missing: ${FIXTURE}`);
  process.exit(1);
}

type SfItem = {
  className: string;
  name: string;
  stackSize: number;
  liquid?: boolean;
  fluidColor?: { r: number; g: number; b: number; a: number };
};
type SfBuilding = {
  className: string;
  name?: string | null;
  metadata?: { powerConsumption?: number };
};
type SfRecipe = {
  className: string;
  name: string;
  alternate: boolean;
  time: number;
  inHand: boolean;
  forBuilding: boolean;
  inWorkshop: boolean;
  inMachine: boolean;
  ingredients: Array<{ item: string; amount: number }>;
  products: Array<{ item: string; amount: number }>;
  producedIn: string[];
};
type SfSchematic = {
  className: string;
  type: string;
  tier: number;
  name: string;
  unlock?: { recipes?: string[] };
};

type SfData = {
  items: Record<string, SfItem>;
  buildings: Record<string, SfBuilding>;
  recipes: Record<string, SfRecipe>;
  schematics: Record<string, SfSchematic>;
  miners: Record<string, unknown>;
  generators: Record<string, unknown>;
};

const sf: SfData = JSON.parse(readFileSync(FIXTURE, "utf8"));

// --- Item categorisation ------------------------------------------------

const FLUID_OVERRIDES = new Set([
  "Desc_Water_C",
  "Desc_LiquidOil_C",
  "Desc_HeavyOilResidue_C",
  "Desc_LiquidFuel_C",
  "Desc_LiquidTurboFuel_C",
  "Desc_LiquidBiofuel_C",
  "Desc_AluminaSolution_C",
  "Desc_SulfuricAcid_C",
  "Desc_NitricAcid_C",
  "Desc_NitrogenGas_C",
  "Desc_RocketFuel_C",
  "Desc_IonizedFuel_C",
  "Desc_DissolvedSilica_C",
  "Desc_DarkEnergy_C",
  "Desc_QuantumEnergy_C",
]);

function isFluid(item: SfItem): boolean {
  if (FLUID_OVERRIDES.has(item.className)) return true;
  if (item.liquid === true) return true;
  // Some gases / fluids set fluidColor.a > 0 even when `liquid` is absent.
  if (item.fluidColor && item.fluidColor.a > 0) return true;
  return false;
}

const RAW_PREFIXES = ["Desc_Ore", "Desc_Stone", "Desc_Coal", "Desc_Sulfur", "Desc_RawQuartz", "Desc_LiquidOil", "Desc_Water", "Desc_NitrogenGas", "Desc_Wood", "Desc_Mycelia", "Desc_Leaves", "Desc_Flower", "Desc_GenericBiomass"];
const INGOT_PATTERN = /Ingot/;
const AMMO_PATTERNS = [/Cartridge/, /Rebar/, /Nobelisk/, /^Desc_Bullet/];
const EQUIPMENT_PATTERNS = [/JetPack/, /BladeRunners/, /Parachute/, /Rifle/, /GasMask/, /HazmatSuit/, /ZipLine/, /JumpingStilts/, /HoverPack/];
const SPECIAL_IDS = new Set([
  "Desc_WAT1_C",
  "Desc_WAT2_C",
  "Desc_SAM_C",
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

function categorise(item: SfItem): string {
  const id = item.className;
  if (isFluid(item)) return "fluid";
  if (SPECIAL_IDS.has(id)) return "special";
  for (const pat of EQUIPMENT_PATTERNS) if (pat.test(id)) return "equipment";
  for (const pat of AMMO_PATTERNS) if (pat.test(id)) return "ammo";
  if (INGOT_PATTERN.test(id)) return "ingot";
  for (const pre of RAW_PREFIXES) if (id.startsWith(pre)) return "raw";
  // Items like Plate, Rod, Wire are parts; heavy modular frames etc. components.
  if (/Modular|Frame|Computer|MotorLightweight|Stator|HighSpeedConnector|HeatSink|SuperPositionOscillator|Quantum/.test(id)) return "component";
  return "part";
}

// --- Building inclusion -------------------------------------------------

// SF data keys buildings by `Desc_*_C` but the SPECS production code (and
// the Phase-8 amp_slots_for_building helper) expects `Build_*_C` — the
// in-game actor prefix. Translate at the boundary so downstream slices use
// one convention.
const BUILD_ID_BY_DESC: Record<string, string> = {
  Desc_SmelterMk1_C: "Build_SmelterMk1_C",
  Desc_FoundryMk1_C: "Build_FoundryMk1_C",
  Desc_ConstructorMk1_C: "Build_ConstructorMk1_C",
  Desc_AssemblerMk1_C: "Build_AssemblerMk1_C",
  Desc_ManufacturerMk1_C: "Build_ManufacturerMk1_C",
  Desc_OilRefinery_C: "Build_OilRefinery_C",
  Desc_Blender_C: "Build_Blender_C",
  Desc_HadronCollider_C: "Build_HadronCollider_C",
  Desc_QuantumEncoder_C: "Build_QuantumEncoder_C",
  Desc_Converter_C: "Build_Converter_C",
  Desc_Packager_C: "Build_Packager_C",
  Desc_OilPump_C: "Build_OilPump_C",
  Desc_WaterPump_C: "Build_WaterPump_C",
  Desc_FrackingExtractor_C: "Build_FrackingExtractor_C",
  Desc_FrackingSmasher_C: "Build_FrackingSmasher_C",
  Desc_MinerMk1_C: "Build_MinerMk1_C",
  Desc_MinerMk2_C: "Build_MinerMk2_C",
  Desc_MinerMk3_C: "Build_MinerMk3_C",
};

const POWER_MW_BY_BUILDING: Record<string, number> = {
  // Production buildings — hand-pinned from wiki values (the SF data field
  // `metadata.powerConsumption` is missing for many, and the manufacturer
  // family numbers depend on overclocking we don't store on the building).
  Desc_SmelterMk1_C: 4,
  Desc_FoundryMk1_C: 16,
  Desc_ConstructorMk1_C: 4,
  Desc_AssemblerMk1_C: 15,
  Desc_ManufacturerMk1_C: 55,
  Desc_OilRefinery_C: 30,
  Desc_Blender_C: 75,
  Desc_HadronCollider_C: 1500, // Particle Accelerator – variable, max baseline
  Desc_QuantumEncoder_C: 1000,
  Desc_Converter_C: 250,
  Desc_Packager_C: 10,
  Desc_OilPump_C: 40,
  Desc_WaterPump_C: 20,
  Desc_FrackingExtractor_C: 150,
  Desc_FrackingSmasher_C: 300,
  Desc_MinerMk1_C: 5,
  Desc_MinerMk2_C: 12,
  Desc_MinerMk3_C: 30,
};

const BUILDING_NAMES: Record<string, string> = {
  Desc_SmelterMk1_C: "Smelter",
  Desc_FoundryMk1_C: "Foundry",
  Desc_ConstructorMk1_C: "Constructor",
  Desc_AssemblerMk1_C: "Assembler",
  Desc_ManufacturerMk1_C: "Manufacturer",
  Desc_OilRefinery_C: "Refinery",
  Desc_Blender_C: "Blender",
  Desc_HadronCollider_C: "Particle Accelerator",
  Desc_QuantumEncoder_C: "Quantum Encoder",
  Desc_Converter_C: "Converter",
  Desc_Packager_C: "Packager",
  Desc_OilPump_C: "Oil Extractor",
  Desc_WaterPump_C: "Water Extractor",
  Desc_FrackingExtractor_C: "Resource Well Extractor",
  Desc_FrackingSmasher_C: "Resource Well Pressuriser",
  Desc_MinerMk1_C: "Miner Mk.1",
  Desc_MinerMk2_C: "Miner Mk.2",
  Desc_MinerMk3_C: "Miner Mk.3",
};

const BUILDING_CATEGORIES: Record<string, string> = {
  Desc_SmelterMk1_C: "smelting",
  Desc_FoundryMk1_C: "smelting",
  Desc_ConstructorMk1_C: "manufacturing",
  Desc_AssemblerMk1_C: "manufacturing",
  Desc_ManufacturerMk1_C: "manufacturing",
  Desc_OilRefinery_C: "manufacturing",
  Desc_Blender_C: "manufacturing",
  Desc_HadronCollider_C: "manufacturing",
  Desc_QuantumEncoder_C: "manufacturing",
  Desc_Converter_C: "manufacturing",
  Desc_Packager_C: "manufacturing",
  Desc_OilPump_C: "extraction",
  Desc_WaterPump_C: "extraction",
  Desc_FrackingExtractor_C: "extraction",
  Desc_FrackingSmasher_C: "extraction",
  Desc_MinerMk1_C: "extraction",
  Desc_MinerMk2_C: "extraction",
  Desc_MinerMk3_C: "extraction",
};

const BUILDING_UNLOCK_TIER: Record<string, number> = {
  Desc_MinerMk1_C: 0,
  Desc_MinerMk2_C: 3,
  Desc_MinerMk3_C: 7,
  Desc_SmelterMk1_C: 0,
  Desc_FoundryMk1_C: 3,
  Desc_ConstructorMk1_C: 0,
  Desc_AssemblerMk1_C: 1,
  Desc_ManufacturerMk1_C: 7,
  Desc_OilRefinery_C: 5,
  Desc_Blender_C: 7,
  Desc_HadronCollider_C: 8,
  Desc_QuantumEncoder_C: 9,
  Desc_Converter_C: 8,
  Desc_Packager_C: 5,
  Desc_OilPump_C: 5,
  Desc_WaterPump_C: 3,
  Desc_FrackingExtractor_C: 7,
  Desc_FrackingSmasher_C: 7,
};

const INCLUDED_BUILDINGS = Object.keys(BUILDING_NAMES);

// --- Recipe tier map ----------------------------------------------------

const recipeTier = new Map<string, number>();
for (const schem of Object.values(sf.schematics)) {
  if (schem.type !== "EST_Milestone" && schem.type !== "EST_MAM") continue;
  const t = schem.tier ?? 0;
  for (const r of schem.unlock?.recipes ?? []) {
    // First-write wins so a recipe shared across milestones gets its
    // earliest unlock tier.
    if (!recipeTier.has(r)) recipeTier.set(r, t);
  }
}

// --- Item collection ----------------------------------------------------

// Track which items appear as ingredients/products of an included recipe.
// We bundle the entire SF item table but tag categories conservatively so
// the Library view doesn't surface garbage like in-hand stages or
// developer-only debug items.

const referencedItems = new Set<string>();

// --- Recipe conversion --------------------------------------------------

type SpecsRecipe = {
  id: string;
  name: string;
  buildingId: string;
  isAlt: boolean;
  unlockTier: number;
  cycleSeconds: number;
  inputs: Array<{ itemId: string; perMinute: number }>;
  outputs: Array<{ itemId: string; perMinute: number }>;
};

const recipes: SpecsRecipe[] = [];
for (const r of Object.values(sf.recipes)) {
  if (!r.inMachine) continue;
  if (!r.producedIn || r.producedIn.length === 0) continue;
  // Strip the resource-sink "Recipe_ResourceSink_*" stubs and "for-building"
  // recipes (those are the buildings themselves being placeable).
  if (r.forBuilding) continue;
  if (!INCLUDED_BUILDINGS.includes(r.producedIn[0])) continue;
  if (r.products.length === 0) continue;
  if (r.time <= 0) continue;

  const cycle = r.time;
  const inputs = r.ingredients.map((i) => ({
    itemId: i.item,
    perMinute: round2((i.amount * 60) / cycle),
  }));
  const outputs = r.products.map((p) => ({
    itemId: p.item,
    perMinute: round2((p.amount * 60) / cycle),
  }));

  // The producedIn list may include manual workshop equivalents.
  // Always take the first machine entry that's in INCLUDED_BUILDINGS,
  // then translate the SF `Desc_*_C` building id to the SPECS `Build_*_C`
  // convention so downstream code (factory commands, amp slot helper)
  // doesn't have to know about the dataset's internal naming.
  const descBuildingId = r.producedIn.find((b) => INCLUDED_BUILDINGS.includes(b)) ?? r.producedIn[0];
  const buildingId = BUILD_ID_BY_DESC[descBuildingId] ?? descBuildingId;

  // Alt recipes are scanned independently of milestone tiers — pin to 0 so
  // the player can unlock as soon as they have scanned the Hard Drive.
  // Base recipes inherit the earliest milestone tier we found that lists
  // them; fall back to 0 if none.
  const unlockTier = r.alternate ? 0 : recipeTier.get(r.className) ?? 0;

  recipes.push({
    id: r.className,
    name: r.name,
    buildingId,
    isAlt: r.alternate,
    unlockTier,
    cycleSeconds: cycle,
    inputs,
    outputs,
  });

  inputs.forEach((io) => referencedItems.add(io.itemId));
  outputs.forEach((io) => referencedItems.add(io.itemId));
}

// --- Item list ----------------------------------------------------------

type SpecsItem = {
  id: string;
  name: string;
  category: string;
  stackSize: number;
  isFluid: boolean;
};

const items: SpecsItem[] = [];
const itemIds = new Set<string>();
for (const it of Object.values(sf.items)) {
  if (!referencedItems.has(it.className)) continue;
  const cat = categorise(it);
  items.push({
    id: it.className,
    name: it.name,
    category: cat,
    stackSize: it.stackSize ?? (cat === "fluid" ? 1 : 100),
    isFluid: cat === "fluid",
  });
  itemIds.add(it.className);
}
// Sanity: any referenced item we didn't find in SF items map (rare but
// possible if SF data is out of sync) — synthesise a minimal entry so the
// validator doesn't reject the recipe that points at it.
for (const id of referencedItems) {
  if (itemIds.has(id)) continue;
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

const buildings = INCLUDED_BUILDINGS.map((descId) => ({
  id: BUILD_ID_BY_DESC[descId] ?? descId,
  name: BUILDING_NAMES[descId],
  category: BUILDING_CATEGORIES[descId],
  powerMw: POWER_MW_BY_BUILDING[descId] ?? 0,
  unlockTier: BUILDING_UNLOCK_TIER[descId] ?? 0,
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
// wiki. SF data omits the fuel-per-minute breakdown.
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
// Mk3=240 baseline.
const miners = [
  { id: "Build_MinerMk1_C", mark: 1, baseItemsPerMinute: 60, unlockTier: 0 },
  { id: "Build_MinerMk2_C", mark: 2, baseItemsPerMinute: 120, unlockTier: 3 },
  { id: "Build_MinerMk3_C", mark: 3, baseItemsPerMinute: 240, unlockTier: 7 },
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

// --- Output -------------------------------------------------------------

const output = {
  version: "1.1",
  gameVersion: "1.1",
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
console.log(
  `wrote ${OUT}\n  items: ${items.length}\n  buildings: ${buildings.length}\n  recipes: ${recipes.length} (${altCount} alts)\n  milestones: ${milestones.length}\n  generators: ${generators.length}\n  miners: ${miners.length}\n  transportVehicles: ${transportVehicles.length}`,
);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
