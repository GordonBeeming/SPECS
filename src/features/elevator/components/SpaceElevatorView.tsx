import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Rocket } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Icon } from "@/shared/ui/Icon";
import { useNavStore } from "@/shared/nav-store";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useElevatorOverview } from "../hooks/useElevatorOverview";
import type { ElevatorPartProgress, ElevatorPhase, ElevatorProducer } from "../types";

/**
 * A phase's delivery is what unlocks the tiers it lists, so reaching the
 * lowest of those tiers means the phase is already delivered. The final
 * phase unlocks no tier (it launches the project) and never counts as done.
 */
function phaseDone(phase: ElevatorPhase, currentTier: number): boolean {
  if (phase.unlocksTiers.length === 0) return false;
  return currentTier >= Math.min(...phase.unlocksTiers);
}

const num = new Intl.NumberFormat();
// Rates use the app's convention (see FilterSelect): up to 3 decimals, trailing
// zeros dropped. `r3` rounds to a number so colour/visibility decisions are made
// on the *displayed* value — f32 noise like 0.0004 must never render as a green
// "0/min free" or a stray "0 used here".
const r3 = (n: number) => Number(n.toFixed(3));
const rate = (n: number) => r3(n).toString();

export function SpaceElevatorView() {
  const playthrough = useCurrentPlaythrough();
  const overview = useElevatorOverview();
  const currentTier = playthrough.data?.currentTier ?? 0;

  if (!playthrough.data) {
    return (
      <Card>
        <h1 className="text-xl font-semibold text-primary">Space Elevator</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Open a playthrough from the header to see Project Assembly requirements
          against your production.
        </p>
      </Card>
    );
  }

  // The "next" phase is the first one not yet delivered — everything after it
  // is greyed out as future work.
  const phases = overview.data?.phases ?? [];
  const nextPhaseIdx = phases.findIndex((p) => !phaseDone(p, currentTier));

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-primary">
              <Rocket className="h-5 w-5" />
              Space Elevator
            </h1>
            <p className="mt-1 text-sm text-fg-muted">
              Each Project Assembly phase and what it needs delivered, against what
              your network makes. Expand a part to see which factories produce it
              and how much is free versus already spoken for.
            </p>
          </div>
          <div className="text-xs text-fg-muted tabular-nums">
            current tier <span className="font-mono">{currentTier}</span>
          </div>
        </div>
      </Card>

      {overview.isError ? (
        <Card>
          <div role="alert" className="flex items-center gap-2 text-sm text-danger">
            <AlertTriangle className="h-4 w-4" />
            Couldn't load the Space Elevator overview
            {overview.error instanceof Error ? `: ${overview.error.message}` : null}
          </div>
        </Card>
      ) : overview.isPending ? (
        <Card>
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading production…
          </div>
        </Card>
      ) : (
        phases.map((phase, idx) => {
          const done = phaseDone(phase, currentTier);
          const isFuture = nextPhaseIdx !== -1 && idx > nextPhaseIdx;
          const isNext = idx === nextPhaseIdx;
          return (
            <PhaseCard
              key={phase.phase}
              phase={phase}
              state={done ? "done" : isNext ? "active" : isFuture ? "future" : "active"}
            />
          );
        })
      )}
    </div>
  );
}

type PhaseState = "done" | "active" | "future";

function PhaseCard({ phase, state }: { phase: ElevatorPhase; state: PhaseState }) {
  return (
    <Card className={state === "future" ? "opacity-60" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-fg">
          Phase {phase.phase} — {phase.name}
        </h2>
        <div className="flex items-center gap-2">
          {phase.unlocksTiers.length > 0 ? (
            <Badge tone="neutral">
              Unlocks Tier {phase.unlocksTiers.join(" & ")}
            </Badge>
          ) : (
            <Badge tone="neutral">Project launch</Badge>
          )}
          {state === "done" ? (
            <Badge tone="success">Delivered</Badge>
          ) : state === "active" ? (
            <Badge tone="warning">In progress</Badge>
          ) : (
            <Badge tone="neutral">Upcoming</Badge>
          )}
        </div>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {phase.parts.map((part) => (
          <PartRow key={part.itemId} part={part} />
        ))}
      </ul>
    </Card>
  );
}

function partStatus(part: ElevatorPartProgress): { tone: "success" | "warning" | "danger"; label: string } {
  if (part.producers.length === 0) return { tone: "danger", label: "No producer" };
  const freeRaw = part.producers.reduce((s, p) => s + Math.max(0, p.availablePerMinute), 0);
  // Round before branching so a sub-rounding sliver (f32 noise) doesn't read as a
  // green "0/min free" — that rounds to zero and belongs in "All committed".
  const free = r3(freeRaw);
  if (free <= 0) return { tone: "warning", label: "All committed" };
  return { tone: "success", label: `${rate(free)}/min free` };
}

function PartRow({ part }: { part: ElevatorPartProgress }) {
  const [open, setOpen] = useState(false);
  const status = partStatus(part);
  const hasProducers = part.producers.length > 0;
  return (
    <li className="py-2">
      <button
        type="button"
        onClick={() => hasProducers && setOpen((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
        aria-expanded={hasProducers ? open : undefined}
        disabled={!hasProducers}
      >
        {hasProducers ? (
          open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" />
          )
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <Icon itemId={part.itemId} alt={part.itemName} className="h-6 w-6" />
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{part.itemName}</span>
        <span className="shrink-0 text-sm text-fg-muted tabular-nums">
          need <span className="font-mono text-fg">{num.format(part.requiredQuantity)}</span>
        </span>
        <span className="w-32 shrink-0 whitespace-nowrap text-right text-sm text-fg-muted tabular-nums">
          making <span className="font-mono text-fg">{rate(part.totalProducedPerMinute)}</span>/min
        </span>
        <span className="w-32 shrink-0 text-right">
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </button>
      {open && hasProducers ? (
        <ul className="mt-2 ml-7 flex flex-col gap-1.5 border-l border-border pl-4">
          {part.producers.map((p) => (
            <ProducerRow key={p.factoryId} producer={p} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ProducerRow({ producer }: { producer: ElevatorProducer }) {
  const openFactory = () => {
    useNavStore.getState().selectFactory(producer.factoryId);
    useNavStore.getState().goTo("factories");
  };
  // Round each value once, up front: the colour and the "show this span at all"
  // checks below must agree with what's printed, or f32 noise leaks through.
  const produced = r3(producer.producedPerMinute);
  const consumed = r3(producer.consumedInternallyPerMinute);
  const synced = r3(producer.syncedOutPerMinute);
  const free = r3(producer.availablePerMinute);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <button
        type="button"
        onClick={openFactory}
        className="font-medium text-primary hover:underline"
      >
        {producer.factoryName}
      </button>
      <span className="text-fg-muted tabular-nums">
        makes <span className="font-mono text-fg">{produced}</span>/min
      </span>
      {consumed > 0 ? (
        <span className="text-fg-muted tabular-nums">· {consumed} used here</span>
      ) : null}
      {synced > 0 ? (
        <span className="text-fg-muted tabular-nums">· {synced} shipped out</span>
      ) : null}
      <span
        className={`tabular-nums ${free > 0 ? "text-success" : free < 0 ? "text-danger" : "text-fg-muted"}`}
      >
        · {free}/min free
      </span>
    </li>
  );
}
