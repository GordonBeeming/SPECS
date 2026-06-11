import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ValidationPanel } from "./ValidationPanel";
import { validationApi } from "../api";
import { useNavStore } from "@/shared/nav-store";
import type { ValidationReport } from "../types";

const cleanReport: ValidationReport = {
  currentTier: 4,
  findings: [],
  altShoppingList: [],
  grid: { generatedMw: 100, consumedMw: 60, netMw: 40 },
  checkedAt: "2026-06-11T00:00:00Z",
};

const messyReport: ValidationReport = {
  currentTier: 2,
  findings: [
    {
      severity: "error",
      category: "tierGating",
      kind: "machineRecipeAboveTier",
      factoryId: "f1",
      factoryName: "Compute Hall",
      recipeId: "Recipe_Computer_C",
      recipeName: "Computer",
      unlockTier: 6,
    },
    {
      severity: "error",
      category: "flow",
      kind: "linkOverdraw",
      fromFactoryId: "f2",
      fromFactoryName: "Plate Source",
      itemId: "Desc_IronPlate_C",
      itemName: "Iron Plate",
      drawnIpm: 25,
      availableIpm: 10,
    },
    {
      severity: "warning",
      category: "lockedAlts",
      kind: "lockedAltInUse",
      factoryId: "f1",
      factoryName: "Compute Hall",
      recipeId: "Recipe_Alternate_Computer_1_C",
      recipeName: "Crystal Computer",
      inPlan: true,
      inMachines: false,
    },
  ],
  altShoppingList: [
    {
      recipeId: "Recipe_Alternate_Computer_1_C",
      recipeName: "Crystal Computer",
      unlockTier: 2,
      wantedBy: [{ factoryId: "f1", factoryName: "Compute Hall" }],
    },
  ],
  grid: { generatedMw: 30, consumedMw: 90, netMw: -60 },
  checkedAt: "2026-06-11T00:00:00Z",
};

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  useNavStore.setState({ pendingFactoryId: null, pendingRoute: null });
});

afterEach(() => vi.restoreAllMocks());

describe("<ValidationPanel />", () => {
  it("shows the all-clear state when the sweep finds nothing", async () => {
    vi.spyOn(validationApi, "validate").mockResolvedValue(cleanReport);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(
      await screen.findByText(/No findings — everything checks out at T4/),
    ).toBeInTheDocument();
    expect(screen.getByText(/100 MW gen \/ 60 MW draw/)).toBeInTheDocument();
  });

  it("groups findings by category with severity counts and the alt shopping list", async () => {
    vi.spyOn(validationApi, "validate").mockResolvedValue(messyReport);
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(await screen.findByText("2 errors")).toBeInTheDocument();
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    expect(screen.getByText("Above your tier")).toBeInTheDocument();
    expect(screen.getByText("Cross-factory flows")).toBeInTheDocument();
    expect(
      screen.getByText(/Compute Hall: machines run Computer \(unlocks T6\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/links draw 25\.0\/min of Iron Plate, exports cover 10\.0/),
    ).toBeInTheDocument();
    // The shopping list rolls the locked alt up with its wanters.
    expect(screen.getByText("Hard drives to collect")).toBeInTheDocument();
    expect(screen.getByText("Crystal Computer")).toBeInTheDocument();
  });

  it("deep-links a tier finding to its factory and closes the panel", async () => {
    vi.spyOn(validationApi, "validate").mockResolvedValue(messyReport);
    const onClose = vi.fn();
    renderWithProviders(<ValidationPanel onClose={onClose} />);
    const row = await screen.findByText(/machines run Computer/);
    fireEvent.click(row.closest("button")!);
    await waitFor(() => {
      expect(useNavStore.getState().pendingFactoryId).toBe("f1");
      expect(useNavStore.getState().pendingRoute).toBe("factories");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("surfaces a failed sweep as an alert", async () => {
    vi.spyOn(validationApi, "validate").mockRejectedValue(new Error("no active playthrough"));
    renderWithProviders(<ValidationPanel onClose={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/no active playthrough/);
  });
});
