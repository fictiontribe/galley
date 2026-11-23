import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useJob, useJobs, useShowingJob } from "@/lib/stores/jobs";
import { Button, Dialog, ErrorState, Field, Input } from "@/ui";

export interface CloneDialogProps {
  open: boolean;
  onClose: () => void;
}

const LOOKS_LIKE_GIT = /^(https?:\/\/\S+|git@[^:\s]+:\S+|ssh:\/\/\S+)$/;

/** Clone a site from GitHub (or any git host): address + optional version → progress → open. */
export function CloneDialog({ open, onClose }: CloneDialogProps) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const job = useJob(jobId);
  useShowingJob(jobId, open);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setBranch("");
    setFieldError(null);
    setStartError(null);
    setJobId(null);
  }, [open]);

  useEffect(() => {
    if (job?.state === "done" && job.siteId) {
      useJobs.getState().dismiss(job.id);
      onClose();
      navigate(`/sites/${job.siteId}`);
    }
  }, [job, navigate, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = url.trim();
    if (!LOOKS_LIKE_GIT.test(address)) {
      setFieldError("That doesn’t look like a site address. Copy it from the green “Code” button on GitHub, for example https://github.com/you/site.git.");
      return;
    }
    setFieldError(null);
    setStartError(null);
    setStarting(true);
    try {
      const started = await api("POST /api/sites/clone", { body: { url: address, branch: branch.trim() || undefined } });
      useJobs.getState().upsert(started);
      setJobId(started.id);
    } catch (error) {
      setStartError(error);
    } finally {
      setStarting(false);
    }
  };

  const running = job?.state === "running";
  const percent = job?.progress !== undefined ? Math.round(job.progress * 100) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Clone a site"
      description="Copy a site from GitHub or another code host to this computer, then edit it here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {running ? "Keep working in the background" : "Cancel"}
          </Button>
          <Button variant="primary" type="submit" form="clone-form" busy={starting || running} busyLabel="Cloning" disabled={job?.state === "error"}>
            Clone site
          </Button>
        </>
      }
    >
      <form id="clone-form" className="app-form-stack" onSubmit={submit} noValidate>
        <Field label="Site address" error={fieldError ?? undefined} hint="The address you would use to clone it, https or ssh">
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/you/site.git" mono spellCheck={false} autoComplete="off" disabled={Boolean(job)} data-autofocus />
        </Field>
        <Field label="Which version (optional)" hint="Leave empty to edit the version the site publishes from">
          <Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="main" mono spellCheck={false} autoComplete="off" disabled={Boolean(job)} />
        </Field>
      </form>
      {job && running ? (
        <div className="app-job-inline" role="status">
          <span>{job.detail ?? "Cloning…"}</span>
          <div className="app-progress" role="progressbar" aria-label="Cloning" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
            <span className={percent === null ? "app-progress__bar app-progress__bar--indeterminate" : "app-progress__bar"} style={percent === null ? undefined : { inlineSize: `${percent}%` }} />
          </div>
        </div>
      ) : null}
      {job?.state === "error" ? <ErrorState compact title="Couldn’t clone the site" message="Nothing was copied. Check the address and that you have access to it." detail={job.detail} /> : null}
      {startError ? <ErrorState compact title="Couldn’t start cloning" error={startError} /> : null}
    </Dialog>
  );
}
