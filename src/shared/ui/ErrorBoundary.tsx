import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Copy, RefreshCw } from "lucide-react";

import { buildInfo, shortCommit } from "@/shared/build-info";

interface Props {
  children: ReactNode;
  /** Optional override for the boundary's title. */
  label?: string;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catch-all error boundary. A render-time crash anywhere below this
 * boundary used to blank the entire window (the user had no way to
 * tell what went wrong, no way to recover short of force-quitting);
 * this surfaces the error + stack + build info inline so the user
 * can copy it into a bug report and click "reload" to try again.
 *
 * Placed once around the whole AppShell. Individual slices can wrap
 * their own subtree with a second instance + a tighter label when
 * they want to keep a crash from taking down a sibling tab.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the stack visible in the devtools console too — the inline
    // panel below carries the user-facing copy, not the full trace.
    console.error("ErrorBoundary caught:", error, info);
    this.setState({ error, info });
  }

  reset = () => this.setState({ error: null, info: null });

  copy = () => {
    const { error, info } = this.state;
    if (!error) return;
    const text = [
      `SPECS error — ${this.props.label ?? "app"}`,
      `Build: ${buildInfo.branch}@${shortCommit}`,
      ``,
      `${error.name}: ${error.message}`,
      error.stack ?? "(no stack)",
      ``,
      info?.componentStack ?? "(no component stack)",
    ].join("\n");
    // navigator.clipboard is gated on a secure context — missing in some
    // Tauri webview configurations and on plain http: in dev. Fall back
    // to a hidden-textarea + execCommand path so the error UI never
    // crashes while reporting a crash.
    const writeViaApi = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    const promise = writeViaApi ? writeViaApi(text) : Promise.reject(new Error("no clipboard API"));
    promise.catch(() => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        // Last-ditch: leave the trace on screen; user can select + copy.
      }
    });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div
          role="alert"
          className="w-full max-w-2xl rounded-lg border border-danger/40 bg-bg-raised p-6 shadow-xl"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
            <div className="flex-1">
              <h2 className="text-base font-semibold text-fg">
                {this.props.label
                  ? `${this.props.label} crashed`
                  : "Something broke"}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                The UI hit a render error. Your data is fine — the app DB
                wasn't touched. Try reloading; if it happens again, copy
                the trace below and report it.
              </p>
            </div>
          </div>

          <pre className="mt-4 max-h-72 overflow-auto rounded-md border border-border bg-bg p-3 text-xs text-fg">
            <code>
              {error.name}: {error.message}
              {error.stack ? "\n\n" + error.stack : ""}
              {info?.componentStack
                ? "\n\nComponent stack:\n" + info.componentStack
                : ""}
            </code>
          </pre>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={this.copy}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-border hover:text-fg"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy details
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-border hover:text-fg"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload
            </button>
          </div>

          <div className="mt-3 text-right text-[10px] uppercase tracking-wide text-fg-muted">
            {buildInfo.branch}@{shortCommit}
          </div>
        </div>
      </div>
    );
  }
}
