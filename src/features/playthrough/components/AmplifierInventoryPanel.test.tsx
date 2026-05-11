import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AmplifierInventoryPanel } from "./AmplifierInventoryPanel";
import { playthroughApi } from "../api";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  // The amplifier-inventory hook is now gated on an active playthrough,
  // so every test needs `current` to resolve to one before the query
  // fires. Without this the panel renders forever in its initial-zero
  // state and the load/submit assertions race.
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 0,
    currentMilestoneProgress: 0,
  });
  vi.spyOn(playthroughApi, "getAmplifierInventory").mockResolvedValue({
    somersloopQuantity: 4,
    powerShardQuantity: 2,
  });
  vi.spyOn(playthroughApi, "setAmplifierInventory").mockResolvedValue({
    somersloopQuantity: 10,
    powerShardQuantity: 6,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<AmplifierInventoryPanel />", () => {
  it("loads the current inventory and pre-fills the inputs", async () => {
    renderWithProviders(<AmplifierInventoryPanel onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByLabelText("Somersloops")).toHaveValue(4);
      expect(screen.getByLabelText("Power Shards")).toHaveValue(2);
    });
  });

  it("submits the new values to set_amplifier_inventory and closes on success", async () => {
    const onClose = vi.fn();
    renderWithProviders(<AmplifierInventoryPanel onClose={onClose} />);
    const somers = await screen.findByLabelText("Somersloops");
    const shards = screen.getByLabelText("Power Shards");
    fireEvent.change(somers, { target: { value: "10" } });
    fireEvent.change(shards, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(playthroughApi.setAmplifierInventory).toHaveBeenCalledWith({
        somersloopQuantity: 10,
        powerShardQuantity: 6,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("clamps negative inputs to zero before submitting", async () => {
    renderWithProviders(<AmplifierInventoryPanel onClose={() => {}} />);
    // Wait for the query to settle so the inputs reflect the loaded
    // inventory before we mutate them — otherwise we race the useEffect
    // sync and the submit payload looks like the initial-zero state.
    const somers = await screen.findByLabelText("Somersloops");
    await waitFor(() => expect(somers).toHaveValue(4));
    fireEvent.change(somers, { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => {
      expect(playthroughApi.setAmplifierInventory).toHaveBeenCalledWith({
        somersloopQuantity: 0,
        powerShardQuantity: 2,
      });
    });
  });
});
