import { Github, X } from "lucide-react";

import { Button } from "@/shared/ui/Button";

interface AboutModalProps {
  onClose: () => void;
}

/**
 * About panel. Surfaces version + credit lines players need to see if
 * they ever ask "where do these icons / numbers come from". Phase 11
 * brand polish + a place to put the Coffee Stain fan-content
 * acknowledgement once we ship game icons.
 */
export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-raised p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="about-title" className="text-lg font-semibold text-fg">
            About S.P.E.C.S
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

        <p className="text-sm text-fg-muted">
          <strong className="text-fg">Satisfactory Production Efficiency
          and Control System.</strong> Plan whole-playthrough factory networks
          with cross-factory logistics, milestone-aware unlock gating, alt
          recipes, and per-playthrough state.
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Version</dt>
            <dd className="text-fg tabular-nums">0.1.0 — early access</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">License</dt>
            <dd className="text-fg">MIT (see LICENSE)</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">Architecture</dt>
            <dd className="text-fg">Vertical Slice (see <code>docs/vsa/</code>)</dd>
          </div>
        </dl>

        <h3 className="mt-5 text-sm font-semibold text-fg">Credits</h3>
        <ul className="mt-2 space-y-2 text-xs text-fg-muted">
          <li>
            <strong className="text-fg">Game data & item names</strong> from
            community Satisfactory wikis. Bundled JSON is a Tier 0–2 fixture
            for now; the full 1.1 dataset lands in a later milestone.
          </li>
          <li>
            <strong className="text-fg">Icons</strong> from{" "}
            <a
              href="https://lucide.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Lucide
            </a>
            . Game-specific icons (Iron Plate, Constructor, etc.) will land
            in a future PR — credited under Coffee Stain Studios' fan-content
            policy when bundled.
          </li>
          <li>
            <strong className="text-fg">Built with</strong> Tauri 2,
            React 19, Rust, SQLite, TanStack Query, Tailwind v4, React Flow.
          </li>
          <li>
            <strong className="text-fg">Satisfactory</strong> is © Coffee
            Stain Studios. SPECS is an unofficial fan tool with no
            affiliation.
          </li>
        </ul>

        <div className="mt-5 flex justify-between gap-2">
          <a
            href="https://github.com/GordonBeeming/SPECS"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-fg-muted hover:bg-border hover:text-fg"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
