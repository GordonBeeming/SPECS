import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { factoryApi } from "@/features/factory/api";
import { libraryApi } from "@/features/library/api";
import { playthroughApi } from "@/features/playthrough/api";
import { LogisticsLinkEditor } from "./LogisticsLinkEditor";
import type { LogisticsLink } from "../types";

// Same 3-4-5 triangle used to pin `factoryDistanceMeters` in
// map/transform.test.ts: 30,000cm × 40,000cm apart = 50,000cm = 500m.
// Neither factory sits at (0, 0) — that's the "unplaced" sentinel and
// would make the derivation bail out to null instead.
const copperWorks = {
  id: "f-copper",
  name: "Copper Works",
  worldX: 10000,
  worldY: 10000,
  createdAt: "2026-05-10T00:00:00Z",
  updatedAt: "2026-05-10T00:00:00Z",
  machineCount: 0,
};
const ironWorks = {
  id: "f-iron",
  name: "Iron Works",
  worldX: 40000,
  worldY: 50000,
  createdAt: "2026-05-10T00:00:00Z",
  updatedAt: "2026-05-10T00:00:00Z",
  machineCount: 0,
};
// Never placed on the map — stays at the schema's (0, 0) default.
const unplacedFactory = {
  id: "f-unplaced",
  name: "Unplaced Depot",
  worldX: 0,
  worldY: 0,
  createdAt: "2026-05-10T00:00:00Z",
  updatedAt: "2026-05-10T00:00:00Z",
  machineCount: 0,
};

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/**
 * FilterSelect opens its listbox via a `requestAnimationFrame`-deferred
 * click on a hidden button (see `openIfClosed` in FilterSelect.tsx), so
 * the open/select sequence isn't guaranteed to land within one
 * `user.click()` + `user.keyboard()` pass — occasionally the found
 * `option` element is already stale (Headless UI re-rendered the
 * listbox) by the time the click dispatches, and the selection never
 * commits. Two `pickFactory` calls back to back, as every test below
 * does, race that deferred callback across comboboxes more than a
 * single call would. Retrying the whole open+select gesture until the
 * combobox actually shows the picked label is more robust than hoping
 * one attempt lands — this is a test-timing workaround, not a product
 * bug, so a bounded retry here is the right fix rather than one in the
 * component.
 */
async function pickFactory(user: ReturnType<typeof userEvent.setup>, label: RegExp, name: RegExp) {
  const combobox = screen.getByRole("combobox", { name: label }) as HTMLInputElement;
  for (let attempt = 0; attempt < 5; attempt++) {
    await user.click(combobox);
    await user.keyboard("{ArrowDown}");
    const option = await screen.findByRole("option", { name });
    await user.click(option);
    try {
      await waitFor(() => expect(combobox.value).toMatch(name), { timeout: 300 });
      return;
    } catch {
      // Selection didn't commit this attempt — the listbox may have
      // re-rendered mid-click. Loop around and try again.
    }
  }
  // Final attempt outside the loop's swallowed retries — let this one
  // throw with the real assertion failure if the combobox genuinely
  // never picks up the value.
  await waitFor(() => expect(combobox.value).toMatch(name));
}

beforeEach(() => {
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 0,
    currentMilestoneProgress: 0,
  });
  vi.spyOn(factoryApi, "list").mockResolvedValue([copperWorks, ironWorks, unplacedFactory]);
  vi.spyOn(libraryApi, "items").mockResolvedValue([
    { id: "Desc_CopperIngot_C", name: "Copper Ingot", category: "ingot", stackSize: 100, isFluid: false },
  ]);
});

afterEach(() => vi.restoreAllMocks());

describe("<LogisticsLinkEditor /> — map-derived distance", () => {
  it("auto-fills distance from the two selected factories' map coordinates", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LogisticsLinkEditor onClose={() => {}} />);

    await pickFactory(user, /from factory/i, /Copper Works/i);
    await pickFactory(user, /to factory/i, /Iron Works/i);

    await waitFor(() => {
      expect(screen.getByLabelText(/distance/i)).toHaveValue(500);
    });
    expect(screen.getByText(/from the map/i)).toBeInTheDocument();
  });

  it("lets the player override the derived distance", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LogisticsLinkEditor onClose={() => {}} />);

    await pickFactory(user, /from factory/i, /Copper Works/i);
    await pickFactory(user, /to factory/i, /Iron Works/i);
    await waitFor(() => expect(screen.getByLabelText(/distance/i)).toHaveValue(500));

    // `fireEvent.change` sets the whole value atomically — digit-by-digit
    // `user.type()` on a controlled numeric input races the re-render
    // between keystrokes and can drop trailing digits (see the same fix
    // in AddMachineForm.test.tsx).
    const distanceField = screen.getByLabelText(/distance/i);
    fireEvent.change(distanceField, { target: { value: "1200" } });
    expect(distanceField).toHaveValue(1200);

    // Re-render's effect must not stomp the manual value back to the
    // map's measurement now that the field has been touched.
    await waitFor(() => expect(distanceField).toHaveValue(1200));
  });

  it("leaves distance blank and hints when an endpoint has never been placed on the map", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LogisticsLinkEditor onClose={() => {}} />);

    await pickFactory(user, /from factory/i, /Copper Works/i);
    await pickFactory(user, /to factory/i, /Unplaced Depot/i);

    expect(screen.getByLabelText(/distance/i)).toHaveValue(null);
    expect(screen.getByText(/place both factories on the map/i)).toBeInTheDocument();
  });

  it("keeps a stored distance from an existing link instead of overwriting it with the map's measurement", async () => {
    const link: LogisticsLink = {
      id: "link-1",
      fromFactoryId: copperWorks.id,
      toFactoryId: ironWorks.id,
      itemId: "Desc_CopperIngot_C",
      itemsPerMinute: 60,
      transportKind: "truck",
      transportPlanJson: "{}",
      distanceM: 42,
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    };
    renderWithProviders(<LogisticsLinkEditor link={link} onClose={() => {}} />);

    // The map would measure 500m for this pair — the stored 42m (the
    // player's own number) must win.
    await waitFor(() => expect(screen.getByLabelText(/distance/i)).toHaveValue(42));
    // And it must read as locked, not as still-tracking the map — the
    // "from the map" hint is exactly what the round-3 regression below
    // checks is present in the opposite case.
    expect(screen.queryByText(/from the map/i)).not.toBeInTheDocument();
  });

  it("still treats a stored distance as map-derived when it matches today's measurement, so a later map move keeps updating it", async () => {
    // Codex P2: `distanceTouched` used to start `true` for any stored
    // distance, purely because the value was non-null — even when that
    // stored number is itself just what the map derived at save time
    // (the default write path). That locked the field forever, so
    // moving either factory afterward never refreshed a link's distance
    // again. A stored 500m for this exact pair is indistinguishable
    // from "we persisted the map's own measurement" — it must keep
    // behaving like a brand-new link (the same "from the map" hint),
    // not like a typed override.
    const link: LogisticsLink = {
      id: "link-2",
      fromFactoryId: copperWorks.id,
      toFactoryId: ironWorks.id,
      itemId: "Desc_CopperIngot_C",
      itemsPerMinute: 60,
      transportKind: "truck",
      transportPlanJson: "{}",
      distanceM: 500, // exactly what the map derives for this pair today
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
    };
    renderWithProviders(<LogisticsLinkEditor link={link} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText(/distance/i)).toHaveValue(500));
    expect(await screen.findByText(/from the map/i)).toBeInTheDocument();
  });
});

describe("<LogisticsLinkEditor /> — modal layout and validation", () => {
  it("keeps the footer (Save/Create) outside the scrolling region, so it stays reachable regardless of how many transport options render", async () => {
    renderWithProviders(<LogisticsLinkEditor onClose={() => {}} />);

    const submitButton = screen.getByRole("button", { name: /create link/i });
    const scrollRegion = document.querySelector(".overflow-y-auto");
    expect(scrollRegion).not.toBeNull();
    // Pins the modal-can't-scroll regression: the footer used to live
    // inside the same flex child as the growing transport-option list,
    // so it got pushed past `max-h-[90vh]` and clipped by the parent's
    // `overflow-hidden` with nothing to scroll it back into view.
    expect(scrollRegion?.contains(submitButton)).toBe(false);
  });

  it("shows a validation message instead of silently doing nothing when throughput is 0", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LogisticsLinkEditor onClose={() => {}} />);

    await pickFactory(user, /from factory/i, /Copper Works/i);
    await pickFactory(user, /to factory/i, /Iron Works/i);
    await pickFactory(user, /^item$/i, /Copper Ingot/i);

    const ipmField = screen.getByLabelText(/throughput/i);
    fireEvent.change(ipmField, { target: { value: "0" } });

    // The input's `min={0.01}` used to trigger the browser's own
    // constraint validation, which swallows the submit event before
    // this component's handler runs — every field's edits vanished
    // with no message at all. `noValidate` on the form hands the
    // check to `onSubmit`, which must now surface a real error.
    await user.click(screen.getByRole("button", { name: /create link/i }));
    expect(await screen.findByText(/throughput must be at least 0\.01 ipm/i)).toBeInTheDocument();
  });

  it("closes on Escape, matching every other modal", () => {
    const onClose = vi.fn();
    renderWithProviders(<LogisticsLinkEditor onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
