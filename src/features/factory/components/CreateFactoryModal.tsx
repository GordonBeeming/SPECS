import { useEffect, useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/Button";
import { Icon } from "@/shared/ui/Icon";
import { IconPicker } from "@/shared/ui/IconPicker";
import { useBuildings, useIconDisplayNames } from "@/features/library/hooks/useLibrary";
import {
  compassToWorld,
  coordChip,
  type EastWest,
  type NorthSouth,
} from "@/shared/format/coords";
import { queryKeys } from "@/shared/query/keys";
import { factoryApi } from "../api";
import { useCreateFactory } from "../hooks/useFactories";

interface CreateFactoryModalProps {
  onClose: () => void;
  onCreated?: (id: string) => void;
}

/** A world coordinate typed into the position fields, or the sentinel
 * meaning "leave it unplaced" (both fields blank — the schema default,
 * same as before this field existed). Anything else that doesn't parse
 * to two finite numbers is a validation error, not a silent 0. */
type PositionInput = { x: number; y: number } | "unset" | "invalid";

/**
 * Reads the two distance boxes against their compass selects. The
 * fields are kilometres because that's the only coordinate language
 * the app speaks on screen — the map pin, the resource rows and
 * Validate all print `1.9km W · 1.2km N`, so a raw Unreal-cm pair here
 * had nothing to compare itself against.
 */
function parsePosition(
  ewRaw: string,
  ew: EastWest,
  nsRaw: string,
  ns: NorthSouth,
): PositionInput {
  const e = ewRaw.trim();
  const n = nsRaw.trim();
  if (e === "" && n === "") return "unset";
  const ewKm = Number(e);
  const nsKm = Number(n);
  if (e === "" || n === "" || !Number.isFinite(ewKm) || !Number.isFinite(nsKm)) return "invalid";
  return compassToWorld({ ewKm, ew, nsKm, ns });
}

export function CreateFactoryModal({ onClose, onCreated }: CreateFactoryModalProps) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [iconId, setIconId] = useState<string | null>(null);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [ewKm, setEwKm] = useState("");
  const [ew, setEw] = useState<EastWest>("W");
  const [nsKm, setNsKm] = useState("");
  const [ns, setNs] = useState<NorthSouth>("N");
  const [validationError, setValidationError] = useState<string | null>(null);
  const create = useCreateFactory();
  const buildings = useBuildings();
  const iconNames = useIconDisplayNames();
  const queryClient = useQueryClient();

  // Default the suggested grid to all production building ids — those
  // are what a factory most naturally identifies with (Smelter, Refinery,
  // Manufacturer, …). Fall back to an empty list while buildings
  // are still loading so the picker doesn't flicker mid-render.
  const suggested = useMemo(
    () => (buildings.data ?? []).map((b) => b.id),
    [buildings.data],
  );

  // Parsed on every keystroke, not only on submit, so the preview under
  // the fields can echo the reading back in the app's own coordinate
  // language before the factory exists.
  const position = parsePosition(ewKm, ew, nsKm, ns);

  const validate = (n: string): string | null => {
    const t = n.trim();
    if (t.length === 0) return "Name is required.";
    if (t.length > 80) return "Name must be 80 characters or fewer.";
    return null;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const err = validate(name);
    if (err) {
      setValidationError(err);
      return;
    }
    if (position === "invalid") {
      setValidationError(
        "Position needs a distance in both directions, or leave both boxes blank.",
      );
      return;
    }
    setValidationError(null);
    create.mutate(
      {
        name: name.trim(),
        notes: notes.trim() || undefined,
        iconId: iconId ?? undefined,
      },
      {
        onSuccess: (factory) => {
          // Every factory created here used to default to (0, 0) with no
          // way to say otherwise, so a second factory landed stacked
          // exactly on top of the first. Leaving both fields blank still
          // means unplaced (unchanged from before) — this only runs when
          // the user actually typed coordinates.
          const placed =
            position === "unset"
              ? Promise.resolve()
              : factoryApi
                  .setPosition({ id: factory.id, worldX: position.x, worldY: position.y })
                  .then(() => {
                    queryClient.invalidateQueries({ queryKey: queryKeys.factory.list });
                    queryClient.invalidateQueries({ queryKey: queryKeys.factory.detail(factory.id) });
                  })
                  .catch((err: unknown) => {
                    // The factory itself was created — losing the position
                    // write only leaves it unplaced until dragged on the
                    // map, which isn't worth blocking the modal on, but it
                    // must not vanish silently either.
                    console.error("Couldn't set the new factory's position:", err);
                  });
          void placed.finally(() => {
            onCreated?.(factory.id);
            onClose();
          });
        },
      },
    );
  };

  const serverError = create.error instanceof Error ? create.error.message : null;

  // Escape closes the innermost open layer first — the icon picker, if
  // it's expanded — then the modal itself, matching how a nested popover
  // is expected to unwind rather than jumping straight out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showIconPicker) setShowIconPicker(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showIconPicker, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-factory-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-md max-h-[90vh] flex-col overflow-hidden rounded-lg border border-border bg-bg-raised shadow-xl">
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 id="create-factory-title" className="text-lg font-semibold text-fg">
            New factory
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The icon picker's grid can grow past the dialog's own height
            (max-h-[90vh]), so only this middle section scrolls — the
            header and the Create/Cancel footer stay put rather than
            scrolling out of view with it. */}
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
            <label className="block">
              <span className="text-sm font-medium text-fg">Name</span>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Iron Works, Mass Constructor 1, …"
                className="mt-1 h-10 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
                maxLength={80}
              />
            </label>

            <div>
              <span className="text-sm font-medium text-fg">Icon (optional)</span>
              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowIconPicker((v) => !v)}
                  className="flex h-12 w-12 items-center justify-center rounded-md border border-border bg-bg hover:border-primary"
                  aria-label="Pick an icon for this factory"
                >
                  {iconId ? (
                    <Icon itemId={iconId} alt="" className="h-9 w-9" />
                  ) : (
                    <span className="text-xs text-fg-muted">none</span>
                  )}
                </button>
                <p className="text-xs text-fg-muted">
                  {iconId
                    ? "Click to pick a different glyph."
                    : "Give this factory some character — pick from buildings, ingots, or any item."}
                </p>
              </div>
              {showIconPicker && (
                <div className="mt-3 rounded-md border border-border bg-bg p-3">
                  <IconPicker
                    value={iconId}
                    onChange={(next) => setIconId(next)}
                    suggested={suggested}
                    nameById={iconNames}
                  />
                </div>
              )}
            </div>

            <div>
              <span className="text-sm font-medium text-fg">Position on the map (optional)</span>
              <p className="mt-0.5 text-xs text-fg-muted">
                Distance from the map's centre, in kilometres — the same reading the map pin and
                the resource rows show. Leave both blank to place it later by dragging it on the
                map, otherwise every factory created from this list lands on the same spot and
                stacks under the last one.
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="number"
                    step="any"
                    value={ewKm}
                    onChange={(e) => setEwKm(e.target.value)}
                    placeholder="1.9"
                    aria-label="Distance east or west, in kilometres"
                    className="h-9 w-full min-w-0 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
                  />
                  <span className="shrink-0 text-xs text-fg-muted">km</span>
                  <select
                    value={ew}
                    onChange={(e) => setEw(e.target.value === "E" ? "E" : "W")}
                    aria-label="East or west"
                    className="h-9 shrink-0 rounded-md border border-border bg-bg px-1 text-sm text-fg outline-none focus:border-primary"
                  >
                    <option value="W">W</option>
                    <option value="E">E</option>
                  </select>
                </div>
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="number"
                    step="any"
                    value={nsKm}
                    onChange={(e) => setNsKm(e.target.value)}
                    placeholder="1.2"
                    aria-label="Distance north or south, in kilometres"
                    className="h-9 w-full min-w-0 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
                  />
                  <span className="shrink-0 text-xs text-fg-muted">km</span>
                  <select
                    value={ns}
                    onChange={(e) => setNs(e.target.value === "S" ? "S" : "N")}
                    aria-label="North or south"
                    className="h-9 shrink-0 rounded-md border border-border bg-bg px-1 text-sm text-fg outline-none focus:border-primary"
                  >
                    <option value="N">N</option>
                    <option value="S">S</option>
                  </select>
                </div>
              </div>
              {/* Echoing the typed pair back through the same formatter
                  the map uses is the whole point: it's the proof the two
                  screens are talking about the same place. */}
              <p className="mt-1 text-xs tabular-nums text-fg-muted">
                {position === "unset"
                  ? "Unplaced — example: 1.9 km W, 1.2 km N"
                  : position === "invalid"
                    ? "Fill in both boxes, or clear both to leave it unplaced."
                    : `Lands at ${coordChip(position.x, position.y)}`}
              </p>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-fg">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary"
                placeholder="What does this factory do? Where does it live in-game?"
              />
            </label>

            {validationError && (
              <p role="alert" className="text-sm text-danger">{validationError}</p>
            )}
            {serverError && !validationError && (
              <p role="alert" className="text-sm text-danger">{serverError}</p>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4 px-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
