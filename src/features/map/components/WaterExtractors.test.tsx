import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WaterExtractorPopover } from "./WaterExtractors";
import type { WaterExtractorGroup } from "@/features/resources/types";

const group: WaterExtractorGroup = {
  id: "wg-1",
  worldX: 0,
  worldY: 0,
  count: 4,
  clockPct: 100,
  count2: null,
  clock2Pct: null,
  factoryId: null,
  notes: null,
  locked: false,
  outputIpm: 480,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

function renderPopover(overrides: Partial<Parameters<typeof WaterExtractorPopover>[0]> = {}) {
  return render(
    <WaterExtractorPopover
      group={group}
      factories={[]}
      pending={false}
      onSave={vi.fn()}
      onToggleLock={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe("<WaterExtractorPopover /> — factory binding", () => {
  it("is a combobox, not a native select — every option is reachable through it", async () => {
    const user = userEvent.setup();
    renderPopover({
      factories: [
        { id: "F1", name: "Aluminum Refinery", worldX: 0, worldY: 0 },
        { id: "F2", name: "Nuclear Plant", worldX: 0, worldY: 0 },
      ],
    });
    const combobox = screen.getByRole("combobox", { name: /feeds factory/i });
    expect(combobox.tagName).toBe("INPUT");
    await user.click(combobox);
    expect(await screen.findByRole("option", { name: /Aluminum Refinery/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Nuclear Plant/ })).toBeInTheDocument();
  });

  it("orders the factory picker nearest-first and states the distance", async () => {
    const user = userEvent.setup();
    renderPopover({
      factories: [
        // 3-4-5 triangle scaled into world cm, from the group's own
        // (0, 0) drop point — 500m and 5m respectively.
        { id: "far", name: "Nuclear Plant", worldX: 30000, worldY: 40000 },
        { id: "near", name: "Aluminum Refinery", worldX: 300, worldY: 400 },
      ],
    });
    await user.click(screen.getByRole("combobox", { name: /feeds factory/i }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Aluminum Refinery"),
      expect.stringContaining("Nuclear Plant"),
    ]);
    expect(options[0].textContent).toContain("5 m");
  });

  it("selecting an option saves that factory id — the whole gesture a native select couldn't be driven through", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderPopover({
      factories: [{ id: "F1", name: "Aluminum Refinery", worldX: 300, worldY: 400 }],
      onSave,
    });
    await user.click(screen.getByRole("combobox", { name: /feeds factory/i }));
    await user.click(await screen.findByRole("option", { name: /Aluminum Refinery/ }));
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ factoryId: "F1" }),
    );
  });
});
