import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Atom, Check, ExternalLink, Loader2, Pencil, ScrollText, Trash2, Wrench, X, Zap } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/Icon";
import { IconPicker } from "@/shared/ui/IconPicker";
import { useNavStore } from "@/shared/nav-store";
import { invoke } from "@/shared/tauri/invoke";
import { AddMachineForm } from "../AddMachineForm";
import { FactoryLedgerTable } from "../FactoryLedgerTable";
import { useItems, useRecipes } from "@/features/library/hooks/useLibrary";
import { useUnlockedAlts } from "@/features/alts/hooks/useAlts";
import { useLogisticsLinks } from "@/features/logistics/hooks/useLogistics";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { buildRecipesByOutput } from "@/features/planner/options";

import {
  useDeleteFactory,
  useFactoryDetail,
  useFactoryList,
  useRenameFactory,
  useSetFactoryIcon,
} from "../../hooks/useFactories";
import { usePlanDesigner } from "../../hooks/usePlanDesigner";
import { FirstProductModal } from "./FirstProductModal";
import { PlanGraphCanvas } from "./PlanGraphCanvas";
import { PlanTargetsBar } from "./PlanTargetsBar";
import { errorLine, PlanWarningsBanner } from "./PlanWarningsBanner";
import { SourcesPanel } from "./SourcesPanel";

export interface PlanDesignerViewProps {
  factoryId: string;
  /** Fresh from quick-create: auto-open the product picker and offer
      "Cancel & delete" until the first product lands. */
  firstRun?: boolean;
  /** Rendered as the whole UI of a popped-out window: no Back button (the
      window's own close button is the exit) and no Pop-out button. */
  popped?: boolean;
  onBack: () => void;
  /** Used by first-run cancel — delete the factory and leave. */
  onDeleted: () => void;
}

/**
 * The full-screen production-plan designer. Outcome-first: pick what
 * the factory should make, the graph computes itself, and edits
 * auto-save in the background.
 */
export function PlanDesignerView({ factoryId, firstRun, popped, onBack, onDeleted }: PlanDesignerViewProps) {
  const detail = useFactoryDetail(factoryId);
  const factories = useFactoryList();
  const items = useItems();
  const recipes = useRecipes();
  const unlockedAlts = useUnlockedAlts();
  const links = useLogisticsLinks();
  const designer = usePlanDesigner(factoryId);
  const renameFactory = useRenameFactory();
  const setIcon = useSetFactoryIcon();
  const deleteFactory = useDeleteFactory();

  const [sourcesFor, setSourcesFor] = useState<string | null>(null);
  // Left-side overlay panel: the per-item ledger and manual add-machine that
  // used to live in the (now removed) factory detail pane. Mutually exclusive
  // so they don't stack; independent of the right-hand SourcesPanel.
  const [leftPanel, setLeftPanel] = useState<null | "ledger" | "machines">(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [editingIcon, setEditingIcon] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const itemNames = useMemo(
    () => new Map(items.data?.map((i) => [i.id, i.name]) ?? []),
    [items.data],
  );
  const factoryNames = useMemo(
    () => new Map(factories.data?.map((f) => [f.id, f.name]) ?? []),
    [factories.data],
  );
  const factoryIcons = useMemo(
    () => new Map(factories.data?.map((f) => [f.id, f.iconId ?? null]) ?? []),
    [factories.data],
  );
  const allFactories = useMemo(
    () =>
      (factories.data ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        iconId: f.iconId ?? null,
      })),
    [factories.data],
  );
  const playthrough = useCurrentPlaythrough();
  const recipesByOutput = useMemo(
    () => buildRecipesByOutput(recipes.data, playthrough.data?.currentTier),
    [recipes.data, playthrough.data?.currentTier],
  );

  const working = designer.working;
  const graph = designer.compute?.kind === "ok" ? designer.compute.graph : null;
  const computeError = designer.compute?.kind === "err" ? designer.compute.error : null;

  const exportByItem = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const t of working?.targets ?? []) m.set(t.itemId, t.exportIpm ?? null);
    return m;
  }, [working]);
  const localItems = useMemo(() => {
    const set = new Set<string>();
    for (const imp of working?.imports ?? []) {
      if (imp.sourceFactoryId === factoryId) set.add(imp.itemId);
    }
    return set;
  }, [working, factoryId]);

  // Per-item local share for the sources panel: the recipe node's
  // output when the item is mixed, the full demand when pure local.
  const localIpmFor = (itemId: string): number => {
    const recipeNode = graph?.nodes.find(
      (n) => n.kind === "recipe" && n.itemId === itemId,
    );
    return recipeNode && recipeNode.kind === "recipe" ? recipeNode.outputIpm : 0;
  };
  const totalIpmFor = (itemId: string): number => {
    const local = localIpmFor(itemId);
    const importNode = graph?.nodes.find(
      (n) => n.kind === "import" && n.itemId === itemId,
    );
    return local + (importNode && importNode.kind === "import" ? importNode.ipm : 0);
  };

  // Factories that draw from this one — the consequences list for the
  // delete confirmation.
  const dependents = useMemo(() => {
    const ids = new Set(
      (links.data ?? [])
        .filter((l) => l.fromFactoryId === factoryId)
        .map((l) => l.toFactoryId),
    );
    return [...ids].map((id) => factoryNames.get(id) ?? id);
  }, [links.data, factoryId, factoryNames]);

  // First-run: when the first product lands, stamp the factory icon
  // with it (only if no icon yet) so every factory shows up on the
  // map with a face. The user can still change it or pick none.
  const stampedIcon = useRef(false);
  useEffect(() => {
    if (stampedIcon.current) return;
    const first = working?.targets[0];
    if (!first) return;
    if (detail.data && !detail.data.factory.iconId) {
      stampedIcon.current = true;
      setIcon.mutate({ id: factoryId, iconId: first.itemId });
    }
  }, [working, detail.data, factoryId, setIcon]);

  const handleBack = () => {
    // Leaving never loses work: flush any pending edits first.
    void designer.flush().finally(onBack);
  };

  const factoryName = detail.data?.factory.name ?? "…";

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        {!popped && (
          <Button variant="ghost" onClick={handleBack} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}

        <button
          type="button"
          onClick={() => setEditingIcon((v) => !v)}
          aria-label="Change factory icon"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-bg-raised hover:border-primary"
        >
          {detail.data?.factory.iconId ? (
            <Icon itemId={detail.data.factory.iconId} alt="" className="h-7 w-7" />
          ) : (
            <Pencil className="h-4 w-4 text-fg-muted" />
          )}
        </button>

        {editingName ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = nameDraft.trim();
              if (name) {
                renameFactory.mutate({ id: factoryId, name });
              }
              setEditingName(false);
            }}
          >
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingName(false);
              }}
              aria-label="Factory name"
              className="h-8 w-56 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary"
            />
            <button type="submit" aria-label="Save name" className="rounded p-1 text-success hover:bg-border">
              <Check className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameDraft(factoryName);
              setEditingName(true);
            }}
            title="Rename factory"
            className="group flex items-center gap-1.5"
          >
            <h2 className="text-lg font-semibold text-fg">{factoryName}</h2>
            <Pencil className="h-3.5 w-3.5 text-fg-muted opacity-0 group-hover:opacity-100" />
          </button>
        )}
        <span className="text-sm text-fg-muted">Production plan</span>

        <div className="ml-auto flex items-center gap-3 text-sm tabular-nums text-fg-muted">
          {working && (
            <button
              type="button"
              role="switch"
              aria-checked={working.includeSam || (graph?.samForced ?? false)}
              disabled={graph?.samForced ?? false}
              onClick={() => designer.setIncludeSam(!working.includeSam)}
              title={
                graph?.samForced
                  ? "A product in this plan can only be made with SAM"
                  : "Allow recipes whose chain needs SAM in this plan"
              }
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                working.includeSam || graph?.samForced
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-fg-muted hover:border-primary hover:text-fg"
              } disabled:cursor-not-allowed disabled:opacity-70`}
            >
              <Atom className="h-3.5 w-3.5" />
              SAM
            </button>
          )}
          {graph && graph.nodes.length > 0 && (
            <span>
              {graph.totalMachines} machines · {graph.totalPowerMw.toFixed(1)} MW
            </span>
          )}
          {designer.computing && <Loader2 className="h-4 w-4 animate-spin" aria-label="Computing" />}
          <span className="text-xs">
            {designer.saving ? "Saving…" : designer.dirty ? "Unsaved" : "Saved"}
          </span>
          {!popped && (
            <Button
              variant="ghost"
              onClick={() => void invoke("pop_out_factory", { factoryId })}
              title="Open this factory in its own window so you can edit several at once"
              className="px-2 py-1 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Pop out
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setLeftPanel((p) => (p === "ledger" ? null : "ledger"))}
            aria-pressed={leftPanel === "ledger"}
            title="Per-item ledger — what this factory's built machines make and use"
            className="px-2 py-1 text-xs"
          >
            <ScrollText className="h-3.5 w-3.5" />
            Ledger
          </Button>
          <Button
            variant="ghost"
            onClick={() => setLeftPanel((p) => (p === "machines" ? null : "machines"))}
            aria-pressed={leftPanel === "machines"}
            title="Add a machine by hand, outside the production plan"
            className="px-2 py-1 text-xs"
          >
            <Wrench className="h-3.5 w-3.5" />
            Add machine
          </Button>
          {!popped && (
            <Button
              variant="ghost"
              onClick={() => {
                useNavStore.getState().selectFactory(factoryId);
                useNavStore.getState().goTo("power");
              }}
              title="Plan power for this factory"
              className="px-2 py-1 text-xs"
            >
              <Zap className="h-3.5 w-3.5 text-warning" />
              Add power
            </Button>
          )}
          <Button
            variant="danger"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete factory"
            className="px-2 py-1 text-xs"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {editingIcon && detail.data && (
        <div className="border-b border-border px-4 py-3">
          <IconPicker
            value={detail.data.factory.iconId ?? null}
            suggested={(working?.targets ?? []).map((t) => t.itemId)}
            onChange={(next) => {
              setIcon.mutate({ id: factoryId, iconId: next });
              setEditingIcon(false);
            }}
          />
        </div>
      )}

      {confirmDelete && (
        <div role="alertdialog" className="border-b border-danger/40 bg-danger/10 px-4 py-3 text-sm">
          <div className="font-semibold text-danger">Delete {factoryName}?</div>
          <p className="mt-1 text-fg-muted">
            Machines, the plan and its logistics links go with it.
            {dependents.length > 0 && (
              <>
                {" "}
                These factories currently draw inputs from it and will lose them:{" "}
                <span className="text-fg">{dependents.join(", ")}</span>.
              </>
            )}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} className="px-3 py-1 text-xs">
              Keep it
            </Button>
            <Button
              variant="danger-solid"
              onClick={() => {
                deleteFactory.mutate(factoryId, { onSuccess: onDeleted });
              }}
              className="px-3 py-1 text-xs"
            >
              Delete factory
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        {working ? (
          <PlanTargetsBar
            targets={working.targets}
            itemNames={itemNames}
            onAddTarget={designer.addTarget}
            onRemoveTarget={designer.removeTarget}
            onSetTargetIpm={designer.setTargetIpm}
          />
        ) : (
          <div className="text-sm text-fg-muted">Loading plan…</div>
        )}
        {designer.saveError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            Couldn't save: {designer.saveError}
          </div>
        )}
        {computeError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {errorLine(computeError)}
          </div>
        )}
        {graph && <PlanWarningsBanner warnings={graph.warnings} />}
      </div>

      <div className="relative min-h-0 flex-1">
        {working && working.targets.length === 0 ? (
          <FirstProductModal
            factoryName={factoryName}
            firstRun={firstRun ?? false}
            onConfirm={(itemId, ipm) => designer.addTarget(itemId, ipm)}
            onDeleteFactory={() => deleteFactory.mutate(factoryId, { onSuccess: onDeleted })}
          />
        ) : graph ? (
          <PlanGraphCanvas
            factoryId={factoryId}
            graph={graph}
            layout={designer.layout}
            recipesByOutput={recipesByOutput}
            unlockedAlts={unlockedAlts.data}
            factoryNames={factoryNames}
            factoryIcons={factoryIcons}
            exportByItem={exportByItem}
            localItems={localItems}
            onSwapRecipe={designer.setRecipeOverride}
            onOpenSources={setSourcesFor}
            onStartExport={(itemId, ipm) => {
              designer.addTarget(itemId, ipm);
              designer.setTargetExport(itemId, ipm);
            }}
            onSetExport={designer.setTargetExport}
            onAddLocal={designer.addLocalSource}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-fg-muted">
            {designer.planQuery.isError
              ? "Couldn't load this factory's plan."
              : "Computing the production graph…"}
          </div>
        )}

        {leftPanel && (
          <div className="absolute left-3 top-3 bottom-3 z-30">
            <div
              className={`flex max-h-full flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-xl ${
                leftPanel === "machines" ? "w-[480px]" : "w-[360px]"
              }`}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                  {leftPanel === "ledger" ? (
                    <>
                      <ScrollText className="h-4 w-4" /> Ledger
                    </>
                  ) : (
                    <>
                      <Wrench className="h-4 w-4" /> Add machine
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setLeftPanel(null)}
                  aria-label="Close panel"
                  className="rounded p-1 text-fg-muted hover:bg-border hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {leftPanel === "ledger" ? (
                  detail.data ? (
                    <FactoryLedgerTable ledger={detail.data.ledger} itemNames={itemNames} />
                  ) : (
                    <div className="text-sm text-fg-muted">Loading ledger…</div>
                  )
                ) : (
                  <AddMachineForm factoryId={factoryId} onSubmitted={() => setLeftPanel(null)} />
                )}
              </div>
            </div>
          </div>
        )}

        {sourcesFor && working && (
          <div className="absolute right-3 top-3 bottom-3 z-30">
            <SourcesPanel
              factoryId={factoryId}
              itemId={sourcesFor}
              itemName={itemNames.get(sourcesFor) ?? sourcesFor}
              sources={working.imports.filter((i) => i.itemId === sourcesFor)}
              localIpm={localIpmFor(sourcesFor)}
              totalIpm={totalIpmFor(sourcesFor)}
              factoryNames={factoryNames}
              allFactories={allFactories}
              onAddExternal={designer.addExternalSource}
              onRemoveSource={(itemId, indexWithinItem) => {
                // SourcesPanel indexes within the item's rows.
                designer.removeImportSource(itemId, indexWithinItem);
              }}
              onAddLocal={designer.addLocalSource}
              onRemoveLocal={designer.removeLocalSource}
              onSetCap={designer.setImportCap}
              onSetSource={designer.setImportSource}
              onClose={() => setSourcesFor(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
