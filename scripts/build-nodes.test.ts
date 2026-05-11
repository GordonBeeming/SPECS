import { describe, expect, it } from "vitest";
import { convertMapData, type RawMapData } from "./build-nodes.lib";

const sample: RawMapData = {
  options: [
    {
      tabId: "resource_nodes",
      name: "Resource nodes",
      options: [
        {
          name: "Iron Ore",
          type: "Desc_OreIron_C",
          options: [
            {
              layerId: "ironImpure",
              name: "Iron (Impure)",
              purity: "RP_Inpure", // SCIM typo
              markers: [
                {
                  pathName: "Persistent_Level:PersistentLevel.BP_ResourceNode1",
                  x: 1,
                  y: 2,
                  z: 3,
                  type: "Desc_OreIron_C",
                  purity: "RP_Inpure",
                },
              ],
            },
            {
              layerId: "ironPure",
              name: "Iron (Pure)",
              purity: "RP_Pure",
              markers: [
                {
                  pathName: "Persistent_Level:PersistentLevel.BP_ResourceNode2",
                  x: 4,
                  y: 5,
                  z: 6,
                  type: "Desc_OreIron_C",
                  purity: "RP_Pure",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      tabId: "resource_wells",
      name: "Resource wells",
      options: [
        {
          name: "Water",
          type: "Desc_Water_C",
          options: [
            {
              layerId: "waterWellPure",
              name: "Water (Pure)",
              purity: "RP_Pure",
              markers: [
                {
                  pathName: "Persistent_Level:PersistentLevel.BP_FrackingSatellite1",
                  x: 10,
                  y: 20,
                  z: 30,
                  type: "Desc_Water_C",
                  purity: "RP_Pure",
                  core: "Persistent_Level:PersistentLevel.BP_FrackingCore1",
                },
              ],
            },
          ],
        },
        {
          name: "Geysers",
          type: "Desc_Geyser_C",
          options: [
            {
              layerId: "geyserNormal",
              name: "Geyser (Normal)",
              purity: "RP_Normal",
              markers: [
                {
                  pathName: "Persistent_Level:PersistentLevel.BP_ResourceNodeGeyser_1",
                  x: 0,
                  y: 0,
                  z: 0,
                  purity: "RP_Normal",
                },
              ],
            },
          ],
        },
      ],
    },
    // Tabs we don't care about must be skipped silently so the converter
    // tolerates SCIM adding new tabs in future map data dumps.
    {
      tabId: "power_slugs",
      name: "Power slugs",
      options: [
        {
          name: "Blue Slug",
          type: "Desc_Crystal_C",
          options: [
            {
              layerId: "powerSlugBlue",
              name: "Blue",
              purity: "RP_Normal",
              markers: [{ pathName: "x", x: 0, y: 0, z: 0 }],
            },
          ],
        },
      ],
    },
  ],
};

describe("convertMapData", () => {
  it("flattens both resource_nodes and resource_wells tabs, splitting geysers from fluid wells", () => {
    const out = convertMapData(sample);
    expect(out).toHaveLength(4);
    expect(out.find((n) => n.id === "BP_ResourceNode1")).toMatchObject({
      resourceItemId: "Desc_OreIron_C",
      purity: "Impure",
      kind: "miner_node",
    });
    expect(out.find((n) => n.id === "BP_FrackingSatellite1")).toMatchObject({
      resourceItemId: "Desc_Water_C",
      purity: "Pure",
      kind: "fracking_well",
      coreId: "BP_FrackingCore1",
    });
    expect(out.find((n) => n.id === "BP_ResourceNodeGeyser_1")).toMatchObject({
      resourceItemId: "Desc_Geyser_C",
      kind: "geyser",
    });
  });

  it("normalises the SCIM `RP_Inpure` typo to `Impure`", () => {
    const out = convertMapData(sample);
    expect(out.every((n) => ["Impure", "Normal", "Pure"].includes(n.purity))).toBe(true);
  });

  it("ignores tabs that aren't resource nodes or wells", () => {
    const out = convertMapData(sample);
    expect(out.some((n) => n.resourceItemId === "Desc_Crystal_C")).toBe(false);
  });

  it("deduplicates by pathName so re-runs are idempotent", () => {
    const doubled: RawMapData = {
      options: [
        {
          tabId: "resource_nodes",
          options: [
            {
              name: "Iron",
              type: "Desc_OreIron_C",
              options: [
                {
                  layerId: "ironPure",
                  name: "Iron Pure",
                  purity: "RP_Pure",
                  markers: [
                    { pathName: "Persistent_Level:PersistentLevel.BP_Dup", x: 0, y: 0, z: 0 },
                    { pathName: "Persistent_Level:PersistentLevel.BP_Dup", x: 0, y: 0, z: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(convertMapData(doubled)).toHaveLength(1);
  });

  it("produces stable output order so the catalog diff is reviewable", () => {
    const a = convertMapData(sample);
    const b = convertMapData(sample);
    expect(a.map((n) => n.id)).toEqual(b.map((n) => n.id));
  });
});
