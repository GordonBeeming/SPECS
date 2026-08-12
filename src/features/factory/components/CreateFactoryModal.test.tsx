import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CreateFactoryModal } from "./CreateFactoryModal";
import { factoryApi } from "../api";

beforeEach(() => {
  vi.spyOn(factoryApi, "create").mockResolvedValue({
    id: "f1",
    name: "Iron Plant",
    worldX: 0,
    worldY: 0,
    createdAt: "2026-05-10T00:00:00Z",
    updatedAt: "2026-05-10T00:00:00Z",
    machineCount: 0,
  });
  vi.spyOn(factoryApi, "setPosition").mockResolvedValue({
    id: "f1",
    name: "Iron Plant",
    worldX: 12345,
    worldY: -6789,
    createdAt: "2026-05-10T00:00:00Z",
    updatedAt: "2026-05-10T00:00:00Z",
    machineCount: 0,
  });
});

afterEach(() => vi.restoreAllMocks());

function renderWithProviders(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("<CreateFactoryModal />", () => {
  it("rejects an empty name without calling the API", async () => {
    const onClose = vi.fn();
    renderWithProviders(<CreateFactoryModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/name is required/i);
    });
    expect(factoryApi.create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("creates and reports the new factory id on success", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderWithProviders(<CreateFactoryModal onClose={onClose} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Iron Plant" } });
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: "Tier 0 ingots" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(factoryApi.create).toHaveBeenCalledWith({
        name: "Iron Plant",
        notes: "Tier 0 ingots",
      });
      // No coordinates typed — stays unplaced, same as before this field
      // existed. A position write here would be a silent (0, 0) default.
      expect(factoryApi.setPosition).not.toHaveBeenCalled();
      expect(onCreated).toHaveBeenCalledWith("f1");
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("places the new factory where the position fields say, instead of stacking it at (0, 0)", async () => {
    // #59: every factory created from this list landed on the same
    // coordinate and overlapped illegibly on the map.
    const onCreated = vi.fn();
    renderWithProviders(<CreateFactoryModal onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Iron Plant" } });
    fireEvent.change(screen.getByLabelText(/east or west, in kilometres/i), {
      target: { value: "1.9" },
    });
    fireEvent.change(screen.getByLabelText(/north or south, in kilometres/i), {
      target: { value: "1.2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      // W and N are the field defaults, so both figures come through
      // negative — the same signs the map reads back as "1.9km W".
      expect(factoryApi.setPosition).toHaveBeenCalledWith({
        id: "f1",
        worldX: -190000,
        worldY: -120000,
      });
      expect(onCreated).toHaveBeenCalledWith("f1");
    });
  });

  it("flips the sign with the compass selects rather than asking for a negative distance", async () => {
    renderWithProviders(<CreateFactoryModal onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Iron Plant" } });
    fireEvent.change(screen.getByLabelText(/east or west, in kilometres/i), {
      target: { value: "2.5" },
    });
    fireEvent.change(screen.getByLabelText("East or west"), { target: { value: "E" } });
    fireEvent.change(screen.getByLabelText(/north or south, in kilometres/i), {
      target: { value: "1.3" },
    });
    fireEvent.change(screen.getByLabelText("North or south"), { target: { value: "S" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(factoryApi.setPosition).toHaveBeenCalledWith({
        id: "f1",
        worldX: 250000,
        worldY: 130000,
      });
    });
  });

  it("echoes the typed position back in the coordinate language the map uses", () => {
    renderWithProviders(<CreateFactoryModal onClose={vi.fn()} />);
    // Without this the fields had no relation to the `1.9km W · 1.2km N`
    // every other screen prints, so there was no way to tell whether a
    // typed pair meant the place you had in mind.
    expect(screen.getByText(/example: 1\.9 km W, 1\.2 km N/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/east or west, in kilometres/i), {
      target: { value: "1.9" },
    });
    fireEvent.change(screen.getByLabelText(/north or south, in kilometres/i), {
      target: { value: "1.2" },
    });
    expect(screen.getByText("Lands at 1.9km W · 1.2km N")).toBeInTheDocument();
  });

  it("rejects a half-filled position instead of silently placing it at (0, y)", async () => {
    renderWithProviders(<CreateFactoryModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Iron Plant" } });
    fireEvent.change(screen.getByLabelText(/east or west, in kilometres/i), {
      target: { value: "1.9" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/distance in both directions/i);
    });
    expect(factoryApi.create).not.toHaveBeenCalled();
  });

  it("closes the icon picker on Escape first, then the modal on a second Escape", () => {
    // Regresses: Escape did nothing at all here, while every other
    // modal in the app closes on it. The picker is a nested layer, so
    // it should unwind before the modal itself does.
    const onClose = vi.fn();
    renderWithProviders(<CreateFactoryModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /pick an icon/i }));
    expect(screen.getByPlaceholderText(/search icons/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/search icons/i)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps Create/Cancel outside the icon picker's scroll region", () => {
    // Regresses: the whole dialog body scrolled as one block, so
    // expanding the icon grid pushed Create/Cancel below the fold with
    // no way to reach them short of scrolling past the grid.
    renderWithProviders(<CreateFactoryModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /pick an icon/i }));

    const createButton = screen.getByRole("button", { name: /^create$/i });
    const scrollRegion = screen.getByPlaceholderText(/search icons/i).closest(".overflow-y-auto");
    expect(scrollRegion).not.toBeNull();
    expect(scrollRegion?.contains(createButton)).toBe(false);
  });
});
