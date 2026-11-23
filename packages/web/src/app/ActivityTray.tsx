import { useNavigate } from "react-router-dom";
import type { Job } from "@galley/core/types";
import { useJobs } from "@/lib/stores/jobs";
import { Button, IconButton, ProofMark, Spinner } from "@/ui";

function JobRow({ job }: { job: Job }) {
  const navigate = useNavigate();
  const dismiss = useJobs((s) => s.dismiss);
  const percent = job.progress !== undefined ? Math.round(job.progress * 100) : null;
  return (
    <div className={`g-toast app-job app-job--${job.state}`} role="status" aria-live="polite">
      {job.state === "running" ? <Spinner label="Working" /> : <ProofMark kind={job.state === "done" ? "reg" : "bang"} />}
      <span className="g-toast__title">{job.label}</span>
      <div className="g-toast__actions">
        {job.state === "done" && job.siteId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              dismiss(job.id);
              // A made video waits on the Media screen to be saved.
              navigate(job.kind === "video" ? `/sites/${job.siteId}/media` : `/sites/${job.siteId}`);
            }}
          >
            {job.kind === "video" ? "See the video" : "Open site"}
          </Button>
        ) : null}
        {job.state !== "running" ? <IconButton icon="close" label="Dismiss" tooltip={false} onClick={() => dismiss(job.id)} /> : null}
      </div>
      <span className="g-toast__body">
        {job.detail ?? (job.state === "running" ? "Working…" : job.state === "done" ? "Finished." : "Stopped.")}
      </span>
      {job.state === "running" ? (
        <div
          className="app-progress g-toast__body"
          role="progressbar"
          aria-label={job.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <span className={percent === null ? "app-progress__bar app-progress__bar--indeterminate" : "app-progress__bar"} style={percent === null ? undefined : { inlineSize: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

/** Slim tray of long-running work (clone, create, install) above the toasts. */
export function ActivityTray() {
  const jobs = useJobs((s) => s.jobs);
  const dismissed = useJobs((s) => s.dismissed);
  const shown = useJobs((s) => s.shown);
  // A job whose own dialog or screen is open shows its progress there, not twice.
  const visible = jobs.filter((job) => !dismissed.includes(job.id) && !shown.includes(job.id) && (job.kind === "clone" || job.kind === "create" || job.kind === "install" || job.kind === "video"));
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((job) => (
        <JobRow key={job.id} job={job} />
      ))}
    </>
  );
}
