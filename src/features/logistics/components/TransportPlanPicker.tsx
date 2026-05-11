import { Battery, Lock } from "lucide-react";

import { useTransportVehicles } from "@/features/library/hooks/useLibrary";
import type { TransportPlan } from "../types";

interface TransportPlanPickerProps {
  plans: TransportPlan[];
  selectedJson: string | null;
  onPick: (plan: TransportPlan) => void;
}

/**
 * Renders the planner output as a ranked picker. Plans land here with
 * `locked = true` for ones the playthrough's tier doesn't unlock yet —
 * we still show them (so the user knows what's available higher up) but
 * disable the radio + tag the gate.
 *
 * Selection roundtrips via the persisted `transport_plan_json` so the
 * editor can reuse the same picker for both create and edit flows
 * without juggling separate "selected plan index" state.
 */
export function TransportPlanPicker({ plans, selectedJson, onPick }: TransportPlanPickerProps) {
  const vehicles = useTransportVehicles();
  const vehicleNames = new Map(vehicles.data?.map((v) => [v.id, v.name]) ?? []);

  if (plans.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-sm text-fg-muted">
        No viable plans for this throughput at the dataset's transport tiers.
        Lower the requested ipm or unlock a higher tier and try again.
      </div>
    );
  }
  return (
    <ul role="radiogroup" aria-label="Transport plans" className="flex flex-col gap-2">
      {plans.map((plan, idx) => {
        const json = serialisePlan(plan);
        const checked = json === selectedJson;
        return (
          <li key={idx}>
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                checked
                  ? "border-primary bg-primary/5"
                  : plan.locked
                    ? "border-border/40 bg-border/10 opacity-60"
                    : "border-border hover:bg-border/40"
              }`}
            >
              <input
                type="radio"
                name="transport-plan"
                checked={checked}
                onChange={() => onPick(plan)}
                disabled={plan.locked}
                className="h-4 w-4"
                aria-label={summariseSegments(plan, vehicleNames)}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-fg">
                  <span>{summariseSegments(plan, vehicleNames)}</span>
                  {plan.locked && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                      <Lock className="h-3 w-3" />
                      Tier {plan.minUnlockTier}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted tabular-nums">
                  <span>
                    {plan.totalCapacityPerMinute.toFixed(0)} {plan.kind === "pipe" ? "m³" : "ipm"}{" "}
                    capacity · {plan.utilisationPct.toFixed(0)}% used
                  </span>
                  {plan.batteryPerMinute !== undefined && plan.batteryPerMinute > 0 && (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <Battery className="h-3 w-3" />
                      {plan.batteryPerMinute.toFixed(1)} batteries / min
                    </span>
                  )}
                </div>
              </div>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Compact human label for a plan: "2× Mk6 belts", "1× Mk6 + 1× Mk1 belts",
 * or "3× Truck (Build_Truck_C)" for vehicle plans.
 */
function summariseSegments(
  plan: TransportPlan,
  vehicleNames: Map<string, string>,
): string {
  if (
    plan.kind === "truck" ||
    plan.kind === "tractor" ||
    plan.kind === "drone"
  ) {
    const name = plan.vehicleId
      ? vehicleNames.get(plan.vehicleId) ?? plan.vehicleId
      : plan.kind;
    const count = plan.segments[0]?.count ?? 1;
    return `${count}× ${name}`;
  }
  if (plan.kind === "train") {
    return "Attach to existing train route";
  }
  const parts = plan.segments.map((s) => `${s.count}× Mk${s.mark}`);
  const noun = plan.kind === "pipe" ? "pipes" : "belts";
  return `${parts.join(" + ")} ${noun}`;
}

/**
 * Stable JSON for persistence. Sorted keys make equality comparisons
 * (used to drive the radio's `checked` state and the persisted
 * `transport_plan_json`) immune to hash-map ordering changes.
 */
export function serialisePlan(plan: TransportPlan): string {
  // Conditional fields only land in the JSON when they're non-null,
  // matching the Rust DTO's `skip_serializing_if = Option::is_none`
  // so the same string round-trips through the database verbatim.
  const out: Record<string, unknown> = {
    kind: plan.kind,
    segments: plan.segments.map((s) => ({
      mark: s.mark,
      count: s.count,
      perUnitCapacity: s.perUnitCapacity,
      unlockTier: s.unlockTier,
    })),
    totalCapacityPerMinute: plan.totalCapacityPerMinute,
    utilisationPct: plan.utilisationPct,
    minUnlockTier: plan.minUnlockTier,
    locked: plan.locked,
  };
  if (plan.vehicleId !== undefined) out.vehicleId = plan.vehicleId;
  if (plan.batteryPerMinute !== undefined) out.batteryPerMinute = plan.batteryPerMinute;
  return JSON.stringify(out);
}
