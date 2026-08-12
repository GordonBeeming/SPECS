import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { Generator, Item } from "@/features/library/types";
import { playthroughApi } from "@/features/playthrough/api";

import { AddPowerGenForm } from "./AddPowerGenForm";
import { powerApi } from "../api";

const coalGenerator: Generator = {
  id: "Build_GeneratorCoal_C",
  name: "Coal Generator",
  category: "burner",
  powerMw: 75,
  unlockTier: 3,
  fuels: [{ fuelItemId: "Desc_Coal_C", fuelPerMinute: 15 }],
};

const geothermal: Generator = {
  id: "Build_GeneratorGeoThermal_C",
  name: "Geothermal Generator",
  category: "geothermal",
  powerMw: 200,
  unlockTier: 5,
  fuels: [],
};

const itemsById = new Map<string, Item>([
  ["Desc_Coal_C", { id: "Desc_Coal_C", name: "Coal", category: "raw", stackSize: 100, isFluid: false }],
]);
const fuelTierById = new Map([["Desc_Coal_C", 0]]);

function renderForm(props: Partial<Parameters<typeof AddPowerGenForm>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  return render(
    wrap(
      <AddPowerGenForm
        factoryId="f1"
        unlockedGenerators={[coalGenerator]}
        itemsById={itemsById}
        fuelTierById={fuelTierById}
        tierCap={5}
        optionsLoading={false}
        {...props}
      />,
    ),
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: RegExp, text: string) {
  const combobox = await screen.findByRole("combobox", { name: label });
  await waitFor(() => expect(combobox).toBeEnabled());
  await user.click(combobox);
  await user.keyboard(text);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(combobox).toHaveValue(text));
}

beforeEach(() => {
  vi.spyOn(playthroughApi, "current").mockResolvedValue({
    id: "p",
    displayName: "Run",
    gameVersion: "1.1",
    createdAt: "2026-05-10T00:00:00Z",
    currentTier: 5,
    currentMilestoneProgress: 0,
  });
  vi.spyOn(powerApi, "add").mockResolvedValue({
    id: "g1",
    factoryId: "f1",
    generatorId: "Build_GeneratorCoal_C",
    fuelItemId: "Desc_Coal_C",
    count: 1,
    clockPct: 100,
    createdAt: "2026-05-10T00:00:00Z",
    updatedAt: "2026-05-10T00:00:00Z",
  });
});

afterEach(() => vi.restoreAllMocks());

describe("<AddPowerGenForm />", () => {
  it("leaves the count box empty while you retype instead of snapping it to 0", async () => {
    // `Number("")` is 0, so a cleared box used to jump to 0 mid-edit and
    // fight anyone selecting-all to type a new figure.
    renderForm();
    const count = screen.getByRole("spinbutton", { name: /count/i });
    fireEvent.change(count, { target: { value: "" } });
    expect(count).toHaveValue(null);

    fireEvent.change(count, { target: { value: "12" } });
    expect(count).toHaveValue(12);
  });

  it("says what's wrong rather than submitting an empty count", async () => {
    const user = userEvent.setup();
    renderForm();
    await pick(user, /^generator$/i, "Coal Generator");
    await pick(user, /^fuel$/i, "Coal");
    fireEvent.change(screen.getByRole("spinbutton", { name: /count/i }), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Count must be a whole number between 1 and 1,000/,
    );
    expect(powerApi.add).not.toHaveBeenCalled();
  });

  it("rejects a fractional count here rather than letting serde reject it over IPC", async () => {
    // `<input type="number">` holds "1.5" happily and the form is
    // noValidate, so this used to reach `count: i64` and come back as
    // "invalid type: floating point `1.5`, expected i64" — a serde
    // message shown to the player as a server error.
    const user = userEvent.setup();
    renderForm();
    await pick(user, /^generator$/i, "Coal Generator");
    await pick(user, /^fuel$/i, "Coal");
    fireEvent.change(screen.getByRole("spinbutton", { name: /count/i }), {
      target: { value: "1.5" },
    });
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Count must be a whole number between 1 and 1,000/,
    );
    expect(powerApi.add).not.toHaveBeenCalled();
  });

  it("still accepts a fractional clock, which the backend does take", async () => {
    // `clock_pct` is an f32 — 133.3% is a legitimate overclock, so the
    // integer rule above must not leak across to this field.
    const user = userEvent.setup();
    renderForm();
    await pick(user, /^generator$/i, "Coal Generator");
    await pick(user, /^fuel$/i, "Coal");
    fireEvent.change(screen.getByRole("spinbutton", { name: /clock/i }), {
      target: { value: "133.3" },
    });
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(powerApi.add).toHaveBeenCalledWith(expect.objectContaining({ clockPct: 133.3 })),
    );
  });

  it("clears a generator that drops out of reach instead of leaving a dead pick on screen", async () => {
    // Switching playthrough can strip the chosen generator from the
    // unlocked list. Keeping the id then reads as a populated field
    // whose fuel picker is empty and whose submit says "Pick a
    // generator" — three things disagreeing at once.
    const user = userEvent.setup();
    const { rerender } = renderForm();
    await pick(user, /^generator$/i, "Coal Generator");

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <AddPowerGenForm
          factoryId="f1"
          unlockedGenerators={[geothermal]}
          itemsById={itemsById}
          fuelTierById={fuelTierById}
          tierCap={5}
          optionsLoading={false}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /^generator$/i })).toHaveValue(""),
    );
  });

  it("holds both pickers shut until every list it builds from has landed", () => {
    // Includes the playthrough read, not just the catalogs: `tierCap`
    // falls back to 9 while it's in flight, so enabling early offers a
    // Tier 0 player every generator in the game.
    renderForm({ optionsLoading: true });
    expect(screen.getByPlaceholderText("Loading generators…")).toBeDisabled();
    expect(screen.getByPlaceholderText("Loading fuels…")).toBeDisabled();
  });

  it("lets a geothermal generator through with no fuel picked", async () => {
    const user = userEvent.setup();
    renderForm({ unlockedGenerators: [geothermal] });
    await pick(user, /^generator$/i, "Geothermal Generator");

    expect(screen.getByPlaceholderText("Burns nothing")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(powerApi.add).toHaveBeenCalledWith(
        expect.objectContaining({ generatorId: "Build_GeneratorGeoThermal_C", fuelItemId: "" }),
      ),
    );
  });

  it("tells the caller a row landed, so a screen that hides the form can", async () => {
    const onSubmitted = vi.fn();
    const user = userEvent.setup();
    renderForm({ onSubmitted });
    await pick(user, /^generator$/i, "Coal Generator");
    await pick(user, /^fuel$/i, "Coal");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });
});
