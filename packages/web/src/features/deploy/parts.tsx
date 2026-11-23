/**
 * Pieces every deploy surface shares: the live progress of a job in plain
 * words, the address shown big with Open and Copy, and a failed job explained.
 */
import { useState } from "react";
import type { Job } from "@galley/core/types";
import { notify } from "@/lib/stores/toasts";
import { Button, Icon, ProofMark, Spinner, buttonClass, cx } from "@/ui";
import { hostOf, jobFailureTitle, progressSteps, type SetupIntent } from "./logic";
import "./deploy.css";

export function copyText(text: string, what = "Address"): void {
  void navigator.clipboard?.writeText(text).then(
    () => notify({ tone: "success", title: `${what} copied` }),
    () => notify({ tone: "warning", title: "Couldn’t copy", body: "Select the address and copy it yourself." })
  );
}

/** "Building the site ✓ · Uploading 37 of 214 files… · Live" — the job's own words under three steps. */
export function DeployProgress({ job, intent }: { job: Job | null; intent: SetupIntent }) {
  const steps = progressSteps(job, intent);
  const percent = Math.round((job?.state === "done" ? 1 : (job?.progress ?? 0)) * 100);
  return (
    <div className="deploy-progress" role="status" aria-live="polite">
      <ol className="deploy-progress__steps">
        {steps.map((step) => (
          <li key={step.label} className={cx("deploy-progress__step", `deploy-progress__step--${step.state}`)}>
            {step.state === "done" ? <Icon name="check" /> : step.state === "current" ? <Spinner label={step.label} /> : <span className="deploy-progress__dot" aria-hidden="true" />}
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="deploy-progress__bar" aria-hidden="true">
        <span style={{ inlineSize: `${percent}%` }} />
      </div>
      <p className="deploy-progress__detail">{job?.detail && job.detail !== "Getting ready…" ? job.detail : "Getting ready…"}</p>
    </div>
  );
}

/** The address, big, with Open and Copy. */
export function AddressBlock({ url, caption }: { url: string; caption: string }) {
  return (
    <div className="deploy-address">
      <p className="g-eyebrow">{caption}</p>
      <a className={cx("deploy-address__link", hostOf(url).length > 30 && "deploy-address__link--long")} href={url} target="_blank" rel="noopener noreferrer">
        {hostOf(url)}
      </a>
      <div className="deploy-address__actions">
        <a className={buttonClass("primary", "md")} href={url} target="_blank" rel="noopener noreferrer">
          <Icon name="external" />
          Open
        </a>
        <Button variant="secondary" icon="copy" onClick={() => copyText(url)}>
          Copy
        </Button>
      </div>
    </div>
  );
}

/** A failed deploy job: what happened, that the live site is safe, the readable tail behind Technical details. */
export function JobFailure({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="deploy-failure" role="alert">
      <ProofMark kind="bang" className="deploy-failure__mark" />
      <div>
        <h3 className="deploy-failure__title">{jobFailureTitle(job)}</h3>
        <p className="deploy-failure__body">{job.detail}</p>
        {job.output ? (
          <details className="app-details" open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
            <summary>Technical details</summary>
            <pre className="app-error__detail deploy-failure__output">{job.output}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
