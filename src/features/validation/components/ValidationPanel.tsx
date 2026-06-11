import { useEffect } from "react";
import { CircleAlert, FlaskConical, RefreshCw, ShieldCheck, TriangleAlert, X } from "lucide-react";

import { Button } from "@/shared/ui/Button";
import { openPlanDesigner, useNavStore } from "@/shared/nav-store";
import type { PlanWarning } from "@/features/planner/types";

import { useValidation } from "../hooks/useValidation";
import type { Category, Finding, ValidationReport } from "../types";

interface ValidationPanelProps {
  onClose: () => void;
}

const CATEGORY_LABELS: Record<Category, string> = {
  tierGating: "Above your tier",
  lockedAlts: "Alts you haven't collected",
  flow: "Cross-factory flows",
  supplyPower: "Supply & power",
};

const CATEGORY_ORDER: Category[] = ["tierGating", "flow", "supplyPower", "lockedAlts"];

/**
 * Right-hand slide-over behind the header's Validate button. Runs the
 * sweep on mount; everything it shows is the server's call — the panel
 * never re-derives a number.
 */
export function ValidationPanel({ onClose }: ValidationPanelProps) {
  const validation = useValidation();
  const { mutate } = validation;

  useEffect(() => {
    mutate();
  }, [mutate]);

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-label="Validate playthrough">
      <button
        type="button"
        aria-label="Close validation"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-border bg-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Validate playthrough
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              onClick={() => mutate()}
              aria-label="Re-run validation"
              className="px-2 py-1"
              disabled={validation.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${validation.isPending ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="ghost" onClick={onClose} aria-label="Close" className="px-2 py-1">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {validation.isPending && (
            <p className="text-sm text-fg-muted">Sweeping every factory, plan, claim and link…</p>
          )}
          {validation.isError && (
            <p role="alert" className="text-sm text-danger">
              Validation failed: {String(validation.error)}
            </p>
          )}
          {validation.data && <Report report={validation.data} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

function Report({ report, onClose }: { report: ValidationReport; onClose: () => void }) {
  const errors = report.findings.filter((f) => f.severity === "error").length;
  const warnings = report.findings.length - errors;

  if (report.findings.length === 0 && report.altShoppingList.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <ShieldCheck className="h-8 w-8 text-success" />
        <p className="text-sm font-medium text-fg">
          No findings — everything checks out at T{report.currentTier}.
        </p>
        <GridLine report={report} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-danger/40 bg-danger/10 px-2.5 py-0.5 font-medium text-danger">
          {errors} error{errors === 1 ? "" : "s"}
        </span>
        <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 font-medium text-warning">
          {warnings} warning{warnings === 1 ? "" : "s"}
        </span>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-fg-muted">
          tier T{report.currentTier}
        </span>
        <GridLine report={report} />
      </div>

      {report.altShoppingList.length > 0 && (
        <section className="rounded-lg border border-warning/30 bg-warning/5 p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-fg">
            <FlaskConical className="h-4 w-4 text-warning" />
            Hard drives to collect
          </h3>
          <p className="mb-2 text-xs text-fg-muted">
            Plans assume these alts — they're reachable at your tier but not collected yet.
          </p>
          <ul className="flex flex-col gap-1.5 text-xs">
            {report.altShoppingList.map((alt) => (
              <li key={alt.recipeId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-fg">{alt.recipeName}</span>
                <span className="text-fg-muted">
                  T{alt.unlockTier} · wanted by{" "}
                  {alt.wantedBy.map((f) => f.factoryName).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const items = report.findings.filter((f) => f.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              {CATEGORY_LABELS[cat]}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {items.map((f, i) => (
                <FindingRow key={`${f.kind}-${i}`} finding={f} onNavigate={onClose} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function GridLine({ report }: { report: ValidationReport }) {
  const g = report.grid;
  const tone = g.netMw < 0 ? "text-danger" : "text-fg-muted";
  return (
    <span className={`text-xs ${tone}`}>
      Grid: {g.generatedMw.toFixed(0)} MW gen / {g.consumedMw.toFixed(0)} MW draw (
      {g.netMw >= 0 ? "+" : ""}
      {g.netMw.toFixed(0)} MW)
    </span>
  );
}

/** Where a finding's "open" action should land. */
function findingTarget(f: Finding): (() => void) | null {
  const nav = useNavStore.getState();
  switch (f.kind) {
    case "machineRecipeAboveTier":
    case "machineBuildingAboveTier": {
      const id = f.factoryId;
      return () => {
        nav.selectFactory(id);
        nav.goTo("factories");
      };
    }
    case "planRecipeAboveTier":
    case "planDoesNotCompute":
    case "lockedAltInUse":
    case "planIssue": {
      const id = f.factoryId;
      return () => openPlanDesigner(id);
    }
    case "claimExtractorAboveTier":
    case "claimInvalidExtractor":
      return () => nav.goTo("resources");
    case "linkTransportAboveTier":
    case "linkOverdraw":
    case "linkSourceMissingProduct":
      return () => nav.goTo("logistics");
    case "powerDeficit":
    case "gridDeficit":
      return () => nav.goTo("power");
    case "checkFailed":
      return null;
  }
}

function findingText(f: Finding): string {
  switch (f.kind) {
    case "machineRecipeAboveTier":
      return `${f.factoryName}: machines run ${f.recipeName} (unlocks T${f.unlockTier})`;
    case "machineBuildingAboveTier":
      return `${f.factoryName}: has a ${f.buildingName} (unlocks T${f.unlockTier})`;
    case "planRecipeAboveTier":
      return `${f.factoryName}: plan uses ${f.recipeName} (unlocks T${f.unlockTier})`;
    case "planDoesNotCompute":
      return `${f.factoryName}: saved plan no longer computes — ${f.reason}`;
    case "claimExtractorAboveTier":
      return `${f.resourceItemName} node claimed with ${f.extractorName} (unlocks T${f.unlockTier})`;
    case "claimInvalidExtractor":
      return `${f.resourceItemName} node claimed with ${f.extractorId} — this node takes ${f.allowedNames.join(" / ")}`;
    case "linkTransportAboveTier":
      return `${f.fromFactoryName} → ${f.toFactoryName} (${f.itemName}) needs T${f.minUnlockTier} ${f.transportKind}`;
    case "lockedAltInUse":
      return `${f.factoryName}: ${f.recipeName} not collected yet (${
        f.inPlan && f.inMachines ? "plan + machines" : f.inPlan ? "plan" : "machines"
      })`;
    case "linkOverdraw":
      return `${f.fromFactoryName}: links draw ${f.drawnIpm.toFixed(1)}/min of ${f.itemName}, exports cover ${f.availableIpm.toFixed(1)}`;
    case "linkSourceMissingProduct":
      return `${f.fromFactoryName} → ${f.toFactoryName}: link carries ${f.itemName}, which the source doesn't plan`;
    case "planIssue":
      return `${f.factoryName}: ${planWarningText(f.warning)}`;
    case "powerDeficit":
      return `${f.factoryName} draws ${(-f.netMw).toFixed(1)} MW more than it generates`;
    case "gridDeficit":
      return `Grid short: ${f.consumedMw.toFixed(0)} MW drawn vs ${f.generatedMw.toFixed(0)} MW generated`;
    case "checkFailed":
      return `${f.factoryName ? `${f.factoryName}: ` : ""}${f.area} check couldn't run — ${f.reason}`;
  }
}

function planWarningText(w: PlanWarning): string {
  switch (w.kind) {
    case "rawShort":
      return `claims cover ${w.claimedIpm.toFixed(1)}/min of ${w.itemName}, plan needs ${w.demandIpm.toFixed(1)}`;
    case "importUnsourced":
      return `${w.itemName} import (${w.ipm.toFixed(1)}/min) has no source`;
    case "importShort":
      return `${w.itemName} import short by ${w.gapIpm.toFixed(1)}/min`;
    case "fluidSurplus":
      return `${w.ipm.toFixed(1)}/min of ${w.itemName} fluid surplus will stall`;
    case "optimizerFellBack":
      return `optimizer fell back: ${w.reason}`;
  }
}

function FindingRow({ finding, onNavigate }: { finding: Finding; onNavigate: () => void }) {
  const target = findingTarget(finding);
  const Icon = finding.severity === "error" ? CircleAlert : TriangleAlert;
  const tone = finding.severity === "error" ? "text-danger" : "text-warning";
  const body = (
    <span className="flex items-start gap-2 text-left text-xs text-fg">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span>{findingText(finding)}</span>
    </span>
  );
  if (!target) {
    return <li className="rounded-md border border-border bg-bg-raised px-3 py-2">{body}</li>;
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          target();
          onNavigate();
        }}
        className="w-full rounded-md border border-border bg-bg-raised px-3 py-2 transition-colors hover:border-primary"
      >
        {body}
      </button>
    </li>
  );
}
