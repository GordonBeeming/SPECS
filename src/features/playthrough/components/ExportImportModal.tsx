import { useState, type FormEvent } from "react";
import { Download, Upload, X } from "lucide-react";

import { Button } from "@/shared/ui/Button";

import {
  useCurrentPlaythrough,
  useExportPlaythrough,
  useImportPlaythrough,
} from "../hooks/usePlaythroughs";

interface ExportImportModalProps {
  onClose: () => void;
}

/**
 * Tiny modal for sharing playthroughs. v1 takes literal filesystem
 * paths because the Tauri file-picker plugin isn't wired up yet —
 * Phase 11 polish swaps the text input for a native dialog. The
 * Rust commands accept absolute paths only; relative paths resolve
 * against the working directory of the Tauri process which the user
 * doesn't control, so the placeholder text nudges them toward
 * absolute.
 */
export function ExportImportModal({ onClose }: ExportImportModalProps) {
  const playthrough = useCurrentPlaythrough();
  const exportMut = useExportPlaythrough();
  const importMut = useImportPlaythrough();

  const [exportPath, setExportPath] = useState("");
  const [importPath, setImportPath] = useState("");
  const [importName, setImportName] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const onExport = (e: FormEvent) => {
    e.preventDefault();
    const dest = exportPath.trim();
    if (!dest) return setExportError("Destination path is required.");
    if (!dest.endsWith(".specsdb")) return setExportError("Path must end in .specsdb.");
    setExportError(null);
    exportMut.mutate(dest, {
      onSuccess: (saved) => setExportResult(saved),
      onError: (err) =>
        setExportError(err instanceof Error ? err.message : String(err)),
    });
  };

  const onImport = (e: FormEvent) => {
    e.preventDefault();
    const src = importPath.trim();
    const name = importName.trim();
    if (!src) return setImportError("Source path is required.");
    if (!src.endsWith(".specsdb"))
      return setImportError("Source path must end in .specsdb.");
    if (!name) return setImportError("Display name is required.");
    setImportError(null);
    importMut.mutate(
      { sourcePath: src, displayName: name },
      {
        onSuccess: (summary) => setImportResult(summary.displayName),
        onError: (err) =>
          setImportError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-import-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-bg-raised p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="export-import-title" className="text-lg font-semibold text-fg">
            Share playthroughs
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

        <p className="mb-4 text-xs text-fg-muted">
          The Tauri file-picker isn't wired up yet — paths are absolute strings
          for now (e.g. <code>/Users/you/Desktop/iron-run.specsdb</code>).
          Phase 11 swaps these for a native dialog.
        </p>

        <section className="mb-6">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
            <Download className="h-4 w-4" /> Export current playthrough
          </h3>
          {playthrough.data ? (
            <form onSubmit={onExport} className="space-y-2">
              <input
                type="text"
                value={exportPath}
                onChange={(e) => setExportPath(e.target.value)}
                placeholder="/absolute/path/to/destination.specsdb"
                className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
              />
              <div className="flex justify-end gap-2">
                <Button type="submit" disabled={exportMut.isPending}>
                  {exportMut.isPending ? "Exporting…" : "Export"}
                </Button>
              </div>
              {exportError && (
                <p role="alert" className="text-sm text-danger">{exportError}</p>
              )}
              {exportResult && (
                <p role="status" className="text-sm text-success">
                  Exported to <code>{exportResult}</code>
                </p>
              )}
            </form>
          ) : (
            <p className="text-xs text-fg-muted">
              No active playthrough — open one from the switcher first.
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
            <Upload className="h-4 w-4" /> Import a playthrough
          </h3>
          <form onSubmit={onImport} className="space-y-2">
            <input
              type="text"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="/absolute/path/to/source.specsdb"
              className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
            />
            <input
              type="text"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="Display name (e.g. Friend's Iron Run)"
              maxLength={80}
              className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-fg outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={importMut.isPending}>
                {importMut.isPending ? "Importing…" : "Import"}
              </Button>
            </div>
            {importError && (
              <p role="alert" className="text-sm text-danger">{importError}</p>
            )}
            {importResult && (
              <p role="status" className="text-sm text-success">
                Imported as <code>{importResult}</code> — switch to it from the
                playthrough picker.
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
