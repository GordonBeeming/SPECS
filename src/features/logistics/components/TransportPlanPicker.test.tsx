import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TransportPlan } from "../types";
import { TransportPlanPicker, serialisePlan } from "./TransportPlanPicker";

function plan(overrides: Partial<TransportPlan> = {}): TransportPlan {
  return {
    kind: "belt",
    segments: [
      { mark: 1, count: 1, perUnitCapacity: 60, unlockTier: 0 },
    ],
    totalCapacityPerMinute: 60,
    utilisationPct: 100,
    minUnlockTier: 0,
    locked: false,
    ...overrides,
  };
}

describe("<TransportPlanPicker />", () => {
  it("shows an empty-state hint when no plans are returned", () => {
    render(<TransportPlanPicker plans={[]} selectedJson={null} onPick={() => {}} />);
    expect(screen.getByText(/No viable plans/i)).toBeInTheDocument();
  });

  it("renders single-tier and mixed-tier plan summaries with units", () => {
    const single = plan();
    const mixed = plan({
      segments: [
        { mark: 6, count: 1, perUnitCapacity: 1200, unlockTier: 9 },
        { mark: 1, count: 1, perUnitCapacity: 60, unlockTier: 0 },
      ],
      totalCapacityPerMinute: 1260,
      utilisationPct: 99,
      minUnlockTier: 9,
      locked: true,
    });
    render(<TransportPlanPicker plans={[single, mixed]} selectedJson={null} onPick={() => {}} />);
    expect(screen.getByText("1× Mk1 belts")).toBeInTheDocument();
    expect(screen.getByText("1× Mk6 + 1× Mk1 belts")).toBeInTheDocument();
  });

  it("disables locked plans and tags them with the required tier", () => {
    const locked = plan({ locked: true, minUnlockTier: 9 });
    render(<TransportPlanPicker plans={[locked]} selectedJson={null} onPick={() => {}} />);
    const radio = screen.getByRole("radio");
    expect(radio).toBeDisabled();
    expect(screen.getByText(/Tier 9/)).toBeInTheDocument();
  });

  it("invokes onPick with the chosen plan when a radio is clicked", async () => {
    const onPick = vi.fn();
    const p = plan();
    render(<TransportPlanPicker plans={[p]} selectedJson={null} onPick={onPick} />);
    await userEvent.click(screen.getByRole("radio"));
    expect(onPick).toHaveBeenCalledWith(p);
  });

  it("marks the matching radio checked based on serialised JSON", () => {
    const p = plan();
    render(
      <TransportPlanPicker plans={[p]} selectedJson={serialisePlan(p)} onPick={() => {}} />,
    );
    expect(screen.getByRole("radio")).toBeChecked();
  });

  it("uses the pipe noun for fluid plans", () => {
    const p = plan({ kind: "pipe", segments: [{ mark: 2, count: 1, perUnitCapacity: 600, unlockTier: 6 }] });
    render(<TransportPlanPicker plans={[p]} selectedJson={null} onPick={() => {}} />);
    expect(screen.getByText("1× Mk2 pipes")).toBeInTheDocument();
  });
});
