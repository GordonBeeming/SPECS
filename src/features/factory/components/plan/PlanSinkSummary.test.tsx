import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { PlanGraph, PlanNode } from "@/features/planner/types";
import { PlanSinkSummary } from "./PlanSinkSummary";
import { PlanTotals } from "./PlanTotals";
import { PlanWarningsBanner } from "./PlanWarningsBanner";

vi.mock("@/shared/ui/Icon", () => ({
  Icon: ({ itemId }: { itemId: string }) => <span data-testid={`icon-${itemId}`} />,
}));

function graphWith(nodes: PlanNode[]): PlanGraph {
  return {
    nodes,
    edges: [],
    totalMachines: 0,
    totalPowerMw: 0,
    extractorCount: 0,
    extractorPowerMw: 0,
    rawDemand: {},
    warnings: [],
    samForced: false,
    uncollectedAlts: [],
    existingProducers: [],
  };
}

function byproduct(itemId: string, itemName: string, surplusIpm: number, isFluid = false): PlanNode {
  return { kind: "byproduct", nodeKey: `byproduct:${itemId}`, itemId, itemName, surplusIpm, isFluid };
}

describe("<PlanSinkSummary />", () => {
  it("puts the sunk total where it can't be missed, biggest first", () => {
    // The refinery case: 145.5 Petroleum Coke/min was going to the sink
    // and the only way to find out was reading the DOM.
    render(
      <PlanSinkSummary
        graph={graphWith([
          byproduct("Desc_Rubber_C", "Rubber", 12),
          byproduct("Desc_PetroleumCoke_C", "Petroleum Coke", 145.5),
        ])}
      />,
    );
    const summary = screen.getByRole("status");
    expect(summary).toHaveTextContent("145.5/min");
    expect(summary).toHaveTextContent("Petroleum Coke");
    expect(summary).toHaveTextContent("12/min");
    expect(summary.textContent?.indexOf("Petroleum Coke")).toBeLessThan(
      summary.textContent?.indexOf("Rubber") ?? -1,
    );
  });

  it("stays out of the way when nothing is being sunk", () => {
    // A stranded fluid can't be sunk at all — that's the fluid-surplus
    // warning's job, not this strip's.
    const { container } = render(
      <PlanSinkSummary
        graph={graphWith([byproduct("Desc_HeavyOilResidue_C", "Heavy Oil Residue", 20, true)])}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("<PlanTotals />", () => {
  it("counts the extractors the MW figure already includes", () => {
    // The header read "6 machines · 26.0 MW" while the MW total
    // included a bound miner the count knew nothing about.
    const graph = graphWith([]);
    render(
      <PlanTotals
        graph={{ ...graph, totalMachines: 6, totalPowerMw: 26, extractorCount: 1, extractorPowerMw: 5 }}
      />,
    );
    const totals = screen.getByText(/26\.0 MW/);
    expect(totals).toHaveTextContent("6 machines + 1 extractor · 26.0 MW");
    expect(totals).toHaveAttribute(
      "title",
      "21.0 MW of machines + 5.0 MW of claimed extractors",
    );
  });

  it("says nothing about extractors when the factory has none", () => {
    const graph = graphWith([]);
    render(<PlanTotals graph={{ ...graph, totalMachines: 4, totalPowerMw: 12 }} />);
    const totals = screen.getByText(/12\.0 MW/);
    expect(totals).toHaveTextContent("4 machines · 12.0 MW");
    expect(totals).not.toHaveAttribute("title");
  });
});

describe("<PlanWarningsBanner /> above-tier line", () => {
  it("names the tier needed and the steps that are out of reach", () => {
    render(
      <PlanWarningsBanner
        warnings={[
          {
            kind: "aboveTier",
            currentTier: 6,
            requiredTier: 7,
            itemNames: ["Crystal Oscillator", "Quartz Crystal", "Supercomputer"],
          },
        ]}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Needs Tier 7");
    expect(banner).toHaveTextContent("you're on Tier 6");
    expect(banner).toHaveTextContent("Supercomputer");
  });
});
