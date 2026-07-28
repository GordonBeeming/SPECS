import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { IconPicker } from "./IconPicker";
import { libraryApi } from "@/features/library/api";
import type { Item } from "@/features/library/types";

afterEach(() => vi.restoreAllMocks());

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const items: Item[] = [
  { id: "Desc_IronPlate_C", name: "Iron Plate", category: "part", stackSize: 100, isFluid: false },
  { id: "Desc_IronIngot_C", name: "Iron Ingot", category: "ingot", stackSize: 100, isFluid: false },
];

describe("<IconPicker />", () => {
  it("finds an icon by its display name, not just its class name", async () => {
    // Regresses #61: searching "Iron Plate" returned "No icons match"
    // while the icon was visibly in the grid, because the search only
    // ever compared against the raw `Desc_IronPlate_C` class name.
    vi.spyOn(libraryApi, "items").mockResolvedValue(items);
    vi.spyOn(libraryApi, "buildings").mockResolvedValue([]);
    renderWithProviders(
      <IconPicker
        value={null}
        onChange={() => {}}
        pool={["Desc_IronPlate_C", "Desc_IronIngot_C"]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search icons/i), {
      target: { value: "Iron Plate" },
    });

    await waitFor(() => {
      expect(screen.getByTitle("Iron Plate")).toBeInTheDocument();
    });
    expect(screen.queryByTitle("Iron Ingot")).not.toBeInTheDocument();
    expect(screen.queryByText(/No icons match/i)).not.toBeInTheDocument();
  });

  it("still matches a pasted class name", async () => {
    vi.spyOn(libraryApi, "items").mockResolvedValue(items);
    vi.spyOn(libraryApi, "buildings").mockResolvedValue([]);
    renderWithProviders(
      <IconPicker
        value={null}
        onChange={() => {}}
        pool={["Desc_IronPlate_C", "Desc_IronIngot_C"]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search icons/i), {
      target: { value: "Desc_IronIngot_C" },
    });

    await waitFor(() => {
      expect(screen.getByTitle("Iron Ingot")).toBeInTheDocument();
    });
    expect(screen.queryByTitle("Iron Plate")).not.toBeInTheDocument();
  });

  it("falls back to the raw id when a bundled icon has no item/building record", async () => {
    vi.spyOn(libraryApi, "items").mockResolvedValue([]);
    vi.spyOn(libraryApi, "buildings").mockResolvedValue([]);
    renderWithProviders(
      <IconPicker value={null} onChange={() => {}} pool={["BP_EquipmentDescriptorBeacon_C"]} />,
    );
    await waitFor(() => {
      expect(screen.getByTitle("BP_EquipmentDescriptorBeacon_C")).toBeInTheDocument();
    });
  });
});
