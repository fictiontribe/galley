/**
 * The status bar's deploy line — "Live at example.workers.dev · updated
 * 3 min ago", "2 published versions not live yet · Put live" — plus the
 * site-wide deploy dialogs and the toasts that say how a deploy ended when no
 * dialog is showing it.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { errorShape } from "@/lib/api";
import { useServerEvent } from "@/lib/events";
import { notify } from "@/lib/stores/toasts";
import { useChrome } from "@/app/chrome";
import { useMay } from "@/lib/may";
import { ProofMark, Spinner } from "@/ui";
import { DeploySetupDialog } from "./DeploySetupDialog";
import { DomainDialog } from "./Domain";
import { failureFor, hostOf, jobFailureTitle, statusLine } from "./logic";
import { SharePreviewDialog } from "./SharePreview";
import { startDeploy, useDeployStatus, useDeployUi } from "./useDeploy";
import "./deploy.css";

/** Put the published version live from anywhere (status bar, Version history, Site home). Errors become a toast. */
export async function putLive(siteId: string): Promise<void> {
  try {
    await startDeploy(siteId, "production");
  } catch (caught) {
    const failure = failureFor(errorShape(caught));
    notify({ tone: "danger", title: failure.title, body: failure.body, detail: errorShape(caught).detail });
  }
}

function useFinishToasts(siteId: string) {
  useServerEvent("job", (event) => {
    const job = event.job;
    if ((job.kind !== "deploy" && job.kind !== "domain") || job.siteId !== siteId || job.state === "running") return;
    const ui = useDeployUi.getState();
    if (job.kind === "domain") {
      if (ui.domain) return;
      if (job.state === "done") notify({ tone: job.url ? "success" : "neutral", title: job.url ? `${hostOf(job.url)} answers` : "One DNS record to go", body: job.url ? "It’s the site’s live address now." : job.detail });
      else notify({ tone: "danger", title: "Couldn’t use that address", body: job.detail, detail: job.output });
      return;
    }
    // An open dialog (setup, share, or the Publish dialog's result) is already showing this job.
    if (ui.setup.open || ui.share || useChrome.getState().publishOpen) return;
    if (job.state === "done" && job.url) {
      const preview = job.label.startsWith("Making");
      notify({
        tone: "success",
        title: preview ? "Preview ready" : "Live",
        body: preview ? `The preview is at ${hostOf(job.url)}. It shows unpublished changes.` : `The published version is online at ${hostOf(job.url)}.`,
        action: { label: "Open", onClick: () => window.open(job.url, "_blank", "noopener") },
      });
    } else if (job.state === "error") {
      notify({ tone: "danger", title: jobFailureTitle(job), body: job.detail, detail: job.output });
    }
  });
}

export function DeployStatusItem({ siteId }: { siteId: string }) {
  const status = useDeployStatus(siteId);
  const statusNow = statusLine(status.data, status.job);
  const [starting, setStarting] = useState(false);
  const may = useMay();
  useFinishToasts(siteId);
  // Setting up where the site is hosted is an owner's; putting it live is a publish. Someone who can't sees the line without the button.
  const allowed = !statusNow.action || statusNow.action.kind === "details" || may(statusNow.action.kind === "setup" ? "PUT /api/sites/:siteId/deploy" : "POST /api/sites/:siteId/deploy");
  const line = allowed ? statusNow : { ...statusNow, action: null };

  const act = () => {
    if (!line.action) return;
    if (line.action.kind === "setup") useDeployUi.getState().openSetup();
    else if (line.action.kind === "details") notifyDetails();
    else {
      setStarting(true);
      void putLive(siteId).finally(() => setStarting(false));
    }
  };
  const notifyDetails = () => {
    const job = status.job;
    if (job) notify({ tone: "danger", title: jobFailureTitle(job), body: job.detail, detail: job.output });
  };

  return (
    <>
      {status.data || status.status !== "error" ? (
        <span className={`g-statusbar__item deploy-status deploy-status--${line.tone}`} title={line.href}>
          {line.tone === "busy" ? <Spinner label={line.text} /> : <ProofMark kind={line.tone === "danger" || line.tone === "warning" ? "bang" : line.tone === "success" ? "reg" : "stet"} className="app-status__mark" />}
          {line.href && line.tone === "success" ? (
            <a className="deploy-status__link" href={line.href} target="_blank" rel="noopener noreferrer">
              {line.text}
            </a>
          ) : (
            <span className="deploy-status__text">{line.text}</span>
          )}
          {line.action ? (
            <>
              <span aria-hidden="true">·</span>
              <button type="button" className="app-link-button app-status__action" disabled={starting} onClick={act}>
                {starting ? "Starting…" : line.action.label}
              </button>
            </>
          ) : null}
        </span>
      ) : null}
      {/* Out of the status bar: a native dialog inherits its parent's (mono, small) type. */}
      {createPortal(
        <>
          <DeploySetupDialog siteId={siteId} />
          <SharePreviewDialog siteId={siteId} />
          <DomainDialog siteId={siteId} />
        </>,
        document.body
      )}
    </>
  );
}
