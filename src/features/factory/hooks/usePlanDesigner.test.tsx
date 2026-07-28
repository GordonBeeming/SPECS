import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { plannerApi } from "@/features/planner/api";
import type { FactoryPlan } from "@/features/planner/types";
import { playthroughApi } from "@/features/playthrough/api";
import { usePlanDesigner } from "./usePlanDesigner";

function emptyPlan(factoryId: string): FactoryPlan {
  return {
    factoryId,
    targets: [],
    includeSam: false,
    recipeOverrides: {},
    imports: [],
    layout: [],
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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
  vi.spyOn(plannerApi, "getPlan").mockResolvedValue(emptyPlan("fac-dest"));
});

afterEach(() => vi.restoreAllMocks());

describe("usePlanDesigner — addExternalSource dedup", () => {
  it("does not push a second row when the same (item, factory) source is added twice", async () => {
    const { result } = renderHook(() => usePlanDesigner("fac-dest"), { wrapper });
    await waitFor(() => expect(result.current.working).not.toBeNull());

    // Re-adding the same external source used to push a second identical
    // import row, which then materialized as a second logistics link on
    // save — this is the "duplicate Rotor link" bug.
    act(() => result.current.addExternalSource("Desc_Rotor_C", "fac-source", null));
    act(() => result.current.addExternalSource("Desc_Rotor_C", "fac-source", null));

    const rows = result.current.working?.imports.filter(
      (i) => i.itemId === "Desc_Rotor_C" && i.sourceFactoryId === "fac-source",
    );
    expect(rows).toHaveLength(1);
  });

  it("still allows stacking multiple unsourced 'future factory' placeholders for the same item", async () => {
    const { result } = renderHook(() => usePlanDesigner("fac-dest"), { wrapper });
    await waitFor(() => expect(result.current.working).not.toBeNull());

    // `sourceFactoryId === null` ("a future factory") has no identity to
    // dedup against — the player may genuinely want two separate
    // not-yet-built sources for the same item.
    act(() => result.current.addExternalSource("Desc_Rotor_C", null, null));
    act(() => result.current.addExternalSource("Desc_Rotor_C", null, null));

    const rows = result.current.working?.imports.filter(
      (i) => i.itemId === "Desc_Rotor_C" && i.sourceFactoryId === null,
    );
    expect(rows).toHaveLength(2);
  });
});
