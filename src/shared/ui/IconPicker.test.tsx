import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IconPicker } from "./IconPicker";

// IconPicker is a shared/ui branded primitive — it doesn't fetch game
// data itself, so these tests pass `nameById` straight in rather than
// mocking library queries. See useLibrary.test.tsx for the hook that
// builds this map from items + buildings.
const names = new Map([
  ["Desc_IronPlate_C", "Iron Plate"],
  ["Desc_IronIngot_C", "Iron Ingot"],
]);

describe("<IconPicker />", () => {
  it("finds an icon by its display name, not just its class name", async () => {
    // Regresses #61: searching "Iron Plate" returned "No icons match"
    // while the icon was visibly in the grid, because the search only
    // ever compared against the raw `Desc_IronPlate_C` class name.
    render(
      <IconPicker
        value={null}
        onChange={() => {}}
        pool={["Desc_IronPlate_C", "Desc_IronIngot_C"]}
        nameById={names}
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
    render(
      <IconPicker
        value={null}
        onChange={() => {}}
        pool={["Desc_IronPlate_C", "Desc_IronIngot_C"]}
        nameById={names}
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

  it("falls back to the raw id when the caller has no name for it", async () => {
    render(
      <IconPicker value={null} onChange={() => {}} pool={["BP_EquipmentDescriptorBeacon_C"]} />,
    );
    await waitFor(() => {
      expect(screen.getByTitle("BP_EquipmentDescriptorBeacon_C")).toBeInTheDocument();
    });
  });
});
