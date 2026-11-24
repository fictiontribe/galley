import type { PreviewStatus } from "@galley/core/types";
import { PreviewActions } from "@/components/PreviewControls";
import { errorShape } from "@/lib/api";
import { usePreview } from "@/lib/stores/preview";
import { notify } from "@/lib/stores/toasts";
import type { PageFailure } from "@/features/builder/usePageFailure";
import { Button, EmptyState, ErrorState, Spinner, buttonClass } from "@/ui";
import { SettingsLink } from "@/features/accounts/SettingsLink";

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
            <SettingsLink route="PUT /api/sites/:siteId/config" className={buttonClass("quiet", "sm")} to={`/sites/${siteId}/settings`} fallback={null}>
              Open site settings
            </SettingsLink>
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
          <SettingsLink route="PUT /api/sites/:siteId/config" className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/settings`}>
            Open site settings
          </SettingsLink>
        }
      />
    </div>
  );
}

/**
 * Over a proposed page that couldn't be drawn: what happened in plain words,
 * the framework's own line under Technical details, the way back when the
 * failure began with a change made here, and the site's error page itself
 * one click away (`onReveal`) for whoever wants the whole of it. Set calmly,
 * like the preview's other states: the person's work is safe. In Arrange
 * (`actions` false) the panel beside the page carries the words and the way
 * back, so this only names what happened.
 */
export function PageFailedState({ failure, onReveal, actions = true }: { failure: PageFailure; onReveal: () => void; actions?: boolean }) {
  return (
    <EmptyState
      compact
      mark="bang"
      title={failure.words.title}
      body={actions ? failure.words.body : undefined}
      actions={
        <>
          {actions && (failure.undo || failure.undoing) ? (
            <Button size="sm" variant="primary" onClick={failure.undo ?? undefined} disabled={failure.undoing}>
              {failure.undoing ? "Undoing…" : "Undo"}
            </Button>
          ) : null}
          {actions && failure.showForm ? (
            <Button size="sm" variant="secondary" onClick={failure.showForm}>
              Show the form
            </Button>
          ) : null}
          <Button size="sm" variant="quiet" onClick={onReveal}>
            Show the site’s error
          </Button>
        </>
      }
    >
      {failure.detail ? (
        <details className="app-details preview-log">
          <summary>Technical details</summary>
          <pre className="app-error__detail">{failure.detail}</pre>
        </details>
      ) : null}
    </EmptyState>
  );
}
