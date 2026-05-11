/**
 * Pure conversion from satisfactory-calculator.com map-data shape to SPECS'
 * resource-node catalog. Split out of the `bun`-only script so Vitest can
 * exercise it without process / fs / fixture-path concerns.
 */

export type Purity = "Impure" | "Normal" | "Pure";
export type NodeKind = "miner_node" | "fracking_well" | "geyser";
export type CatalogNode = {
  /** Stable id derived from the in-game pathName. */
  id: string;
  /** Game item id this node yields (e.g. `Desc_OreIron_C`). */
  resourceItemId: string;
  purity: Purity;
  kind: NodeKind;
  x: number;
  y: number;
  z: number;
  /** For fracking satellites, the shared `BP_FrackingCore*` group id. */
  coreId?: string;
};

type RawMarker = {
  pathName: string;
  x: number;
  y: number;
  z: number;
  type?: string;
  purity?: string;
  core?: string;
};
type RawLayer = { layerId: string; name: string; purity?: string; markers?: RawMarker[] };
type RawResource = { name: string; type?: string; options?: RawLayer[] };
type RawTab = { tabId?: string; name?: string; options?: RawResource[] };
export type RawMapData = { options: RawTab[] };

// SCIM ships the typo `RP_Inpure`; map both spellings to the canonical one.
const PURITY_MAP: Record<string, Purity> = {
  RP_Inpure: "Impure",
  RP_Impure: "Impure",
  RP_Normal: "Normal",
  RP_Pure: "Pure",
};

const TAB_KIND: Record<string, NodeKind> = {
  resource_nodes: "miner_node",
};

// SCIM splits oil into `Desc_LiquidOil_C` (surface seeps under
// resource_nodes) and `Desc_LiquidOilWell_C` (well satellites under
// resource_wells), but the game treats both as the same item — recipes
// take "Crude Oil" regardless of source. Normalise to the canonical
// gamedata id so the planner sees one supply pool.
const ITEM_ID_ALIAS: Record<string, string> = {
  Desc_LiquidOilWell_C: "Desc_LiquidOil_C",
};

function stableId(pathName: string): string {
  return pathName.replace(/^Persistent_Level:PersistentLevel\./, "");
}

export function convertMapData(raw: RawMapData): CatalogNode[] {
  const out: CatalogNode[] = [];
  const seen = new Set<string>();

  for (const tab of raw.options ?? []) {
    if (!tab.tabId) continue;
    const baseKind = TAB_KIND[tab.tabId];
    const isWells = tab.tabId === "resource_wells";
    if (!baseKind && !isWells) continue;

    for (const resource of tab.options ?? []) {
      const rawItemId = resource.type;
      if (!rawItemId) continue;
      const itemId = ITEM_ID_ALIAS[rawItemId] ?? rawItemId;
      for (const layer of resource.options ?? []) {
        const purity = PURITY_MAP[layer.purity ?? ""];
        if (!purity) continue;
        for (const marker of layer.markers ?? []) {
          const id = stableId(marker.pathName);
          if (seen.has(id)) continue;
          seen.add(id);
          // Within `resource_wells`, geysers are surfaced as a separate
          // resource — split them out so the UI can render geothermal
          // vents distinct from fluid satellites.
          const kind: NodeKind = isWells
            ? rawItemId === "Desc_Geyser_C"
              ? "geyser"
              : "fracking_well"
            : baseKind;
          out.push({
            id,
            resourceItemId: itemId,
            purity,
            kind,
            x: marker.x,
            y: marker.y,
            z: marker.z,
            ...(marker.core
              ? { coreId: marker.core.replace(/^Persistent_Level:PersistentLevel\./, "") }
              : {}),
          });
        }
      }
    }
  }

  out.sort((a, b) =>
    a.resourceItemId === b.resourceItemId
      ? a.purity === b.purity
        ? a.id.localeCompare(b.id)
        : a.purity.localeCompare(b.purity)
      : a.resourceItemId.localeCompare(b.resourceItemId),
  );

  return out;
}
