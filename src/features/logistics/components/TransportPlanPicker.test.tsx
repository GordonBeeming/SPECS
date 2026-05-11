import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { libraryApi } from "@/features/library/api";
import type { TransportPlan } from "../types";
import { TransportPlanPicker, serialisePlan } from "./TransportPlanPicker";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  // The picker calls `useTransportVehicles` so it can render vehicle names
  // alongside segment counts. The existing belt/pipe-focused tests don't
  // care about the result; mock to an empty list to keep the React Query
  // requirement satisfied without changing assertions.
  vi.spyOn(libraryApi, "transportVehicles").mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

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
    renderWithProviders(<TransportPlanPicker plans={[]} selectedJson={null} onPick={() => {}} />);
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
    renderWithProviders(<TransportPlanPicker plans={[single, mixed]} selectedJson={null} onPick={() => {}} />);
    expect(screen.getByText("1× Mk1 belts")).toBeInTheDocument();
    expect(screen.getByText("1× Mk6 + 1× Mk1 belts")).toBeInTheDocument();
  });

  it("disables locked plans and tags them with the required tier", () => {
    const locked = plan({ locked: true, minUnlockTier: 9 });
    renderWithProviders(<TransportPlanPicker plans={[locked]} selectedJson={null} onPick={() => {}} />);
    const radio = screen.getByRole("radio");
    expect(radio).toBeDisabled();
    expect(screen.getByText(/Tier 9/)).toBeInTheDocument();
  });

  it("invokes onPick with the chosen plan when a radio is clicked", async () => {
    const onPick = vi.fn();
    const p = plan();
    renderWithProviders(<TransportPlanPicker plans={[p]} selectedJson={null} onPick={onPick} />);
    await userEvent.click(screen.getByRole("radio"));
    expect(onPick).toHaveBeenCalledWith(p);
  });

  it("marks the matching radio checked based on serialised JSON", () => {
    const p = plan();
    renderWithProviders(
      <TransportPlanPicker plans={[p]} selectedJson={serialisePlan(p)} onPick={() => {}} />,
    );
    expect(screen.getByRole("radio")).toBeChecked();
  });

  it("uses the pipe noun for fluid plans", () => {
    const p = plan({ kind: "pipe", segments: [{ mark: 2, count: 1, perUnitCapacity: 600, unlockTier: 6 }] });
    renderWithProviders(<TransportPlanPicker plans={[p]} selectedJson={null} onPick={() => {}} />);
    expect(screen.getByText("1× Mk2 pipes")).toBeInTheDocument();
  });

  it("renders vehicle plans with the vehicle name and battery cost", async () => {
    vi.spyOn(libraryApi, "transportVehicles").mockResolvedValueOnce([
      {
        id: "Build_DroneTransport_C",
        name: "Drone",
        kind: "drone",
        slots: 9,
        baseItemsPerMinute: 250,
        batteryPerKm: 1,
        unlockTier: 7,
      },
    ]);
    const dronePlan = plan({
      kind: "drone",
      segments: [{ mark: 0, count: 2, perUnitCapacity: 125, unlockTier: 7 }],
      totalCapacityPerMinute: 250,
      utilisationPct: 100,
      minUnlockTier: 7,
      vehicleId: "Build_DroneTransport_C",
      batteryPerMinute: 8,
    });
    renderWithProviders(
      <TransportPlanPicker plans={[dronePlan]} selectedJson={null} onPick={() => {}} />,
    );
    expect(await screen.findByText("2× Drone")).toBeInTheDocument();
    expect(screen.getByText(/8.0 batteries/)).toBeInTheDocument();
  });
});
