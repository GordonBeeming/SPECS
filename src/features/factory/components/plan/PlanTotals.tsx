import type { PlanGraph } from "@/features/planner/types";

/**
 * The header's "what this factory costs" readout.
 *
 * The MW figure includes the factory's bound extractors (claimed miners
 * and pumps are real draw, and the Power view and Validate both count
 * them), but they aren't graph nodes, so a bare machine count next to
 * it has the two numbers counting different sets. Naming the extractors
 * is what makes the pair add up; the breakdown sits in the tooltip.
 */
export function PlanTotals({ graph }: { graph: PlanGraph }) {
  const machinePowerMw = graph.totalPowerMw - graph.extractorPowerMw;
  const hasExtractors = graph.extractorCount > 0;
  return (
    <span
      title={
        hasExtractors
          ? `${machinePowerMw.toFixed(1)} MW of machines + ${graph.extractorPowerMw.toFixed(1)} MW of claimed extractors`
          : undefined
      }
    >
      {graph.totalMachines} machines
      {hasExtractors &&
        ` + ${graph.extractorCount} ${graph.extractorCount === 1 ? "extractor" : "extractors"}`}
      {" · "}
      {graph.totalPowerMw.toFixed(1)} MW
    </span>
  );
}
