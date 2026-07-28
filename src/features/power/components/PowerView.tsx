import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CircleAlert,
  Factory as FactoryGlyph,
  Pencil,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Icon } from "@/shared/ui/Icon";
import { useNavStore } from "@/shared/nav-store";
import { EditPowerGenModal } from "./EditPowerGenModal";
import { useAllPowerBalances, useAllPowerGens } from "../hooks/usePower";
import type { FactoryPowerBalance, PowerGen } from "../types";
import type { Factory } from "@/features/factory/types";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useGenerators, useItems } from "@/features/library/hooks/useLibrary";
import { useItemTiers } from "@/features/planner/hooks/useItemTiers";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import {
  useAddPowerGen,
  usePowerBalance,
  usePowerGens,
  useRemovePowerGen,
} from "../hooks/usePower";
import type { CreatePowerGenInput, PowerFuelFlow } from "../types";

const DEFICIT_EPSILON = 0.001;

/** The fuel demand card's header used to hardcode "items / min", which
 * reads wrong the moment a fluid fuel (Fuel, Turbofuel, Water for a
 * Nuclear Plant, …) shows up — each row already tags its own unit, so
 * the header should follow suit instead of asserting one for all of
 * them. */
function fuelDemandUnitLabel(flows: PowerFuelFlow[]): string {
  const hasFluid = flows.some((f) => f.isFluid);
  const hasSolid = flows.some((f) => !f.isFluid);
  if (hasFluid && hasSolid) return "items / min or m³ / min";
  return hasFluid ? "m³ / min" : "items / min";
}

/** Rank used to sort the sidebar so a factory that needs attention is
 * never buried below idle ones: unpowered draw first, then any other
 * deficit, then everything else. Matches the severities the backend
 * validation sweep already assigns (`PowerDeficit` = warning per
 * factory, `GridDeficit` = error for the whole playthrough) so the
 * ordering agrees with what Validate would flag. */
function powerUrgencyRank(genCount: number, balance: FactoryPowerBalance | undefined): number {
  if (!balance) return 2;
  if (genCount === 0 && balance.consumedMw > DEFICIT_EPSILON) return 0;
  if (balance.netMw < -DEFICIT_EPSILON) return 1;
  return 2;
}

export function PowerView() {
  const playthrough = useCurrentPlaythrough();
  const factories = useFactoryList();
  const allGens = useAllPowerGens();
  const balances = useAllPowerBalances();
  const takePendingFactoryId = useNavStore((s) => s.takePendingFactoryId);
  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);

  // Deep-link: if the Factories tab pushed an "open this factory in
  // Power" intent through the nav store, snap to that selection on
  // first paint.
  useEffect(() => {
    const pending = takePendingFactoryId();
    if (pending) setSelectedFactoryId(pending);
    // takePendingFactoryId is stable (zustand action) — don't depend
    // on it or this fires twice and clears legitimate selections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Per-factory generator counts — hoisted above the early returns
  // so the hook order stays stable across renders (Rules of Hooks).
  // Sum each row's `count` (physical generators of that type), not
  // the number of rows: one row can represent many machines (e.g. 8
  // Biomass Burners split across two rows for different fuel notes),
  // and the badge is meant to answer "how many generators", not "how
  // many rows".
  const genCountByFactory = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of allGens.data ?? []) {
      m.set(g.factoryId, (m.get(g.factoryId) ?? 0) + g.count);
    }
    return m;
  }, [allGens.data]);
  const balanceByFactory = useMemo(() => {
    const m = new Map<string, FactoryPowerBalance>();
    for (const b of balances.data ?? []) {
      m.set(b.factoryId, b);
    }
    return m;
  }, [balances.data]);
  const gridTotal = useMemo(() => {
    const list = balances.data ?? [];
    const generatedMw = list.reduce((sum, b) => sum + b.generatedMw, 0);
    const consumedMw = list.reduce((sum, b) => sum + b.consumedMw, 0);
    return { generatedMw, consumedMw, netMw: generatedMw - consumedMw };
  }, [balances.data]);
  // Every factory belongs on this screen now — an unpowered factory
  // is exactly what a player comes here to find, so nothing gets
  // filtered out of the list anymore. Sort by urgency instead so the
  // factories that need attention aren't buried below idle ones.
  const factoryListSorted = useMemo(() => {
    const all = factories.data ?? [];
    return [...all].sort((a, b) => {
      const rankA = powerUrgencyRank(genCountByFactory.get(a.id) ?? 0, balanceByFactory.get(a.id));
      const rankB = powerUrgencyRank(genCountByFactory.get(b.id) ?? 0, balanceByFactory.get(b.id));
      return rankA - rankB;
    });
  }, [factories.data, genCountByFactory, balanceByFactory]);

  if (!playthrough.data) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Power</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open or create a playthrough from the header to plan power
          generation per factory.
        </p>
      </Card>
    );
  }

  const factoryList = factoryListSorted;
  const activeId = selectedFactoryId ?? factoryList[0]?.id ?? null;

  if (factoryList.length === 0) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Power</h1>
        <p className="mt-2 text-sm text-fg-muted">
          No factories in this playthrough yet. Create one in Factories,
          then come back here to plan its power.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <GridTotalBar total={gridTotal} loading={balances.isPending} />
      <div className="grid flex-1 gap-4 overflow-hidden lg:grid-cols-[20rem_1fr]">
        <Card className="flex flex-col gap-3 overflow-hidden">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
              <Zap className="h-4 w-4 text-warning" />
              Power
            </h1>
            <p className="text-xs text-fg-muted">
              {playthrough.data.displayName} · T{playthrough.data.currentTier}
            </p>
          </div>
          <ul className="flex flex-1 flex-col gap-1 overflow-auto">
            {factoryList.map((f) => (
              <PowerFactoryRow
                key={f.id}
                factory={f}
                active={activeId === f.id}
                genCount={genCountByFactory.get(f.id) ?? 0}
                balance={balanceByFactory.get(f.id)}
                onSelect={() => setSelectedFactoryId(f.id)}
              />
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col overflow-hidden">
          {activeId ? (
            <PowerFactoryPanel factoryId={activeId} />
          ) : (
            <div className="m-auto max-w-md text-center text-sm text-fg-muted">
              Pick a factory on the left to add or edit its power
              generators.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

interface GridTotal {
  generatedMw: number;
  consumedMw: number;
  netMw: number;
}

/** Playthrough-wide total — the number Validate already computes for
 * its grid-deficit check, surfaced here too so Power stops being the
 * one screen that can't answer "do I have enough power, overall?".
 * Red (not amber) when the grid itself is short, matching Validate's
 * `GridDeficit` being an error rather than a warning. */
function GridTotalBar({ total, loading }: { total: GridTotal; loading: boolean }) {
  const deficit = total.netMw < -DEFICIT_EPSILON;
  return (
    <Card
      className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${
        deficit ? "border-danger/50 bg-danger/5" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-fg">
        {deficit ? (
          <CircleAlert className="h-4 w-4 shrink-0 text-danger" />
        ) : (
          <Zap className="h-4 w-4 shrink-0 text-warning" />
        )}
        Grid
      </div>
      <div>
        <div className="text-xs text-fg-muted">Generated</div>
        <div className="text-base font-semibold tabular-nums">
          {loading ? "—" : total.generatedMw.toFixed(1)} MW
        </div>
      </div>
      <div>
        <div className="text-xs text-fg-muted">Consumed</div>
        <div className="text-base font-semibold tabular-nums">
          {loading ? "—" : total.consumedMw.toFixed(1)} MW
        </div>
      </div>
      <div>
        <div className="text-xs text-fg-muted">Net</div>
        <div
          className={`text-base font-semibold tabular-nums ${
            deficit ? "text-danger" : "text-success"
          }`}
        >
          {loading ? "—" : total.netMw.toFixed(1)} MW
        </div>
      </div>
      {deficit && !loading && (
        <p className="text-xs text-danger">
          The playthrough draws {Math.abs(total.netMw).toFixed(1)} MW more than
          it generates — add generators to the factories below.
        </p>
      )}
    </Card>
  );
}

interface PowerFactoryRowProps {
  factory: Factory;
  active: boolean;
  genCount: number;
  balance: FactoryPowerBalance | undefined;
  onSelect: () => void;
}

function PowerFactoryRow({ factory, active, genCount, balance, onSelect }: PowerFactoryRowProps) {
  const urgency = powerUrgencyRank(genCount, balance);
  const unpowered = urgency === 0;
  const deficit = urgency === 1;
  return (
    <li
      className={`rounded-md transition-colors ${
        active
          ? "bg-primary/10"
          : unpowered
            ? "bg-danger/10 hover:bg-danger/15"
            : deficit
              ? "bg-warning/10 hover:bg-warning/15"
              : "hover:bg-border/40"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left"
      >
        {factory.iconId ? (
          <Icon itemId={factory.iconId} alt="" className="h-5 w-5 shrink-0" />
        ) : (
          <FactoryGlyph className="h-4 w-4 shrink-0 text-fg-muted" />
        )}
        <span className="flex-1 truncate text-sm font-medium text-fg">{factory.name}</span>
        {/* An unpowered factory that's actually drawing power is what
            this screen exists to surface, so it outranks every other
            badge. A factory with generators that still can't keep up
            is the next-most urgent. Everything else keeps the quieter
            "has generators" chip it always had. */}
        {unpowered ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-1.5 text-[10px] font-medium text-danger"
            title={`Draws ${balance?.consumedMw.toFixed(1)} MW with no generators`}
          >
            <CircleAlert className="h-3 w-3" />
            No power
          </span>
        ) : deficit ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning"
            title="Generators here can't cover the draw"
          >
            <TriangleAlert className="h-3 w-3" />
            {balance?.netMw.toFixed(1)} MW
          </span>
        ) : (
          genCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning"
              title={`${genCount} generator${genCount === 1 ? "" : "s"}`}
            >
              <Zap className="h-3 w-3" />
              {genCount}
            </span>
          )
        )}
        <span className="ml-1 text-xs text-fg-muted tabular-nums">
          {factory.machineCount}m
        </span>
      </button>
    </li>
  );
}

function PowerFactoryPanel({ factoryId }: { factoryId: string }) {
  const gens = usePowerGens(factoryId);
  const balance = usePowerBalance(factoryId);
  const remove = useRemovePowerGen(factoryId);
  const generators = useGenerators();
  const items = useItems();
  const itemTiers = useItemTiers();
  const playthrough = useCurrentPlaythrough();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<PowerGen | null>(null);
  // Tauri 2's webview suppresses window.confirm()/alert() — using
  // the browser dialog meant clicking Trash silently did nothing.
  // Two-click confirm instead: first click arms the row, second
  // fires the mutation. Auto-disarms after 3 s so a stale primed
  // row can't accidentally delete on the next click.
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  // Per-row delete error string. Tauri 2 also suppresses window.alert()
  // so surfacing mutation errors via alert() is invisible — render them
  // inline on the row instead.
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const armForDelete = (id: string) => {
    setArmedDeleteId(id);
    window.setTimeout(() => {
      setArmedDeleteId((cur) => (cur === id ? null : cur));
    }, 3000);
  };

  const generatorsById = useMemo(
    () => new Map(generators.data?.map((g) => [g.id, g]) ?? []),
    [generators.data],
  );
  const itemsById = useMemo(
    () => new Map(items.data?.map((i) => [i.id, i]) ?? []),
    [items.data],
  );

  const tierCap = playthrough.data?.currentTier ?? 9;
  const eligibleGenerators = (generators.data ?? []).filter(
    (g) => g.unlockTier <= tierCap,
  );
  // A generator can list fuels from across the whole game (e.g. the Fuel
  // Generator takes Fuel through Ionized Fuel), so its own unlockTier
  // isn't a stand-in for its fuels' tiers — each fuel item needs its own
  // gate. `useItemTiers` walks the whole input chain, the same table the
  // product picker uses — a fuel's own recipe stamp isn't enough:
  // Ionized Fuel is stamped T5 but consumes Rocket Fuel, whose standard
  // recipe doesn't ground out until T7, so gating on the stamp let a
  // fuel through before its own inputs were reachable. An item absent
  // from the table (no chain reaches it) falls back to 99 — effectively
  // "never" — rather than 0, so an unreachable fuel is excluded instead
  // of treated as always available.
  const itemTierById = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of itemTiers.data ?? []) {
      if (t.tier !== null) map.set(t.itemId, t.tier);
    }
    return map;
  }, [itemTiers.data]);

  return (
    <>
      <Card className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Zap className="h-5 w-5 text-warning" />
          <div>
            <div className="text-xs text-fg-muted">Generated</div>
            <div className="text-lg font-semibold tabular-nums">
              {balance.data ? balance.data.generatedMw.toFixed(1) : "—"} MW
            </div>
          </div>
          <div>
            <div className="text-xs text-fg-muted">Consumed</div>
            <div className="text-lg font-semibold tabular-nums">
              {balance.data ? balance.data.consumedMw.toFixed(1) : "—"} MW
            </div>
          </div>
          <div>
            <div className="text-xs text-fg-muted">Net</div>
            <div
              className={`text-lg font-semibold tabular-nums ${
                balance.data && balance.data.netMw < 0 ? "text-danger" : "text-success"
              }`}
            >
              {balance.data ? balance.data.netMw.toFixed(1) : "—"} MW
            </div>
          </div>
        </div>
        <Button onClick={() => setShowAdd((v) => !v)} variant={showAdd ? "ghost" : "primary"}>
          {showAdd ? "Cancel" : "Add generator"}
        </Button>
      </Card>

      {showAdd && (
        <Card>
          <AddPowerGenForm
            factoryId={factoryId}
            eligibleGenerators={eligibleGenerators}
            itemTierById={itemTierById}
            tierCap={tierCap}
            onSubmitted={() => setShowAdd(false)}
          />
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Generators</h2>
        {gens.isPending && <div className="mt-2 text-sm text-fg-muted">Loading…</div>}
        {gens.data && gens.data.length === 0 && (
          <div className="mt-2 rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            No generators yet. Click <strong>Add generator</strong> to plan
            your power supply.
          </div>
        )}
        {gens.data && gens.data.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-border/50 text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Generator</th>
                  <th className="px-3 py-2 text-left font-medium">Fuel</th>
                  <th className="px-3 py-2 text-right font-medium">Count</th>
                  <th className="px-3 py-2 text-right font-medium">Clock</th>
                  <th className="px-3 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {gens.data.map((g) => {
                  const gen = generatorsById.get(g.generatorId);
                  const fuelName = itemsById.get(g.fuelItemId)?.name ?? g.fuelItemId;
                  return (
                    <tr key={g.id} className="hover:bg-border/30">
                      <td className="px-3 py-2">{gen?.name ?? g.generatorId}</td>
                      <td className="px-3 py-2 text-fg-muted">{fuelName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {g.clockPct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditing(g)}
                            aria-label="Edit generator"
                            className="rounded-md p-1.5 text-fg-muted hover:bg-border hover:text-fg"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {armedDeleteId === g.id ? (
                            <button
                              type="button"
                              onClick={() => {
                                const rowId = g.id;
                                setDeleteError(null);
                                remove.mutate(rowId, {
                                  onError: (err) => {
                                    console.error("remove power_gen failed", err);
                                    setDeleteError({
                                      id: rowId,
                                      message:
                                        err instanceof Error ? err.message : String(err),
                                    });
                                  },
                                });
                                setArmedDeleteId(null);
                              }}
                              aria-label="Click to confirm delete"
                              className="inline-flex items-center gap-1 rounded-md bg-danger px-2 py-1 text-xs font-medium text-white hover:opacity-90"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => armForDelete(g.id)}
                              aria-label="Remove generator"
                              title="Click to delete (confirms next click)"
                              className="rounded-md p-1.5 text-fg-muted hover:bg-danger/20 hover:text-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {deleteError?.id === g.id && (
                          <div
                            role="alert"
                            className="mt-1 text-right text-[11px] text-danger"
                          >
                            Delete failed: {deleteError.message}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (() => {
        const gen = generatorsById.get(editing.generatorId);
        // Gate by the fuel item's own tier, not the generator's — but
        // never drop the fuel already saved on this row, even if the
        // player's tier cap somehow sits below it (an edit shouldn't
        // silently reassign a choice the player already made).
        const fuelOptions = (gen?.fuels ?? [])
          .filter(
            (f) =>
              f.fuelItemId === editing.fuelItemId ||
              (itemTierById.get(f.fuelItemId) ?? 99) <= tierCap,
          )
          .map((f) => ({
            id: f.fuelItemId,
            name: itemsById.get(f.fuelItemId)?.name ?? f.fuelItemId,
          }));
        return (
          <EditPowerGenModal
            factoryId={factoryId}
            gen={editing}
            generatorName={gen?.name ?? editing.generatorId}
            fuelOptions={fuelOptions}
            onClose={() => setEditing(null)}
          />
        );
      })()}

      {balance.data && balance.data.fuelFlows.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">
            Fuel demand ({fuelDemandUnitLabel(balance.data.fuelFlows)})
          </h2>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {balance.data.fuelFlows.map((f) => (
              <li
                key={f.itemId}
                className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 text-sm"
              >
                <span className="text-fg">{f.itemName}</span>
                <span className="tabular-nums text-fg-muted">
                  {f.perMinute.toFixed(2)} {f.isFluid ? "m³/min" : "/min"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function AddPowerGenForm({
  factoryId,
  eligibleGenerators,
  itemTierById,
  tierCap,
  onSubmitted,
}: {
  factoryId: string;
  eligibleGenerators: ReturnType<typeof useGenerators>["data"];
  itemTierById: Map<string, number>;
  tierCap: number;
  onSubmitted: () => void;
}) {
  const items = useItems();
  const add = useAddPowerGen(factoryId);
  const [generatorId, setGeneratorId] = useState("");
  const [fuelItemId, setFuelItemId] = useState("");
  const [count, setCount] = useState(1);
  const [clockPct, setClockPct] = useState(100);
  const [error, setError] = useState<string | null>(null);

  const generator = (eligibleGenerators ?? []).find((g) => g.id === generatorId);
  const itemsById = new Map(items.data?.map((i) => [i.id, i]) ?? []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!generator) {
      setError("Pick a generator.");
      return;
    }
    // Geothermal generators don't burn anything — let `add_power_gen`
    // see an empty fuel id when the generator has no fuels listed.
    if (generator.fuels.length > 0 && !fuelItemId) {
      setError("Pick a fuel.");
      return;
    }
    if (!Number.isFinite(count) || count < 1 || count > 10_000) {
      setError("Count must be between 1 and 10,000.");
      return;
    }
    if (!Number.isFinite(clockPct) || clockPct < 1 || clockPct > 250) {
      setError("Clock must be between 1% and 250%.");
      return;
    }
    setError(null);
    const input: CreatePowerGenInput = {
      factoryId,
      generatorId: generator.id,
      fuelItemId: generator.fuels.length > 0 ? fuelItemId : "",
      count,
      clockPct,
    };
    add.mutate(input, { onSuccess: () => onSubmitted() });
  };

  const fuelOptions =
    generator?.fuels
      // Fuel item tiers, not the generator's — the Fuel Generator alone
      // spans Fuel through Ionized Fuel, so gating on its own unlockTier
      // would let T8/T9 fuels through as soon as the generator itself is
      // available.
      .filter((f) => (itemTierById.get(f.fuelItemId) ?? 99) <= tierCap)
      .map((f) => ({
        value: f.fuelItemId,
        label: itemsById.get(f.fuelItemId)?.name ?? f.fuelItemId,
        hint: `${f.fuelPerMinute.toFixed(2)} /min` +
          (f.supplementalItemId
            ? ` + ${f.supplementalPerMinute?.toFixed(0) ?? "?"} ${
                itemsById.get(f.supplementalItemId)?.name ?? f.supplementalItemId
              }`
            : ""),
        iconId: f.fuelItemId,
      })) ?? [];

  const serverError = add.error instanceof Error ? add.error.message : null;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid gap-3 md:grid-cols-[1fr_1fr_6rem_8rem_auto] md:items-end"
    >
      <label className="block">
        <span className="text-xs font-medium text-fg-muted">Generator</span>
        <div className="mt-1">
          <FilterSelect
            ariaLabel="Generator"
            compact
            placeholder="Pick a generator…"
            value={generatorId || null}
            onChange={(next) => {
              setGeneratorId(next ?? "");
              setFuelItemId("");
            }}
            options={(eligibleGenerators ?? []).map((g) => ({
              value: g.id,
              label: g.name,
              hint: `${g.powerMw} MW · T${g.unlockTier}`,
              iconId: g.id,
            }))}
          />
        </div>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-fg-muted">Fuel</span>
        <div className="mt-1">
          <FilterSelect
            ariaLabel="Fuel"
            compact
            placeholder={generator && generator.fuels.length === 0 ? "—" : "Pick a fuel…"}
            value={fuelItemId || null}
            onChange={(next) => setFuelItemId(next ?? "")}
            options={fuelOptions}
          />
        </div>
      </label>
      <label className="block">
        <span className="text-xs font-medium text-fg-muted">Count</span>
        <input
          type="number"
          min={1}
          max={10000}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-fg-muted">Clock %</span>
        <input
          type="number"
          min={1}
          max={250}
          step={0.1}
          value={clockPct}
          onChange={(e) => setClockPct(Number(e.target.value))}
          className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
        />
      </label>
      <Button type="submit" disabled={add.isPending}>
        {add.isPending ? "Adding…" : "Add"}
      </Button>
      {(error || serverError) && (
        <p role="alert" className="md:col-span-5 text-sm text-danger">
          {error ?? serverError}
        </p>
      )}
    </form>
  );
}
