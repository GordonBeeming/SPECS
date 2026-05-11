import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Factory as FactoryGlyph, Pencil, Trash2, Zap } from "lucide-react";
import { Icon } from "@/shared/ui/Icon";
import { useNavStore } from "@/shared/nav-store";
import { EditPowerGenModal } from "./EditPowerGenModal";
import { useAllPowerGens } from "../hooks/usePower";
import type { PowerGen } from "../types";
import type { Factory } from "@/features/factory/types";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { FilterSelect } from "@/shared/ui/FilterSelect";
import { useFactoryList } from "@/features/factory/hooks/useFactories";
import { useGenerators, useItems } from "@/features/library/hooks/useLibrary";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import {
  useAddPowerGen,
  usePowerBalance,
  usePowerGens,
  useRemovePowerGen,
} from "../hooks/usePower";
import type { CreatePowerGenInput } from "../types";

export function PowerView() {
  const playthrough = useCurrentPlaythrough();
  const factories = useFactoryList();
  const allGens = useAllPowerGens();
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
  const genCountByFactory = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of allGens.data ?? []) {
      m.set(g.factoryId, (m.get(g.factoryId) ?? 0) + 1);
    }
    return m;
  }, [allGens.data]);
  // Filter the factory list before the early returns for the same
  // reason — keeps the hook count constant across all render paths.
  const factoryListFiltered = useMemo(() => {
    const all = factories.data ?? [];
    return all.filter(
      (f) =>
        (genCountByFactory.get(f.id) ?? 0) > 0 ||
        f.id === selectedFactoryId,
    );
  }, [factories.data, genCountByFactory, selectedFactoryId]);

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

  // Only surface factories that actually carry generators (or the
  // one the user is currently editing) — pure item factories pad
  // the sidebar without belonging here.
  const factoryList = factoryListFiltered;
  const activeId = selectedFactoryId ?? factoryList[0]?.id ?? null;

  if (factoryList.length === 0) {
    return (
      <Card className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-primary">Power</h1>
        <p className="mt-2 text-sm text-fg-muted">
          No factories with power generators yet. Pop over to
          Factories, open one, and hit <strong>Add power</strong> to
          start building a power plant.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid h-full gap-4 lg:grid-cols-[20rem_1fr]">
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
  );
}

interface PowerFactoryRowProps {
  factory: Factory;
  active: boolean;
  genCount: number;
  onSelect: () => void;
}

function PowerFactoryRow({ factory, active, genCount, onSelect }: PowerFactoryRowProps) {
  return (
    <li
      className={`rounded-md transition-colors ${
        active ? "bg-primary/10" : "hover:bg-border/40"
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
        {/* Surface what's on each factory at a glance: a ⚡ if it has
            power, plus the machine count (so 'mixed-use' factories
            read as both kinds). Avoids a hard 'power factory vs item
            factory' classification while still making power-only
            rows stand out. */}
        {genCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 text-[10px] font-medium text-warning"
            title={`${genCount} generator${genCount === 1 ? "" : "s"}`}
          >
            <Zap className="h-3 w-3" />
            {genCount}
          </span>
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
  const playthrough = useCurrentPlaythrough();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<PowerGen | null>(null);
  // Tauri 2's webview suppresses window.confirm()/alert() — using
  // the browser dialog meant clicking Trash silently did nothing.
  // Two-click confirm instead: first click arms the row, second
  // fires the mutation. Auto-disarms after 3 s so a stale primed
  // row can't accidentally delete on the next click.
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
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
                                remove.mutate(g.id, {
                                  onError: (err) => {
                                    // Surface mutation errors instead of
                                    // swallowing them silently — the
                                    // earlier "delete does nothing" report
                                    // was a missing error path.
                                    console.error("remove power_gen failed", err);
                                    alert(
                                      `Delete failed: ${
                                        err instanceof Error ? err.message : String(err)
                                      }`,
                                    );
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
        const fuelOptions = (gen?.fuels ?? []).map((f) => ({
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
            Fuel demand (items / min)
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
  onSubmitted,
}: {
  factoryId: string;
  eligibleGenerators: ReturnType<typeof useGenerators>["data"];
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
    generator?.fuels.map((f) => ({
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
