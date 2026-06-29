import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { useCurrentPlaythrough } from "@/features/playthrough/hooks/usePlaythroughs";
import { useFactoryList } from "../../hooks/useFactories";
import { PlanDesignerView } from "./PlanDesignerView";

const closeThisWindow = () => {
  void getCurrentWebviewWindow().close();
};

/**
 * The whole UI of a popped-out window (label `plan-<factoryId>`): just the plan
 * designer, no sidebar or playthrough switcher. The backend is shared, so this
 * window sees the same active playthrough as the main one. If that factory
 * leaves the active playthrough — deleted, or the main window switched
 * playthroughs — we show a dead-end with a close button rather than a 404.
 */
export function PoppedFactoryWindow({ factoryId }: { factoryId: string }) {
  const current = useCurrentPlaythrough();
  const factories = useFactoryList();

  const ready = !!current.data && !!factories.data;
  const present = factories.data?.some((f) => f.id === factoryId) ?? false;

  if (ready && !present) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <Card className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-primary">Factory unavailable</h1>
          <p className="mt-2 text-sm text-fg-muted">
            This factory isn't in the active playthrough anymore — it may have been
            deleted, or the main window switched playthroughs. Close this window and
            pop it out again.
          </p>
          <div className="mt-4 flex justify-center">
            <Button onClick={closeThisWindow}>Close window</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <PlanDesignerView
        factoryId={factoryId}
        popped
        onBack={() => {}}
        onDeleted={closeThisWindow}
      />
    </div>
  );
}
