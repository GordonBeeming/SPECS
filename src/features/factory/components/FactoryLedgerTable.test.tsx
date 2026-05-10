import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactoryLedgerTable } from "./FactoryLedgerTable";
import type { FactoryLedger } from "../types";

function ledgerWith(flows: FactoryLedger["flows"]): FactoryLedger {
  return { factoryId: "f1", flows, powerMw: 0 };
}

describe("<FactoryLedgerTable />", () => {
  it("renders the empty-state hint when there are no flows", () => {
    render(<FactoryLedgerTable ledger={ledgerWith([])} itemNames={new Map()} />);
    expect(screen.getByText(/No flows yet/i)).toBeInTheDocument();
  });

  it("paints surplus rows in success colour and deficits in danger colour", () => {
    const ledger = ledgerWith([
      {
        itemId: "Desc_IronOre_C",
        itemName: "Iron Ore",
        isFluid: false,
        producedPerMinute: 0,
        consumedPerMinute: 30,
        netPerMinute: -30,
      },
      {
        itemId: "Desc_IronPlate_C",
        itemName: "Iron Plate",
        isFluid: false,
        producedPerMinute: 20,
        consumedPerMinute: 0,
        netPerMinute: 20,
      },
      {
        itemId: "Desc_IronIngot_C",
        itemName: "Iron Ingot",
        isFluid: false,
        producedPerMinute: 30,
        consumedPerMinute: 30,
        netPerMinute: 0,
      },
    ]);
    render(<FactoryLedgerTable ledger={ledger} itemNames={new Map()} />);
    // Net cell texts include the formatted value with sign.
    const deficit = screen.getByText("-30.0");
    const surplus = screen.getByText("+20.0");
    const neutral = screen.getByText("0.0");
    expect(deficit.className).toMatch(/text-danger/);
    expect(surplus.className).toMatch(/text-success/);
    expect(neutral.className).toMatch(/text-fg-muted/);
  });

  it("falls back to the item id when no name is known", () => {
    const ledger = ledgerWith([
      {
        itemId: "Desc_Mystery_C",
        itemName: "",
        isFluid: false,
        producedPerMinute: 1,
        consumedPerMinute: 0,
        netPerMinute: 1,
      },
    ]);
    render(<FactoryLedgerTable ledger={ledger} itemNames={new Map()} />);
    expect(screen.getByText("Desc_Mystery_C")).toBeInTheDocument();
  });
});
