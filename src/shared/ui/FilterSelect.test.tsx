import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FilterSelect, type FilterOption } from "./FilterSelect";

const recipeOptions: FilterOption[] = [
  {
    value: "Recipe_Computer_C",
    label: "Computer",
    group: "Standard",
    iconId: "Desc_Computer_C",
    io: {
      inputs: [
        { itemId: "Desc_CircuitBoard_C", perMinute: 10 },
        { itemId: "Desc_Cable_C", perMinute: 20 },
        { itemId: "Desc_Plastic_C", perMinute: 40 },
      ],
      outputs: [{ itemId: "Desc_Computer_C", perMinute: 2.5 }],
    },
  },
  {
    value: "Recipe_Alternate_Computer_C",
    label: "Alternate: Caterium Computer",
    group: "Alternate",
    iconId: "Desc_Computer_C",
    io: {
      inputs: [
        { itemId: "Desc_CircuitBoard_C", perMinute: 15 },
        { itemId: "Desc_HighSpeedWire_C", perMinute: 52.5 },
      ],
      outputs: [{ itemId: "Desc_Computer_C", perMinute: 3.75 }],
    },
  },
];

describe("FilterSelect IO strip", () => {
  it("renders inputs → outputs with rates on recipe options", async () => {
    const user = userEvent.setup();
    render(
      <FilterSelect
        ariaLabel="Recipe"
        options={recipeOptions}
        value={null}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));

    const standard = await screen.findByRole("option", { name: /^Computer/ });
    // Whole rates drop the decimals; fractional rates keep their exact value.
    expect(standard).toHaveTextContent("10");
    expect(standard).toHaveTextContent("2.5/min");
    expect(standard).toHaveTextContent("→");

    const alt = screen.getByRole("option", { name: /Caterium Computer/ });
    expect(alt).toHaveTextContent("52.5");
    // Exact ratios matter in Satisfactory — 3.75 must not round to 3.8.
    expect(alt).toHaveTextContent("3.75/min");
  });

  it("keeps plain options single-line (no arrow, no rates)", async () => {
    const user = userEvent.setup();
    render(
      <FilterSelect
        ariaLabel="Item"
        options={[{ value: "Desc_IronIngot_C", label: "Iron Ingot" }]}
        value={null}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: /Iron Ingot/ });
    expect(option).not.toHaveTextContent("→");
    expect(option).not.toHaveTextContent("/min");
  });

  it("still selects through rich options", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterSelect
        ariaLabel="Recipe"
        options={recipeOptions}
        value="Recipe_Computer_C"
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Caterium Computer/ }));
    expect(onChange).toHaveBeenCalledWith("Recipe_Alternate_Computer_C");
  });
});
