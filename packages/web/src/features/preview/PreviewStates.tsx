import { Link } from "react-router-dom";
import type { PreviewStatus } from "@galley/core/types";
import { PreviewActions } from "@/components/PreviewControls";
import { errorShape } from "@/lib/api";
import { usePreview } from "@/lib/stores/preview";
import { notify } from "@/lib/stores/toasts";
import { EmptyState, ErrorState, Spinner, buttonClass } from "@/ui";

function LogTail({ log, open }: { log: string[]; open?: boolean }) {
  if (log.length === 0) return null;
  return (
    <details className="app-details preview-log" open={open}>
      <summary>What it’s doing</summary>
      <pre className="app-error__detail preview-log__lines" aria-live="off">
        {log.slice(-14).join("\n")}
      </pre>
    </details>
  );
}

/** The preview before it's running: preparing, starting, stopped, or stopped by a problem. */
export function PreviewStates({ siteId, status }: { siteId: string; status: PreviewStatus | null }) {
  const run = usePreview((s) => s.run);
  const state = status?.state ?? "idle";

  if (state === "error") {
    return (
      <div className="app-preview-state">
        <ErrorState
          compact
          title="The preview stopped"
          message={status?.detail ?? "The site’s own build reported a problem."}
          detail={status?.log.slice(-40).join("\n") || undefined}
          retryLabel="Restart preview"
          onRetry={() =>
            void run(siteId, "restart").catch((error: unknown) => notify({ tone: "danger", title: "Couldn’t restart the preview", body: errorShape(error).message, detail: errorShape(error).detail }))
          }
          actions={
            <Link className={buttonClass("quiet", "sm")} to={`/sites/${siteId}/settings`}>
              Open site settings
            </Link>
          }
        />
      </div>
    );
  }
  if (state === "installing" || state === "starting" || state === "idle") {
    const installing = state === "installing";
    return (
      <div className="app-preview-state" aria-busy="true">
        <EmptyState
          compact
          mark="reg"
          title={installing ? "Preparing the preview…" : "Starting the preview…"}
          body={status?.detail ?? (installing ? "Installing what the site needs. The first time can take a few minutes." : "The site’s own preview is starting. This can take a moment the first time.")}
          actions={<Spinner label={installing ? "Preparing the preview" : "Starting the preview"} />}
        >
          <LogTail log={status?.log ?? []} />
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="app-preview-state">
      <EmptyState compact mark="reg" title="The preview is off." body="Start it to see your pages as visitors will, with your changes." actions={<PreviewActions siteId={siteId} size="md" />} />
    </div>
  );
}

/** Live or side by side, with no deployed site to show. */
export function NoLiveSite({ siteId }: { siteId: string }) {
  return (
    <div className="app-preview-state">
      <EmptyState
        compact
        mark="transpose"
        title="No live site to compare with."
        body="Add the site’s staging or production address in its settings to see what visitors see now beside your changes."
        actions={
          <Link className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/settings`}>
            Open site settings
          </Link>
        }
      />
    </div>
  );
}
