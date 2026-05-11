import { AlertTriangle, Loader2 } from "lucide-react";
import { useHealth } from "../hooks/useHealth";

/**
 * Tiny core-status indicator for the header. A bright pill grabbed too
 * much attention next to the playthrough switcher; now it's a single
 * coloured dot with the version + Rust target as a hover tooltip. Errors
 * still surface loudly (the dot turns into a danger pill with a glyph)
 * because a broken Rust core is something the player should immediately
 * see, not learn from hovering.
 */
export function HealthBadge() {
  const { data, isPending, isError } = useHealth();

  if (isPending) {
    return (
      <span
        aria-label="Checking Rust core…"
        title="Checking Rust core…"
        className="inline-flex h-2.5 w-2.5 items-center justify-center"
      >
        <Loader2 className="h-2.5 w-2.5 animate-spin text-fg-muted" />
      </span>
    );
  }
  if (isError || !data?.ok) {
    return (
      <span
        role="alert"
        title="Rust core unreachable"
        className="inline-flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger"
      >
        <AlertTriangle className="h-3 w-3" />
        Core down
      </span>
    );
  }
  return (
    <span
      aria-label={`Rust core OK — v${data.appVersion} (${data.rustTarget})`}
      title={`Rust core OK — v${data.appVersion} (${data.rustTarget})`}
      className="inline-block h-2 w-2 rounded-full bg-success"
    />
  );
}
