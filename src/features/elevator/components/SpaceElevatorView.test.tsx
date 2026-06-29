import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SpaceElevatorView } from "./SpaceElevatorView";
import { elevatorApi } from "../api";
import type { ElevatorOverview } from "../types";

// The view reads the active playthrough's current tier to decide which phases
// are greyed out, so the hook is mocked to a fixed tier.
vi.mock("@/features/playthrough/hooks/usePlaythroughs", () => ({
  useCurrentPlaythrough: () => ({ data: { id: "p1", currentTier: 4 } }),
}));

const overview: ElevatorOverview = {
  phases: [
    {
      phase: 1,
      name: "Distribution Platform",
      unlocksTiers: [3, 4],
      parts: [
        {
          itemId: "Desc_SpaceElevatorPart_1_C",
          itemName: "Smart Plating",
          requiredQuantity: 50,
          totalProducedPerMinute: 6,
          producers: [
            {
              factoryId: "f1",
              factoryName: "Plating Plant",
              producedPerMinute: 6,
              consumedInternallyPerMinute: 0,
              syncedOutPerMinute: 2,
              availablePerMinute: 4,
            },
          ],
        },
      ],
    },
    {
      phase: 2,
      name: "Construction Dock",
      unlocksTiers: [5, 6],
      parts: [
        {
          itemId: "Desc_SpaceElevatorPart_3_C",
          itemName: "Automated Wiring",
          requiredQuantity: 100,
          totalProducedPerMinute: 0,
          producers: [],
        },
      ],
    },
  ],
};

function renderView(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(elevatorApi, "overview").mockResolvedValue(overview);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SpaceElevatorView", () => {
  it("lists every phase with its delivery requirement and current rate", async () => {
    renderView(<SpaceElevatorView />);
    expect(await screen.findByText(/Phase 1 — Distribution Platform/)).toBeInTheDocument();
    expect(screen.getByText(/Phase 2 — Construction Dock/)).toBeInTheDocument();
    expect(screen.getByText("Smart Plating")).toBeInTheDocument();
    // Required quantity is shown.
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("flags a part with no producer", async () => {
    renderView(<SpaceElevatorView />);
    expect(await screen.findByText("No producer")).toBeInTheDocument();
  });

  it("expands a part to reveal its producing factories and the free rate", async () => {
    renderView(<SpaceElevatorView />);
    const row = await screen.findByText("Smart Plating");
    fireEvent.click(row);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Plating Plant" })).toBeInTheDocument();
    });
    expect(screen.getByText(/2 shipped out/)).toBeInTheDocument();
  });
});
