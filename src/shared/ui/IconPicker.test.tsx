import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IconPicker } from "./IconPicker";

// IconPicker is a shared/ui branded primitive — it doesn't fetch game
// data itself, so these tests pass `nameById` straight in rather than
// mocking library queries. See useLibrary.test.tsx for the hook that
// builds this map from items + buildings.
const names = new Map([
  ["Desc_IronPlate_C", "Iron Plate"],
  ["Desc_IronPlateReinforced_C", "Reinforced Iron Plate"],
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
      expect(screen.getByText("Iron Plate")).toBeInTheDocument();
    });
    expect(screen.queryByText("Iron Ingot")).not.toBeInTheDocument();
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
      expect(screen.getByText("Iron Ingot")).toBeInTheDocument();
    });
    expect(screen.queryByText("Iron Plate")).not.toBeInTheDocument();
  });

  it("falls back to the raw id when the caller has no name for it", async () => {
    render(
      <IconPicker value={null} onChange={() => {}} pool={["BP_EquipmentDescriptorBeacon_C"]} />,
    );
    await waitFor(() => {
      expect(screen.getByText("BP_EquipmentDescriptorBeacon_C")).toBeInTheDocument();
    });
  });

  it("prints every result's name on screen, not only in a tooltip", async () => {
    // At 32px an Iron Plate and a Reinforced Iron Plate are the same
    // grey rectangle. A `title` was already there and didn't help —
    // it only pays out on hover, after you've picked where to point —
    // so this asserts the *visible* caption via getByText. Asserting
    // the accessible name instead would pass against the old
    // tooltip-only build and prove nothing.
    render(
      <IconPicker
        value={null}
        onChange={() => {}}
        pool={["Desc_IronPlate_C", "Desc_IronPlateReinforced_C"]}
        nameById={names}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search icons/i), {
      target: { value: "Iron Plate" },
    });

    await waitFor(() => {
      expect(screen.getByText("Iron Plate")).toBeVisible();
    });
    expect(screen.getByText("Reinforced Iron Plate")).toBeVisible();
  });

  it("conveys the picked tile with aria-checked, not just a coloured border", async () => {
    render(
      <IconPicker
        value="Desc_IronPlate_C"
        onChange={() => {}}
        pool={["Desc_IronPlate_C", "Desc_IronIngot_C"]}
        nameById={names}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Iron Plate" })).toBeChecked();
    });
    expect(screen.getByRole("radio", { name: "Iron Ingot" })).not.toBeChecked();
  });
});
