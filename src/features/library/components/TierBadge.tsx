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
        <span
          aria-label={`Locked — requires Tier ${unlockTier}`}
          className="inline-flex items-center gap-0.5 rounded bg-warning/20 px-1 py-0.5 text-[10px] font-medium uppercase text-warning"
        >
          <Lock className="h-2.5 w-2.5" /> locked
        </span>
      )}
    </span>
  );
}
