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
  vi.spyOn(playthroughApi, "setCurrentTier").mockResolvedValue({
    ...fixtureCurrent,
    currentTier: 6,
  });
  vi.spyOn(playthroughApi, "delete").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<PlaythroughSwitcher />", () => {
  it("renders the current playthrough name in the trigger", async () => {
    // Tier display moved to the Home view; the header trigger now shows
    // only the name so the dropdown stays focused on playthrough
    // switching.
    renderWithProviders(<PlaythroughSwitcher />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /iron run/i })).toBeInTheDocument();
    });
  });

  it("opens the popover and lists playthroughs with an active marker", async () => {
    renderWithProviders(<PlaythroughSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /iron run/i }));
    await waitFor(() => {
      // The popover is a plain interactive surface (not a WAI-ARIA menu),
      // so target rows by their button label instead of role=menuitem.
      expect(screen.getByRole("button", { name: /iron run.*active/i })).toBeInTheDocument();
      // Anchor to exact match so we don't collide with the trash button's
      // "Delete Speedrun" aria-label.
      expect(screen.getByRole("button", { name: "Speedrun" })).toBeInTheDocument();
    });
  });

  it("opens a different playthrough on click", async () => {
    renderWithProviders(<PlaythroughSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /iron run/i }));
    // The row's open button matches "Speedrun" exactly; the trash button
    // sibling lives under aria-label "Delete Speedrun", so we anchor with
    // an exact-text match to avoid hitting the delete affordance.
    fireEvent.click(await screen.findByRole("button", { name: "Speedrun" }));
    await waitFor(() => {
      expect(playthroughApi.open).toHaveBeenCalledWith("def");
    });
  });

  it("two-step deletes a playthrough from the row trash button", async () => {
    renderWithProviders(<PlaythroughSwitcher />);
    fireEvent.click(await screen.findByRole("button", { name: /iron run/i }));
    // First click on the per-row trash → confirmation reveal.
    fireEvent.click(await screen.findByLabelText(/delete speedrun/i));
    // Then the explicit Delete button actually invokes the API.
    fireEvent.click(await screen.findByLabelText(/confirm delete speedrun/i));
    await waitFor(() => {
      expect(playthroughApi.delete).toHaveBeenCalledWith("def");
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
