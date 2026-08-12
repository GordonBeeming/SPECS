import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { plannerApi } from "@/features/planner/api";
import type { ExistingProducerSource, RaiseExportTargetResult } from "@/features/planner/types";

import { useImportFromProducer } from "./useImportFromProducer";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ironWorks: ExistingProducerSource = {
  factoryId: "fac-iron-works",
  factoryName: "Iron Works",
  spareIpm: 5,
  remainingIpm: 0,
  hasTarget: true,
};

const raiseResult: RaiseExportTargetResult = {
  factoryId: "fac-iron-works",
  factoryName: "Iron Works",
  itemId: "Desc_IronPlateReinforced_C",
  itemName: "Reinforced Iron Plate",
  previousTargetIpm: 20,
  newTargetIpm: 20,
  previousExportIpm: 0,
  newExportIpm: 5,
  remainingIpm: 5,
  introducedWarnings: [],
  worsenedWarnings: [],
};

function setup() {
  const addExternalSource = vi.fn();
  const onRaised = vi.fn();
  const { result } = renderHook(
    () =>
      useImportFromProducer({ factoryId: "fac-dest", addExternalSource, onRaised }),
    { wrapper },
  );
  return { result, addExternalSource, onRaised };
}

afterEach(() => vi.restoreAllMocks());

describe("useImportFromProducer", () => {
  it("opens the producer's export slice before adding the source", async () => {
    // Both halves, in this order. The source row is uncapped and
    // resolves to whatever the producer offers, so adding it first
    // pulls 0/min: same machines, same power, same banner, and the
    // click reads as dead.
    const raise = vi
      .spyOn(plannerApi, "raiseExportTarget")
      .mockResolvedValue(raiseResult);
    const { result, addExternalSource, onRaised } = setup();

    act(() =>
      result.current.importFromProducer("Desc_IronPlateReinforced_C", ironWorks, 5),
    );

    expect(addExternalSource).not.toHaveBeenCalled();
    await waitFor(() => expect(addExternalSource).toHaveBeenCalledTimes(1));
    expect(raise).toHaveBeenCalledWith(
      "fac-iron-works",
      "Desc_IronPlateReinforced_C",
      5,
      "fac-dest",
    );
    expect(addExternalSource).toHaveBeenCalledWith(
      "Desc_IronPlateReinforced_C",
      "fac-iron-works",
      null,
    );
    // The raise shows up in the designer's tally like any other.
    expect(onRaised).toHaveBeenCalledWith(raiseResult);
  });

  it("marks the item pending while the slice is being opened", async () => {
    let settle: ((r: RaiseExportTargetResult) => void) | null = null;
    vi.spyOn(plannerApi, "raiseExportTarget").mockReturnValue(
      new Promise<RaiseExportTargetResult>((resolve) => {
        settle = resolve;
      }),
    );
    const { result } = setup();

    act(() =>
      result.current.importFromProducer("Desc_IronPlateReinforced_C", ironWorks, 5),
    );
    await waitFor(() =>
      expect(result.current.pendingItemIds.has("Desc_IronPlateReinforced_C")).toBe(true),
    );

    await act(async () => {
      settle?.(raiseResult);
    });
    await waitFor(() => expect(result.current.pendingItemIds.size).toBe(0));
  });

  it("adds the source without a raise when the producer already exports enough", async () => {
    const raise = vi.spyOn(plannerApi, "raiseExportTarget");
    const { result, addExternalSource } = setup();

    act(() =>
      result.current.importFromProducer(
        "Desc_IronPlateReinforced_C",
        { ...ironWorks, remainingIpm: 5 },
        5,
      ),
    );

    expect(addExternalSource).toHaveBeenCalledWith(
      "Desc_IronPlateReinforced_C",
      "fac-iron-works",
      null,
    );
    expect(raise).not.toHaveBeenCalled();
  });

  it("holds a second offer's raise until the first settles, and applies both", async () => {
    // Clicking a second offer before the first comes back. A raise
    // rewrites the exporter's whole target list from what it read at the
    // start, so overlapping raises against one producer lose whichever
    // finishes first — and the plan here ends up with only one of the
    // two source rows the player asked for.
    const started: string[] = [];
    const settle: Array<() => void> = [];
    vi.spyOn(plannerApi, "raiseExportTarget").mockImplementation((_factoryId, itemId) => {
      started.push(itemId);
      return new Promise<RaiseExportTargetResult>((resolve) => {
        settle.push(() => resolve({ ...raiseResult, itemId }));
      });
    });
    const { result, addExternalSource, onRaised } = setup();

    act(() =>
      result.current.importFromProducer("Desc_IronPlateReinforced_C", ironWorks, 5),
    );
    act(() => result.current.importFromProducer("Desc_Rotor_C", ironWorks, 5));

    await waitFor(() =>
      expect(result.current.pendingItemIds.has("Desc_Rotor_C")).toBe(true),
    );
    // The queued one shows as working, but hasn't been sent.
    expect(started).toEqual(["Desc_IronPlateReinforced_C"]);

    await act(async () => settle[0]?.());
    await waitFor(() =>
      expect(started).toEqual(["Desc_IronPlateReinforced_C", "Desc_Rotor_C"]),
    );
    expect(addExternalSource).toHaveBeenCalledTimes(1);
    expect(addExternalSource).toHaveBeenCalledWith(
      "Desc_IronPlateReinforced_C",
      "fac-iron-works",
      null,
    );

    await act(async () => settle[1]?.());
    await waitFor(() => expect(addExternalSource).toHaveBeenCalledTimes(2));
    expect(addExternalSource).toHaveBeenNthCalledWith(2, "Desc_Rotor_C", "fac-iron-works", null);
    expect(onRaised).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.pendingItemIds.size).toBe(0));
  });

  it("runs a queued raise even after the one in front of it fails", async () => {
    const started: string[] = [];
    vi.spyOn(plannerApi, "raiseExportTarget").mockImplementation((_factoryId, itemId) => {
      started.push(itemId);
      return itemId === "Desc_IronPlateReinforced_C"
        ? Promise.reject(new Error("Iron Works doesn't have a Reinforced Iron Plate target"))
        : Promise.resolve({ ...raiseResult, itemId });
    });
    const { result, addExternalSource } = setup();

    act(() =>
      result.current.importFromProducer("Desc_IronPlateReinforced_C", ironWorks, 5),
    );
    act(() => result.current.importFromProducer("Desc_Rotor_C", ironWorks, 5));

    await waitFor(() => expect(addExternalSource).toHaveBeenCalledTimes(1));
    expect(started).toEqual(["Desc_IronPlateReinforced_C", "Desc_Rotor_C"]);
    expect(addExternalSource).toHaveBeenCalledWith("Desc_Rotor_C", "fac-iron-works", null);
    // The failure is still the one on screen after the later raise
    // succeeded — the click that broke is the one the player has to fix.
    expect(result.current.error?.message).toMatch(/doesn't have a Reinforced Iron Plate target/);
    await waitFor(() => expect(result.current.pendingItemIds.size).toBe(0));
  });

  it("leaves no source row behind when the raise fails", async () => {
    // Half a setup is worse than none: a row that can't be supplied
    // reads as an import while the exporter never agreed to it.
    vi.spyOn(plannerApi, "raiseExportTarget").mockRejectedValue(
      new Error("Iron Works doesn't have a Reinforced Iron Plate target"),
    );
    const { result, addExternalSource } = setup();

    act(() =>
      result.current.importFromProducer("Desc_IronPlateReinforced_C", ironWorks, 5),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(addExternalSource).not.toHaveBeenCalled();
  });
});
