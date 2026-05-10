import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CreatePlaythroughModal } from "./CreatePlaythroughModal";
import { playthroughApi } from "../api";

beforeEach(() => {
  vi.spyOn(playthroughApi, "create").mockResolvedValue({
    id: "x",
    displayName: "Iron Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 0,
    currentMilestoneProgress: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("<CreatePlaythroughModal />", () => {
  it("rejects an empty name without calling the API", async () => {
    const onClose = vi.fn();
    renderWithProviders(<CreatePlaythroughModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/name is required/i);
    });
    expect(playthroughApi.create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rejects a name longer than 80 characters", async () => {
    renderWithProviders(<CreatePlaythroughModal onClose={() => {}} />);
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    // The modal uses maxLength=80 to cap typing — set the value directly so
    // the validator path itself is exercised, not the browser's clamp.
    fireEvent.change(input, { target: { value: "x".repeat(81) } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/80 characters/i);
    });
    expect(playthroughApi.create).not.toHaveBeenCalled();
  });

  it("creates and closes on a valid submit", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderWithProviders(
      <CreatePlaythroughModal onClose={onClose} onCreated={onCreated} />,
    );
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Iron Run" } });
    // Pick Tier 3 via the type-to-filter combobox.
    const tierBox = screen.getByRole("combobox", { name: /starting tier/i });
    await user.click(tierBox);
    await user.keyboard("{ArrowDown}");
    await waitFor(() => screen.getByRole("option", { name: "Tier 3" }));
    await user.click(screen.getByRole("option", { name: "Tier 3" }));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(playthroughApi.create).toHaveBeenCalledWith({
        displayName: "Iron Run",
        startingTier: 3,
      });
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("surfaces a server error via role=alert and keeps the modal open", async () => {
    vi.spyOn(playthroughApi, "create").mockRejectedValueOnce(new Error("disk full"));
    const onClose = vi.fn();
    renderWithProviders(<CreatePlaythroughModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Run" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/disk full/);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
