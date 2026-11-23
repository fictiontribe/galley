import type { PreviewState } from "@galley/core/types";
import { notify } from "@/lib/stores/toasts";
import { usePreview, usePreviewStatus } from "@/lib/stores/preview";
import { errorShape } from "@/lib/api";
import { Badge, Button, type BadgeTone } from "@/ui";

const STATE: Record<PreviewState, { label: string; tone: BadgeTone }> = {
  idle: { label: "Off", tone: "neutral" },
  stopped: { label: "Off", tone: "neutral" },
  installing: { label: "Preparing", tone: "accent" },
  starting: { label: "Starting", tone: "accent" },
  ready: { label: "Running", tone: "success" },
  error: { label: "Stopped", tone: "danger" },
};

/** The preview's state as a badge. */
export function PreviewBadge({ siteId }: { siteId: string }) {
  const state = usePreviewStatus(siteId)?.state ?? "idle";
  const { label, tone } = STATE[state];
  return <Badge tone={tone}>{`Preview ${label.toLowerCase()}`}</Badge>;
}

/** Start / Restart / Stop for a site's preview. */
export function PreviewActions({ siteId, size = "sm" }: { siteId: string; size?: "sm" | "md" }) {
  const status = usePreviewStatus(siteId);
  const pending = usePreview((s) => s.pending[siteId]);
  const run = usePreview((s) => s.run);
  const state = status?.state ?? "idle";
  const act = (action: "start" | "stop" | "restart") =>
    run(siteId, action).catch((error: unknown) =>
      notify({ tone: "danger", title: action === "stop" ? "Couldn’t stop the preview" : "Couldn’t start the preview", body: errorShape(error).message, detail: errorShape(error).detail }),
    );

  if (state === "ready" || state === "starting" || state === "installing") {
    return (
      <>
        <Button size={size} variant="secondary" icon="refresh" busy={pending === "restart"} busyLabel="Restarting" onClick={() => void act("restart")}>
          Restart
        </Button>
        <Button size={size} variant="quiet" icon="stop" busy={pending === "stop"} busyLabel="Stopping" onClick={() => void act("stop")}>
          Stop
        </Button>
      </>
    );
  }
  return (
    <Button size={size} variant="secondary" icon="play" busy={pending === "start"} busyLabel="Starting" onClick={() => void act(state === "error" ? "restart" : "start")}>
      {state === "error" ? "Restart preview" : "Start preview"}
    </Button>
  );
}
