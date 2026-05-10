import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TierBadge } from "./TierBadge";
import { playthroughApi } from "@/features/playthrough/api";

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<TierBadge />", () => {
  it("shows plain text when no playthrough is active", async () => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue(null);
    renderWithProviders(<TierBadge unlockTier={5} />);
    await waitFor(() => {
      expect(screen.getByText("Tier 5")).toBeInTheDocument();
    });
    expect(screen.queryByText(/locked/i)).toBeNull();
  });

  it("does NOT mark a tier as locked when the active playthrough has reached it", async () => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p", displayName: "Run", gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z", currentTier: 5, currentMilestoneProgress: 0,
    });
    renderWithProviders(<TierBadge unlockTier={5} />);
    await waitFor(() => {
      expect(screen.getByText("Tier 5")).toBeInTheDocument();
    });
    expect(screen.queryByText(/locked/i)).toBeNull();
  });

  it("marks a tier as LOCKED when the active playthrough is below it", async () => {
    vi.spyOn(playthroughApi, "current").mockResolvedValue({
      id: "p", displayName: "Run", gameVersion: "1.1",
      createdAt: "2026-05-10T00:00:00Z", currentTier: 2, currentMilestoneProgress: 0,
    });
    renderWithProviders(<TierBadge unlockTier={6} />);
    await waitFor(() => {
      expect(screen.getByText("Tier 6")).toBeInTheDocument();
      // The lock pill is role=img with the aria-label as its accessible name.
      // Using getByRole catches the case where a span's aria-label is silently
      // ignored by AT — bare-span aria-labels do not register as a role.
      expect(screen.getByRole("img", { name: /Locked — requires Tier 6/i })).toBeInTheDocument();
    });
  });
});
