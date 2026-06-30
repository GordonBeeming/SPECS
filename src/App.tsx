import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AppShell } from "@/app/AppShell";
import { PoppedFactoryWindow } from "@/features/factory/components/plan/PoppedFactoryWindow";
import { useCrossWindowSync } from "@/shared/tauri/useCrossWindowSync";

/**
 * Pop-out windows are created with the label `plan-<factoryId>` (see the Rust
 * `pop_out_factory` command). Reading the label tells this window which UI to
 * render: the focused plan editor for that factory, or the full app shell.
 */
function poppedFactoryId(): string | null {
  try {
    const label = getCurrentWebviewWindow().label;
    return label.startsWith("plan-") ? label.slice("plan-".length) : null;
  } catch {
    // Not running inside a Tauri window (e.g. a test renderer).
    return null;
  }
}

export default function App() {
  useCrossWindowSync();
  const factoryId = poppedFactoryId();
  if (factoryId) return <PoppedFactoryWindow factoryId={factoryId} />;
  return <AppShell />;
}
