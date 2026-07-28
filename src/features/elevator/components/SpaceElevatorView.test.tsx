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

  it("notes when a part's free rate is the same supply shared with another phase (#72)", async () => {
    // Regresses: Phase 1 and Phase 2 both needing Smart Plating rendered
    // the identical "X/min free" figure under each phase with nothing
    // saying it's one shared production line, not double the capacity.
    const sharedOverview: ElevatorOverview = {
      phases: [
        overview.phases[0],
        {
          phase: 2,
          name: "Construction Dock",
          unlocksTiers: [5, 6],
          parts: [
            // Same itemId as Phase 1's Smart Plating part.
            { ...overview.phases[0].parts[0], requiredQuantity: 100 },
          ],
        },
      ],
    };
    vi.spyOn(elevatorApi, "overview").mockResolvedValue(sharedOverview);

    renderView(<SpaceElevatorView />);
    await screen.findByText(/Phase 2 — Construction Dock/);

    const notes = screen.getAllByText(/Same Smart Plating supply also shows under Phase/);
    // Both phases carry the cross-reference, pointing at each other.
    expect(notes).toHaveLength(2);
    expect(notes[0]).toHaveTextContent("Phase 2");
    expect(notes[1]).toHaveTextContent("Phase 1");
  });

  it("doesn't add a cross-phase note for a part that only appears once", async () => {
    renderView(<SpaceElevatorView />);
    await screen.findByText("Automated Wiring");
    expect(
      screen.queryByText(/Same .* supply also shows under Phase/),
    ).not.toBeInTheDocument();
  });
});
