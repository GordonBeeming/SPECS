import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { altsApi } from "@/features/alts/api";
import { libraryApi } from "@/features/library/api";
import { logisticsApi } from "@/features/logistics/api";
import { plannerApi } from "@/features/planner/api";
import { playthroughApi } from "@/features/playthrough/api";
import { powerApi } from "@/features/power/api";
import { useNavStore } from "@/shared/nav-store";

import { factoryApi } from "../../api";
import { PlanDesignerView } from "./PlanDesignerView";

// The popped-out variant registers a close handler on the real Tauri
// window so a debounced plan edit can't be lost — there's no window to
// reach for outside the app shell.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onCloseRequested: () => Promise.resolve(() => {}),
    destroy: () => Promise.resolve(),
  }),
}));

// A plan with no targets renders the first-product prompt instead of the
// React Flow canvas, which is what keeps this test in jsdom's reach —
// see `shared/testing/setup.ts` on why React Flow can't be asserted on
// here. The header and its side panels are plain DOM either way.
function renderPlan(props: Partial<{ popped: boolean }> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  return render(
    wrap(
      <PlanDesignerView
        factoryId="f1"
        onBack={vi.fn()}
        onDeleted={vi.fn()}
        popped={props.popped}
      />,
    ),
  );
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
  vi.spyOn(plannerApi, "getPlan").mockResolvedValue({
    factoryId: "f1",
    targets: [],
    includeSam: false,
    recipeOverrides: {},
    imports: [],
    layout: [],
  });
  vi.spyOn(plannerApi, "listItemTiers").mockResolvedValue([
    { itemId: "Desc_Coal_C", tier: 0, standardTier: 0 },
  ]);
  vi.spyOn(factoryApi, "detail").mockResolvedValue({
    factory: {
      id: "f1",
      name: "Iron Works",
      worldX: 0,
      worldY: 0,
      createdAt: "2026-05-10T00:00:00Z",
      updatedAt: "2026-05-10T00:00:00Z",
      machineCount: 6,
    },
    machines: [],
    ledger: { factoryId: "f1", flows: [], powerMw: 28 },
  });
  vi.spyOn(factoryApi, "list").mockResolvedValue([]);
  vi.spyOn(libraryApi, "items").mockResolvedValue([
    { id: "Desc_Coal_C", name: "Coal", category: "raw", stackSize: 100, isFluid: false },
  ]);
  vi.spyOn(libraryApi, "recipes").mockResolvedValue([]);
  vi.spyOn(libraryApi, "buildings").mockResolvedValue([]);
  vi.spyOn(libraryApi, "generators").mockResolvedValue([
    {
      id: "Build_GeneratorCoal_C",
      name: "Coal Generator",
      category: "burner",
      powerMw: 75,
      unlockTier: 3,
      fuels: [{ fuelItemId: "Desc_Coal_C", fuelPerMinute: 15 }],
    },
  ]);
  vi.spyOn(altsApi, "list").mockResolvedValue([]);
  vi.spyOn(logisticsApi, "list").mockResolvedValue([]);
  vi.spyOn(powerApi, "list").mockResolvedValue([]);
  vi.spyOn(powerApi, "balance").mockResolvedValue({
    factoryId: "f1",
    generatedMw: 0,
    consumedMw: 28,
    netMw: -28,
    fuelFlows: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useNavStore.setState({ pendingFactoryId: null });
});

describe("<PlanDesignerView /> — Add power", () => {
  it("opens the generator panel in place instead of navigating out of the factory", async () => {
    // Getting back from the app-level Power screen meant Map → find the
    // pin → double-click, or Factories → the row, once per factory
    // minimum. The draw is printed in this header, so the decision gets
    // made here.
    const user = userEvent.setup();
    renderPlan();
    const goTo = vi.spyOn(useNavStore.getState(), "goTo");

    await user.click(await screen.findByRole("button", { name: /add power/i }));

    expect(await screen.findByRole("combobox", { name: "Generator" })).toBeInTheDocument();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("shows the factory's own draw next to the generators that answer it", async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.click(await screen.findByRole("button", { name: /add power/i }));
    expect(await screen.findByText("28.0 MW")).toBeInTheDocument();
  });

  it("closes the panel on a second click of the same button", async () => {
    const user = userEvent.setup();
    renderPlan();
    const button = await screen.findByRole("button", { name: /add power/i });

    await user.click(button);
    expect(await screen.findByRole("combobox", { name: "Generator" })).toBeInTheDocument();

    await user.click(button);
    expect(screen.queryByRole("combobox", { name: "Generator" })).toBeNull();
  });

  it("reaches power from a popped-out factory window too, where there is no app nav at all", async () => {
    const user = userEvent.setup();
    renderPlan({ popped: true });
    await user.click(await screen.findByRole("button", { name: /add power/i }));

    expect(await screen.findByRole("combobox", { name: "Generator" })).toBeInTheDocument();
    // That window can't route to the app-level Power screen, so the
    // panel doesn't dangle a link into nowhere.
    expect(screen.queryByRole("button", { name: /every factory/i })).toBeNull();
  });

  it("keeps the whole-grid view one click away from the main window", async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.click(await screen.findByRole("button", { name: /add power/i }));
    expect(
      await screen.findByRole("button", { name: /every factory/i }),
    ).toBeInTheDocument();
  });

  it("treats the panel as a dialog: named, focused on open, and Escape leaves", async () => {
    // It's a floating overlay above the canvas, which is a dialog in
    // every way that matters to a keyboard user. Not `aria-modal` —
    // the graph behind it stays usable, which is the point of a side
    // panel rather than a modal.
    const user = userEvent.setup();
    renderPlan();
    await user.click(await screen.findByRole("button", { name: /add power/i }));

    const panel = await screen.findByRole("dialog", { name: "Power" });
    await waitFor(() => expect(panel).toHaveFocus());

    // Escape is dispatched to whatever holds focus and the handler
    // lives on the panel, so this also re-proves the focus move above.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Power" })).toBeNull());
  });

  it("hands focus back to the button that opened it, rather than dropping it on the body", async () => {
    // The focused element unmounts with the panel, so without a
    // deliberate hand-back focus falls to <body> and the next Tab
    // restarts from the top of the page. The map's node card already
    // keeps this contract for its markers.
    const user = userEvent.setup();
    renderPlan();
    const trigger = await screen.findByRole("button", { name: /add power/i });

    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Power" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it("returns focus to the trigger when the panel is closed by its own X", async () => {
    const user = userEvent.setup();
    renderPlan();
    const trigger = await screen.findByRole("button", { name: /add power/i });

    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Power" });
    await user.click(screen.getByRole("button", { name: /close panel/i }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("names the other left panels too, so the overlay always says what it is", async () => {
    const user = userEvent.setup();
    renderPlan();
    await user.click(await screen.findByRole("button", { name: /ledger/i }));
    expect(await screen.findByRole("dialog", { name: "Ledger" })).toBeInTheDocument();
  });
});

describe("<PlanDesignerView /> — Re-optimize", () => {
  /** A plan whose steps carry recipes, which is every saved plan: the
   * save records what the solver landed on, not only what the player
   * pinned by hand. */
  function planWithRecipes() {
    vi.spyOn(plannerApi, "getPlan").mockResolvedValue({
      factoryId: "f1",
      targets: [],
      includeSam: false,
      recipeOverrides: {
        Desc_IronScrew_C: "Recipe_Screw_C",
        Desc_IronRod_C: "Recipe_IronRod_C",
      },
      imports: [],
      layout: [],
    });
  }

  it("offers to re-solve against the tier rather than counting the player's pins", async () => {
    // The recipes on a saved plan are mostly the solver's own choices,
    // so a count of them describes nothing the player did. What decides
    // the outcome is the tier being solved against, and that's what the
    // control names.
    planWithRecipes();
    renderPlan();
    const button = await screen.findByRole("button", { name: /re-optimize/i });

    // The plan lands a tick after the header does, so the enabled state
    // is what has to settle, not the button's existence.
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute(
      "title",
      "Re-solve this factory against every recipe reachable at Tier 5",
    );
  });

  it("warns about what moves, not about losing pinned work", async () => {
    planWithRecipes();
    const user = userEvent.setup();
    renderPlan();
    await user.click(await screen.findByRole("button", { name: /re-optimize/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/reachable at Tier 5/);
    expect(dialog).toHaveTextContent(/imports or links may end up unsourced or unused/);
    expect(dialog).not.toHaveTextContent(/pinned/);
  });

  it("stays disabled while there's no plan to re-solve", async () => {
    // Positive control on the gate: the default mock's plan has no
    // recipes at all, which is the one state where the button has
    // nothing to act on.
    renderPlan();
    expect(await screen.findByRole("button", { name: /re-optimize/i })).toBeDisabled();
  });
});
