import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CreateFactoryModal } from "./CreateFactoryModal";
import { factoryApi } from "../api";

beforeEach(() => {
  vi.spyOn(factoryApi, "create").mockResolvedValue({
    id: "f1",
    name: "Iron Plant",
    worldX: 0,
    worldY: 0,
    createdAt: "2026-05-10T00:00:00Z",
    updatedAt: "2026-05-10T00:00:00Z",
    machineCount: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("<CreateFactoryModal />", () => {
  it("rejects an empty name without calling the API", async () => {
    const onClose = vi.fn();
    renderWithProviders(<CreateFactoryModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/name is required/i);
    });
    expect(factoryApi.create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("creates and reports the new factory id on success", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderWithProviders(<CreateFactoryModal onClose={onClose} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Iron Plant" } });
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "Tier 0 ingots" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(factoryApi.create).toHaveBeenCalledWith({
        name: "Iron Plant",
        notes: "Tier 0 ingots",
      });
      expect(onCreated).toHaveBeenCalledWith("f1");
      expect(onClose).toHaveBeenCalled();
    });
  });
});
