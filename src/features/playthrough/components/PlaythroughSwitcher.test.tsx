import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PlaythroughSwitcher } from "./PlaythroughSwitcher";
import { playthroughApi } from "../api";
import type { PlaythroughDetail, PlaythroughSummary } from "../types";

const fixtureList: PlaythroughSummary[] = [
  {
    id: "abc",
    displayName: "Iron Run",
    createdAt: "2026-05-10T00:00:00Z",
    lastOpenedAt: "2026-05-10T00:00:00Z",
    schemaVersion: 1,
  },
  {
    id: "def",
    displayName: "Speedrun",
    createdAt: "2026-05-09T00:00:00Z",
    lastOpenedAt: null,
    schemaVersion: 1,
  },
];

const fixtureCurrent: PlaythroughDetail = {
  id: "abc",
  displayName: "Iron Run",
  gameVersion: "1.1",
  createdAt: "2026-05-10T00:00:00Z",
  currentTier: 4,
  currentMilestoneProgress: 0,
};

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(playthroughApi, "list").mockResolvedValue(fixtureList);
  vi.spyOn(playthroughApi, "current").mockResolvedValue(fixtureCurrent);
  vi.spyOn(playthroughApi, "open").mockResolvedValue(fixtureCurrent);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<PlaythroughSwitcher />", () => {
  it("renders the current playthrough name and tier in the trigger", async () => {
    renderWithProviders(<PlaythroughSwitcher />);
    await waitFor(() => {
      // "Iron Run · T4"
      expect(screen.getByRole("button", { name: /iron run/i })).toHaveTextContent(/T4/);
    });
  });

  it("opens the popover and lists playthroughs with an active marker", async () => {
    renderWithProviders(<PlaythroughSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /iron run/i }));
    await waitFor(() => {
      // The popover is a plain interactive surface (not a WAI-ARIA menu),
      // so target rows by their button label instead of role=menuitem.
      expect(screen.getByRole("button", { name: /iron run.*active/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /speedrun/i })).toBeInTheDocument();
    });
  });

  it("opens a different playthrough on click", async () => {
    renderWithProviders(<PlaythroughSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /iron run/i }));
    fireEvent.click(await screen.findByRole("button", { name: /speedrun/i }));
    await waitFor(() => {
      expect(playthroughApi.open).toHaveBeenCalledWith("def");
    });
  });

  it("shows an empty-state line when no playthroughs exist", async () => {
    vi.spyOn(playthroughApi, "list").mockResolvedValueOnce([]);
    vi.spyOn(playthroughApi, "current").mockResolvedValueOnce(null);
    renderWithProviders(<PlaythroughSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /no playthrough/i }));
    await waitFor(() => {
      expect(screen.getByText(/no playthroughs yet/i)).toBeInTheDocument();
    });
  });
});
