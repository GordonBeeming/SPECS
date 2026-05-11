import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, MapPin } from "lucide-react";

import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { Card } from "@/shared/ui/Card";
import { Icon } from "@/shared/ui/Icon";

import { useResourceNodes } from "../hooks/useResources";
import type { Purity, ResourceNodeRow } from "../types";
import { NodeRow } from "./NodeRow";

// Display order — broadly: solids first (alphabetical-ish by tier), then
// fluids, then geysers last. Matches how the game introduces them in
// onboarding.
const RESOURCE_ORDER: string[] = [
  "Desc_OreIron_C",
  "Desc_OreCopper_C",
  "Desc_Stone_C",
  "Desc_Coal_C",
  "Desc_OreGold_C",
  "Desc_RawQuartz_C",
  "Desc_Sulfur_C",
  "Desc_OreBauxite_C",
  "Desc_OreUranium_C",
  "Desc_SAM_C",
  "Desc_LiquidOil_C",
  "Desc_Water_C",
  "Desc_NitrogenGas_C",
  "Desc_Geyser_C",
];

const PURITY_ORDER: Purity[] = ["Pure", "Normal", "Impure"];

function orderResource(a: string, b: string): number {
  const ai = RESOURCE_ORDER.indexOf(a);
  const bi = RESOURCE_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}

interface ResourceGroup {
  resourceItemId: string;
  resourceItemName: string;
  byPurity: Map<Purity, ResourceNodeRow[]>;
  totalIpm: number;
  claimed: number;
  total: number;
}

function groupNodes(rows: ResourceNodeRow[]): ResourceGroup[] {
  const map = new Map<string, ResourceGroup>();
  for (const row of rows) {
    let g = map.get(row.resourceItemId);
    if (!g) {
      g = {
        resourceItemId: row.resourceItemId,
        resourceItemName: row.resourceItemName,
        byPurity: new Map(),
        totalIpm: 0,
        claimed: 0,
        total: 0,
      };
      map.set(row.resourceItemId, g);
    }
    const bucket = g.byPurity.get(row.purity) ?? [];
    bucket.push(row);
    g.byPurity.set(row.purity, bucket);
    g.total++;
    if (row.claim) g.claimed++;
    g.totalIpm += row.itemsPerMinute;
  }
  return Array.from(map.values()).sort((a, b) =>
    orderResource(a.resourceItemId, b.resourceItemId),
  );
}

export function ResourcesView() {
  const playthrough = useCurrentPlaythrough();
  const nodes = useResourceNodes();
  const factories = useFactoryList();
  const [open, setOpen] = useState<Set<string>>(new Set(["Desc_OreIron_C"]));

  const groups = useMemo(
    () => (nodes.data ? groupNodes(nodes.data) : []),
    [nodes.data],
  );

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Resource nodes</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to start claiming
          resource nodes. The bundled catalog ships 608 nodes across 15
          resource types — claim the ones you've actually placed extractors
          on so the planner knows what supply you have.
        </p>
      </Card>
    );
  }

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
              <MapPin className="h-4 w-4" />
              Resource nodes
            </h1>
            <p className="text-xs text-fg-muted">
              {playthrough.data.displayName} · T{playthrough.data.currentTier} ·
              claim the nodes you've placed extractors on so the planner can
              constrain by supply
            </p>
          </div>
          {nodes.data && (
            <div className="text-right text-xs text-fg-muted">
              <div>
                <span className="font-semibold text-fg">
                  {groups.reduce((s, g) => s + g.claimed, 0)}
                </span>
                {" / "}
                {groups.reduce((s, g) => s + g.total, 0)} claimed
              </div>
              <div>
                {Math.round(groups.reduce((s, g) => s + g.totalIpm, 0))} ipm
                total
              </div>
            </div>
          )}
        </div>
      </Card>

      {nodes.isPending && (
        <Card>
          <div className="text-sm text-fg-muted">Loading nodes…</div>
        </Card>
      )}

      {nodes.data &&
        groups.map((g) => {
          const isOpen = open.has(g.resourceItemId);
          const purities = PURITY_ORDER.map((p) => [
            p,
            g.byPurity.get(p) ?? [],
          ] as const).filter(([, rows]) => rows.length > 0);
          return (
            <Card key={g.resourceItemId} className="p-0 overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(g.resourceItemId)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-border/40"
                aria-expanded={isOpen}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" />
                  )}
                  <Icon
                    itemId={g.resourceItemId}
                    alt={g.resourceItemName}
                    className="h-6 w-6 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-fg">
                      {g.resourceItemName}
                    </div>
                    <div className="text-xs text-fg-muted">
                      {g.claimed}/{g.total} claimed
                      {g.totalIpm > 0 && (
                        <>
                          {" · "}
                          <span className="font-medium text-fg">
                            {Math.round(g.totalIpm)} ipm
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border">
                  {purities.map(([purity, rows]) => (
                    <PurityBucket
                      key={purity}
                      purity={purity}
                      rows={rows}
                      factories={factories.data ?? []}
                    />
                  ))}
                </div>
              )}
            </Card>
          );
        })}
    </div>
  );
}

interface PurityBucketProps {
  purity: Purity;
  rows: ResourceNodeRow[];
  factories: { id: string; name: string }[];
}

function PurityBucket({ purity, rows, factories }: PurityBucketProps) {
  const claimed = rows.filter((r) => r.claim).length;
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-3 bg-bg/60 px-5 py-2 text-xs uppercase tracking-wide text-fg-muted">
        <span>
          <span
            className={`mr-2 inline-block h-2 w-2 rounded-full ${
              purity === "Pure"
                ? "bg-amber-400"
                : purity === "Normal"
                  ? "bg-slate-300"
                  : "bg-orange-700"
            }`}
            aria-hidden
          />
          {purity}
        </span>
        <span>
          {claimed}/{rows.length}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row, i) => (
          <NodeRow key={row.id} row={row} factories={factories} index={i} />
        ))}
      </ul>
    </div>
  );
}
