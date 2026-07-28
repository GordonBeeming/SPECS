import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { libraryApi } from "../api";
import { useIconDisplayNames } from "./useLibrary";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useIconDisplayNames", () => {
  it("combines items and buildings into one id → name lookup", async () => {
    vi.spyOn(libraryApi, "items").mockResolvedValue([
      { id: "Desc_IronPlate_C", name: "Iron Plate", category: "part", stackSize: 100, isFluid: false },
    ]);
    vi.spyOn(libraryApi, "buildings").mockResolvedValue([
      {
        id: "Build_SmelterMk1_C",
        name: "Smelter",
        category: "smelting",
        powerMw: 4,
        unlockTier: 0,
      },
    ]);

    const { result } = renderHook(() => useIconDisplayNames(), { wrapper });

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get("Desc_IronPlate_C")).toBe("Iron Plate");
    expect(result.current.get("Build_SmelterMk1_C")).toBe("Smelter");
  });
});
