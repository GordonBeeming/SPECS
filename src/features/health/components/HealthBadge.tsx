import { Activity, AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/shared/ui/Badge";
import { useHealth } from "../hooks/useHealth";

export function HealthBadge() {
  const { data, isPending, isError } = useHealth();

  if (isPending) {
    return (
      <Badge tone="neutral">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking core…
      </Badge>
    );
  }
  if (isError || !data?.ok) {
    return (
      <Badge tone="danger">
        <AlertTriangle className="h-3 w-3" /> Rust core unreachable
      </Badge>
    );
  }
  return (
    <Badge tone="success">
      <Activity className="h-3 w-3" /> v{data.appVersion} · {data.rustTarget}
    </Badge>
  );
}
