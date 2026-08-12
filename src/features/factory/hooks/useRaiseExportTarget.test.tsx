import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { plannerApi } from "@/features/planner/api";
import type { ExistingProducerSource, RaiseExportTargetResult } from "@/features/planner/types";

import { useImportFromProducer } from "./useImportFromProducer";
import { useRaiseExportTarget } from "./useRaiseExportTarget";

// The raise queue lives at module scope on purpose, so it outlives
// every hook instance a test renders — and every test in this file.
// Each test therefore raises against exporter ids of its own, so a
// chain left mid-flight by one test can never gate the next one.
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const result = (exporterFactoryId: string, itemId: string): RaiseExportTargetResult => ({
  factoryId: exporterFactoryId,
  factoryName: "Iron Works",
  itemId,
  itemName: "Reinforced Iron Plate",
  previousTargetIpm: 20,
  newTargetIpm: 25,
  previousExportIpm: 0,
  newExportIpm: 5,
  remainingIpm: 5,
  introducedWarnings: [],
  worsenedWarnings: [],
});

/**
 * Stands in for the backend, recording which raises have actually been
 * sent and handing back a lever to settle each one. What a raise
 * *returns* is beside the point here — when it is allowed to start is
 * the whole test.
 */
function controllableRaise() {
  const started: Array<{ exporterFactoryId: string; itemId: string }> = [];
  const settle: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  vi.spyOn(plannerApi, "raiseExportTarget").mockImplementation(
    (exporterFactoryId, itemId) => {
      started.push({ exporterFactoryId, itemId });
      return new Promise<RaiseExportTargetResult>((resolve, reject) => {
        settle.push({
          resolve: () => resolve(result(exporterFactoryId, itemId)),
          reject,
        });
      });
    },
  );
  return {
    started,
    settle,
    /** Exporters of the raises sent so far, in the order they were sent. */
    sentTo: () => started.map((s) => s.exporterFactoryId),
    sentItems: () => started.map((s) => s.itemId),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("useRaiseExportTarget", () => {
  it("holds a raise against an exporter another hook instance is already raising", async () => {
    // Two hook instances with no React state between them, both
    // read-modify-writing one exporter's target list. Overlapping them
    // means the later save carries the earlier one's stale targets and
    // silently erases the raise the player just watched succeed.
    const api = controllableRaise();
    const first = renderHook(() => useRaiseExportTarget("fac-dest-a"), { wrapper });
    const second = renderHook(() => useRaiseExportTarget("fac-dest-b"), { wrapper });

    act(() =>
      first.result.current.mutate({
        exporterFactoryId: "fac-shared",
        itemId: "Desc_IronPlateReinforced_C",
        neededIpm: 5,
      }),
    );
    act(() =>
      second.result.current.mutate({
        exporterFactoryId: "fac-shared",
        itemId: "Desc_Rotor_C",
        neededIpm: 5,
      }),
    );

    await waitFor(() => expect(second.result.current.isPending).toBe(true));
    expect(api.sentItems()).toEqual(["Desc_IronPlateReinforced_C"]);

    await act(async () => api.settle[0]?.resolve());
    await waitFor(() =>
      expect(api.sentItems()).toEqual(["Desc_IronPlateReinforced_C", "Desc_Rotor_C"]),
    );

    // A third raise arriving after the first finished, while the second
    // is still out. The exporter is mid-write, so this one waits too —
    // the chain has to survive its own bookkeeping, not just the first
    // handover.
    act(() =>
      first.result.current.mutate({
        exporterFactoryId: "fac-shared",
        itemId: "Desc_ModularFrame_C",
        neededIpm: 5,
      }),
    );
    await waitFor(() => expect(first.result.current.isPending).toBe(true));
    expect(api.sentItems()).toEqual(["Desc_IronPlateReinforced_C", "Desc_Rotor_C"]);

    await act(async () => api.settle[1]?.resolve());
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(api.sentItems()).toEqual([
        "Desc_IronPlateReinforced_C",
        "Desc_Rotor_C",
        "Desc_ModularFrame_C",
      ]),
    );

    await act(async () => api.settle[2]?.resolve());
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
  });

  it("runs raises against different exporters at the same time", async () => {
    // Positive control for the test above: one queue for everything
    // would pass that one and fail this. Two exporters are two separate
    // plans, and making a player wait on an unrelated factory's raise
    // is a stall with nothing behind it.
    const api = controllableRaise();
    const iron = renderHook(() => useRaiseExportTarget("fac-dest-c"), { wrapper });
    const copper = renderHook(() => useRaiseExportTarget("fac-dest-c"), { wrapper });

    act(() =>
      iron.result.current.mutate({
        exporterFactoryId: "fac-iron",
        itemId: "Desc_IronPlateReinforced_C",
        neededIpm: 5,
      }),
    );
    act(() =>
      copper.result.current.mutate({
        exporterFactoryId: "fac-copper",
        itemId: "Desc_Cable_C",
        neededIpm: 5,
      }),
    );

    // Both in flight with neither settled: the copper raise never
    // waited on the iron one.
    await waitFor(() => expect(api.sentTo()).toEqual(["fac-iron", "fac-copper"]));

    // And the second one finishing first is not held up by the first
    // either — it reports its own result while iron is still out.
    await act(async () => api.settle[1]?.resolve());
    await waitFor(() => expect(copper.result.current.isSuccess).toBe(true));
    expect(iron.result.current.isPending).toBe(true);

    await act(async () => api.settle[0]?.resolve());
    await waitFor(() => expect(iron.result.current.isSuccess).toBe(true));
  });

  it("lets the next raise through after one against that exporter fails", async () => {
    // A raise the backend refuses is ordinary — the exporter has no
    // target for the item, or no headroom. If the failure stayed in the
    // chain, that exporter would take no further raises for the rest of
    // the session and every later click would hang pending forever.
    const api = controllableRaise();
    const first = renderHook(() => useRaiseExportTarget("fac-dest-d"), { wrapper });
    const second = renderHook(() => useRaiseExportTarget("fac-dest-d"), { wrapper });

    act(() =>
      first.result.current.mutate({
        exporterFactoryId: "fac-wedge",
        itemId: "Desc_IronPlateReinforced_C",
        neededIpm: 5,
      }),
    );
    await waitFor(() => expect(api.started).toHaveLength(1));

    await act(async () =>
      api.settle[0]?.reject(new Error("Iron Works doesn't have a Rotor target")),
    );
    await waitFor(() => expect(first.result.current.isError).toBe(true));
    expect(first.result.current.error?.message).toMatch(/doesn't have a Rotor target/);

    act(() =>
      second.result.current.mutate({
        exporterFactoryId: "fac-wedge",
        itemId: "Desc_Rotor_C",
        neededIpm: 5,
      }),
    );
    await waitFor(() => expect(api.sentItems()).toEqual([
      "Desc_IronPlateReinforced_C",
      "Desc_Rotor_C",
    ]));

    await act(async () => api.settle[1]?.resolve());
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
  });

  it("gates the Sources panel's raise and the graph's import on one queue", async () => {
    // The panel's "Raise target" and the graph's "import instead" are
    // the same write against the same exporter, reached from two places
    // on screen at once. Whichever one is second has to wait, or the
    // pair races exactly like two of either would.
    const api = controllableRaise();
    const addExternalSource = vi.fn();
    const graph = renderHook(
      () =>
        useImportFromProducer({
          factoryId: "fac-dest-e",
          addExternalSource,
          onRaised: vi.fn(),
        }),
      { wrapper },
    );
    const panel = renderHook(() => useRaiseExportTarget("fac-dest-e"), { wrapper });

    const offer: ExistingProducerSource = {
      factoryId: "fac-both-ways",
      factoryName: "Iron Works",
      spareIpm: 5,
      remainingIpm: 0,
      hasTarget: true,
    };
    act(() =>
      graph.result.current.importFromProducer("Desc_IronPlateReinforced_C", offer, 5),
    );
    act(() =>
      panel.result.current.mutate({
        exporterFactoryId: "fac-both-ways",
        itemId: "Desc_Rotor_C",
        neededIpm: 5,
      }),
    );

    await waitFor(() => expect(panel.result.current.isPending).toBe(true));
    expect(api.sentItems()).toEqual(["Desc_IronPlateReinforced_C"]);

    await act(async () => api.settle[0]?.resolve());
    await waitFor(() =>
      expect(api.sentItems()).toEqual(["Desc_IronPlateReinforced_C", "Desc_Rotor_C"]),
    );
    expect(addExternalSource).toHaveBeenCalledWith(
      "Desc_IronPlateReinforced_C",
      "fac-both-ways",
      null,
    );

    await act(async () => api.settle[1]?.resolve());
    await waitFor(() => expect(panel.result.current.isSuccess).toBe(true));
  });

  it("runs one factory's offer while another factory's raise is still out", async () => {
    // The claim the queue has to keep on the import path too: two
    // producers, two independent raises, neither one waiting.
    const api = controllableRaise();
    const addExternalSource = vi.fn();
    const graph = renderHook(
      () =>
        useImportFromProducer({
          factoryId: "fac-dest-f",
          addExternalSource,
          onRaised: vi.fn(),
        }),
      { wrapper },
    );

    const ironOffer: ExistingProducerSource = {
      factoryId: "fac-iron-2",
      factoryName: "Iron Works",
      spareIpm: 5,
      remainingIpm: 0,
      hasTarget: true,
    };
    const copperOffer: ExistingProducerSource = {
      ...ironOffer,
      factoryId: "fac-copper-2",
      factoryName: "Copper Works",
    };

    act(() =>
      graph.result.current.importFromProducer("Desc_IronPlateReinforced_C", ironOffer, 5),
    );
    act(() => graph.result.current.importFromProducer("Desc_Cable_C", copperOffer, 5));

    await waitFor(() => expect(api.sentTo()).toEqual(["fac-iron-2", "fac-copper-2"]));

    // Copper lands first and its source row goes in straight away,
    // rather than queuing behind an iron raise it has nothing to do with.
    await act(async () => api.settle[1]?.resolve());
    await waitFor(() =>
      expect(addExternalSource).toHaveBeenCalledWith("Desc_Cable_C", "fac-copper-2", null),
    );
    expect(graph.result.current.pendingItemIds.has("Desc_IronPlateReinforced_C")).toBe(true);

    await act(async () => api.settle[0]?.resolve());
    await waitFor(() => expect(graph.result.current.pendingItemIds.size).toBe(0));
  });
});
