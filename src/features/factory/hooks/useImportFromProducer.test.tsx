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
      expect(result.current.pendingItemId).toBe("Desc_IronPlateReinforced_C"),
    );

    await act(async () => {
      settle?.(raiseResult);
    });
    await waitFor(() => expect(result.current.pendingItemId).toBeNull());
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
