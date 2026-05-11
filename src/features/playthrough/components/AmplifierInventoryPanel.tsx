import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import {
  useAmplifierInventory,
  useSetAmplifierInventory,
} from "../hooks/usePlaythroughs";

interface AmplifierInventoryPanelProps {
  onClose: () => void;
}

/**
 * Per-playthrough Somersloop / power-shard supply tracker. Optional —
 * if the player leaves both at 0 the inventory check stays silent, so
 * factory rows can freely toggle amplification without nagging. As soon
 * as either field is non-zero, the consuming code can compare planned
 * usage against the supply and warn when it goes over.
 */
export function AmplifierInventoryPanel({ onClose }: AmplifierInventoryPanelProps) {
  const inventory = useAmplifierInventory();
  const setInv = useSetAmplifierInventory();

  const [somersloop, setSomersloop] = useState(0);
  const [shards, setShards] = useState(0);
  const [touched, setTouched] = useState(false);

  // Sync local state with the loaded inventory only on first arrival —
  // once the user edits a field, we don't want a background refetch to
  // wipe their in-progress edit.
  useEffect(() => {
    if (touched) return;
    if (inventory.data) {
      setSomersloop(inventory.data.somersloopQuantity);
      setShards(inventory.data.powerShardQuantity);
    }
  }, [inventory.data, touched]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setInv.mutate(
      {
        somersloopQuantity: Math.max(0, Math.floor(somersloop)),
        powerShardQuantity: Math.max(0, Math.floor(shards)),
      },
      {
        onSuccess: () => {
          setTouched(false);
          onClose();
        },
      },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Amplifier supply"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md"
        // Stop the backdrop click from also closing the modal when the
        // user clicks anywhere inside the card. The previous version
        // only stopped propagation on individual child elements
        // (header row, form) — clicks that landed on the card's
        // padding / spacing would still bubble up and dismiss the
        // dialog. One handler at the Card root covers every reachable
        // surface.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-fg">Amplifier supply</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Optional — tracks the Somersloops and Power Shards you've
              collected so factory rows can warn when planned usage
              exceeds supply. Leave both at 0 to suppress the warnings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted hover:bg-border hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          className="mt-4 grid gap-3"
        >
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">Somersloops</span>
            <input
              type="number"
              min={0}
              step={1}
              value={somersloop}
              onChange={(e) => {
                setSomersloop(Number(e.target.value));
                setTouched(true);
              }}
              className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">Power Shards</span>
            <input
              type="number"
              min={0}
              step={1}
              value={shards}
              onChange={(e) => {
                setShards(Number(e.target.value));
                setTouched(true);
              }}
              className="mt-1 h-9 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary tabular-nums"
            />
          </label>
          {setInv.isError && (
            <div role="alert" className="text-sm text-danger">
              {setInv.error instanceof Error
                ? setInv.error.message
                : String(setInv.error)}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={setInv.isPending}>
              {setInv.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
