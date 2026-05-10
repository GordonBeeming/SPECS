import { Lock } from "lucide-react";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";

interface TierBadgeProps {
  unlockTier: number;
}

/**
 * Renders "Tier N" plus a lock pill when an active playthrough hasn't
 * reached that tier yet. With no active playthrough, plain text only.
 */
export function TierBadge({ unlockTier }: TierBadgeProps) {
  const { data: current } = useCurrentPlaythrough();
  const locked = current && current.currentTier < unlockTier;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className={locked ? "text-fg-muted" : ""}>Tier {unlockTier}</span>
      {locked && (
        // role="img" + aria-label gets a single, predictable announcement on
        // the lock pill (a bare span's aria-label is often skipped). Decorative
        // bits inside are aria-hidden so screen readers don't double-read.
        <span
          role="img"
          aria-label={`Locked — requires Tier ${unlockTier}`}
          className="inline-flex items-center gap-0.5 rounded bg-warning/20 px-1 py-0.5 text-[10px] font-medium uppercase text-warning"
        >
          <Lock className="h-2.5 w-2.5" aria-hidden="true" />
          <span aria-hidden="true">locked</span>
        </span>
      )}
    </span>
  );
}
