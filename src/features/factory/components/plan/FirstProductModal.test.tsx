import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { libraryApi } from "@/features/library/api";
import { plannerApi } from "@/features/planner/api";
import { playthroughApi } from "@/features/playthrough/api";
import { FirstProductModal } from "./FirstProductModal";

const items = [
  { id: "Desc_Cable_C", name: "Cable", category: "part" as const, stackSize: 200, isFluid: false },
  { id: "Desc_Computer_C", name: "Computer", category: "part" as const, stackSize: 50, isFluid: false },
];

const itemTiers = [
  { itemId: "Desc_Cable_C", tier: 0, standardTier: 0 },
  { itemId: "Desc_Computer_C", tier: 6, standardTier: 6 },
];

beforeEach(() => {
  vi.spyOn(libraryApi, "items").mockResolvedValue(items);
  vi.spyOn(libraryApi, "recipes").mockResolvedValue([]);
  vi.spyOn(plannerApi, "listItemTiers").mockResolvedValue(itemTiers);
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "pt-1",
    displayName: "Run",
    gameVersion: "1.2",
    createdAt: "2026-07-26T00:00:00Z",
    currentTier: 6,
    currentMilestoneProgress: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

function renderModal(onConfirm = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  render(
    wrap(
      <FirstProductModal
        factoryName="Computer Plant"
        firstRun
        onConfirm={onConfirm}
        onDeleteFactory={() => {}}
      />,
    ),
  );
  return onConfirm;
}

describe("<FirstProductModal />", () => {
  it("commits a fractional rate — 2.5/min Computers is an ordinary target", async () => {
    // The reported bug: `step="1"` failed native constraint validation,
    // so the browser cancelled the submit and OK looked broken.
    const user = userEvent.setup();
    const onConfirm = renderModal();
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Computer/ }));
    const rate = screen.getByLabelText("Items per minute");
    fireEvent.change(rate, { target: { value: "2.5" } });
    expect(rate).toBeValid();
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(onConfirm).toHaveBeenCalledWith("Desc_Computer_C", 2.5);
  });

  it("explains a refusal instead of silently not closing", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();
    await user.click(await screen.findByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Cable/ }));
    fireEvent.change(screen.getByLabelText("Items per minute"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/rate greater than 0/i);
  });
});
