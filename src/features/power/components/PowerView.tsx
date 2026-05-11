import { useMemo, useState, type FormEvent } from "react";
import { Pencil, Trash2, Zap } from "lucide-react";
import { EditPowerGenModal } from "./EditPowerGenModal";
import type { PowerGen } from "../types";
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
  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);

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

  const factoryList = factories.data ?? [];
  const activeId = selectedFactoryId ?? factoryList[0]?.id ?? null;

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Power</h1>
          <p className="text-xs text-fg-muted">
            {playthrough.data.displayName} · T{playthrough.data.currentTier}
          </p>
        </div>
        {factoryList.length > 1 && (
          <label className="text-xs text-fg-muted">
            <span className="mr-2">Factory</span>
            <select
              aria-label="Factory"
              value={activeId ?? ""}
              onChange={(e) => setSelectedFactoryId(e.target.value || null)}
              className="h-8 rounded border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
            >
              {factoryList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {factoryList.length === 0 ? (
        <Card>
          <p className="text-sm text-fg-muted">
            Create a factory first — power generators are scoped to a
            specific factory.
          </p>
        </Card>
      ) : activeId ? (
        <PowerFactoryPanel factoryId={activeId} />
      ) : null}
    </div>
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
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                confirm(
                                  `Remove this ${gen?.name ?? "generator"} row?`,
                                )
                              ) {
                                remove.mutate(g.id);
                              }
                            }}
                            aria-label="Remove generator"
                            className="rounded-md p-1.5 text-fg-muted hover:bg-danger/20 hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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
