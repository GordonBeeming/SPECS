import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { MachineNodeCard } from "./MachineNode";
import { libraryApi } from "@/features/library/api";
import { playthroughApi } from "@/features/playthrough/api";
import { factoryApi } from "../api";
import { useUpdateMachine } from "../hooks/useFactories";
import { useUndoStore } from "@/shared/undo/store";
import type { FactoryMachine } from "../types";

const recipes = [
  {
    id: "Recipe_IngotIron_C",
    name: "Iron Ingot",
    buildingId: "Desc_SmelterMk1_C",
    isAlt: false,
    unlockTier: 0,
    cycleSeconds: 2,
    inputs: [{ itemId: "Desc_OreIron_C", perMinute: 30 }],
    outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 30 }],
  },
  {
    id: "Recipe_PureIronIngot_C",
    name: "Pure Iron Ingot",
    buildingId: "Desc_SmelterMk1_C",
    isAlt: true,
    unlockTier: 0,
    cycleSeconds: 12,
    inputs: [
      { itemId: "Desc_OreIron_C", perMinute: 35 },
      { itemId: "Desc_Water_C", perMinute: 20 },
    ],
    outputs: [{ itemId: "Desc_IronIngot_C", perMinute: 65 }],
  },
  {
    // A recipe that runs in a different building — must NOT appear in
    // the recipe dropdown for a Smelter machine.
    id: "Recipe_IronPlate_C",
    name: "Iron Plate",
    buildingId: "Desc_ConstructorMk1_C",
    isAlt: false,
    unlockTier: 0,
    cycleSeconds: 6,
    inputs: [{ itemId: "Desc_IronIngot_C", perMinute: 30 }],
    outputs: [{ itemId: "Desc_IronPlate_C", perMinute: 20 }],
  },
];

const machine: FactoryMachine = {
  id: "m1",
  factoryId: "f1",
  buildingId: "Desc_SmelterMk1_C",
  recipeId: "Recipe_IngotIron_C",
  count: 2,
  clockPct: 75,
  useSomersloop: false,
  somersloopSlotsFilled: 0,
  powerShardCount: 0,
  createdAt: "2026-05-21T00:00:00Z",
  updatedAt: "2026-05-21T00:00:00Z",
};

beforeEach(() => {
  vi.spyOn(libraryApi, "recipes").mockResolvedValue(recipes);
  vi.spyOn(libraryApi, "buildings").mockResolvedValue([]);
  vi.spyOn(libraryApi, "items").mockResolvedValue([]);
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p", displayName: "Run", gameVersion: "1.1",
    createdAt: "2026-05-21T00:00:00Z", currentTier: 9, currentMilestoneProgress: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("<MachineNodeCard /> — non-editing", () => {
  it("renders count + clock + a dash for amp when none is configured", () => {
    renderWithProviders(
      <MachineNodeCard
        machine={machine}
        buildingName="Smelter"
        recipeName="Iron Ingot"
        editing={false}
        onEdit={() => {}}
        onCancelEdit={() => {}}
        onRemove={() => {}}
        onUpdate={() => {}}
        updating={false}
      />,
    );
    expect(screen.getByText("Iron Ingot")).toBeInTheDocument();
    expect(screen.getByText("Smelter")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("invokes onEdit when the pencil is clicked", async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <MachineNodeCard
        machine={machine}
        buildingName="Smelter"
        recipeName="Iron Ingot"
        editing={false}
        onEdit={onEdit}
        onCancelEdit={() => {}}
        onRemove={() => {}}
        onUpdate={() => {}}
        updating={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Edit machine/i }));
    expect(onEdit).toHaveBeenCalled();
  });
});

describe("<MachineNodeCard /> — inline editor", () => {
  it("only offers recipes that run in the same building", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <MachineNodeCard
        machine={machine}
        buildingName="Smelter"
        recipeName="Iron Ingot"
        editing={true}
        onEdit={() => {}}
        onCancelEdit={() => {}}
        onRemove={() => {}}
        onUpdate={() => {}}
        updating={false}
      />,
    );
    const combobox = await screen.findByRole("combobox", { name: /Recipe for/i });
    await user.click(combobox);
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      // Smelter recipes appear; anchored prefixes disambiguate
      // "Iron Ingot" from "Pure Iron Ingot (alt)". The option's
      // accessible name now also carries the IO-strip rates, so an
      // exact-match `$` anchor would never hit.
      expect(
        screen.getByRole("option", { name: /^Iron Ingot\b/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: /^Pure Iron Ingot \(alt\)/ }),
      ).toBeInTheDocument();
      // Constructor recipe must NOT appear.
      expect(screen.queryByRole("option", { name: /Iron Plate/i })).toBeNull();
    });
  });

  it("calls onUpdate with the new clock when Save is clicked", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <MachineNodeCard
        machine={machine}
        buildingName="Smelter"
        recipeName="Iron Ingot"
        editing={true}
        onEdit={() => {}}
        onCancelEdit={() => {}}
        onRemove={() => {}}
        onUpdate={onUpdate}
        updating={false}
      />,
    );
    const clockField = screen.getByLabelText(/Clock percent input/i);
    await user.clear(clockField);
    await user.type(clockField, "90");
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "m1",
          clockPct: 90,
          // Recipe wasn't changed → recipeId stays undefined to take the
          // cheap update_machine path on the backend.
          recipeId: undefined,
        }),
      );
    });
  });

  it("sends the new recipeId when the user picks a different recipe in the same building", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <MachineNodeCard
        machine={machine}
        buildingName="Smelter"
        recipeName="Iron Ingot"
        editing={true}
        onEdit={() => {}}
        onCancelEdit={() => {}}
        onRemove={() => {}}
        onUpdate={onUpdate}
        updating={false}
      />,
    );
    const combobox = await screen.findByRole("combobox", { name: /Recipe for/i });
    await user.click(combobox);
    await user.keyboard("{ArrowDown}");
    await user.click(await screen.findByRole("option", { name: /Pure Iron Ingot/i }));
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          recipeId: "Recipe_PureIronIngot_C",
          buildingId: "Desc_SmelterMk1_C",
        }),
      );
    });
  });

  it("undoable inline edit reverses to the previous clock + count via useUpdateMachine", async () => {
    // Wire a real useUpdateMachine call by spying on factoryApi.update.
    const updateSpy = vi
      .spyOn(factoryApi, "updateMachine")
      .mockResolvedValue();
    vi.spyOn(factoryApi, "detail").mockResolvedValue({
      factory: {
        id: "f1", name: "Test", worldX: 0, worldY: 0,
        createdAt: "x", updatedAt: "x", machineCount: 1,
      },
      machines: [machine],
      ledger: { factoryId: "f1", flows: [], powerMw: 0 },
    });
    useUndoStore.getState().reset();

    // Use a thin wrapper so the inline editor actually pipes through
    // useUpdateMachine (the way FactoryGraphView wires it).
    function Wrap() {
      const update = useUpdateMachine("f1");
      return (
        <MachineNodeCard
          machine={machine}
          buildingName="Smelter"
          recipeName="Iron Ingot"
          editing={true}
          onEdit={() => {}}
          onCancelEdit={() => {}}
          onRemove={() => {}}
          onUpdate={(patch) => update.mutate(patch)}
          updating={update.isPending}
        />
      );
    }
    const user = userEvent.setup();
    renderWithProviders(<Wrap />);
    const clockField = screen.getByLabelText(/Clock percent input/i);
    await user.clear(clockField);
    await user.type(clockField, "90");
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "m1", clockPct: 90 }),
      );
      expect(useUndoStore.getState().past.length).toBe(1);
    });
    // Reverse — the undo restores the original 75% clock + 2 count.
    await useUndoStore.getState().undo();
    await waitFor(() => {
      expect(updateSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "m1", clockPct: 75, count: 2 }),
      );
    });
  });

  it("rejects a clock above the power-shard cap without calling onUpdate", async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <MachineNodeCard
        machine={machine}
        buildingName="Smelter"
        recipeName="Iron Ingot"
        editing={true}
        onEdit={() => {}}
        onCancelEdit={() => {}}
        onRemove={() => {}}
        onUpdate={onUpdate}
        updating={false}
      />,
    );
    // No shards → cap stays at 100%. Bump clock to 200 → error.
    const clockField = screen.getByLabelText(/Clock percent input/i);
    await user.clear(clockField);
    await user.type(clockField, "200");
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/only allow clocks up to 100/i);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
