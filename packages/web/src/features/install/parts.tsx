/**
 * Pieces first run and the Install page share: the editor's public key with
 * Copy and where to add it, a job's progress in plain words, and the backup
 * restore (upload → passphrase → the job).
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Job } from "@galley/core/types";
import type { DeployKeyInfo, RestoreUpload } from "@galley/core/install/types";
import { api, errorShape } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useMeta } from "@/lib/stores/meta";
import { Button, ErrorState, Field, Icon, Input, ProofMark, Spinner, buttonClass } from "@/ui";
import { copyText } from "@/features/deploy/parts";
import { codeHostName, keyPageFor } from "@/lib/hosted";
import { uploadBackup, useFollowJob } from "./transport";
import "./install.css";

/** The public half of the editor's key, ready to paste, with Copy. */
export function KeyBox({ info }: { info: DeployKeyInfo }) {
  return (
    <div className="install-key">
      <textarea className="install-key__text g-mono" readOnly rows={3} value={info.publicKey} aria-label="This editor’s public key" spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
      <div className="install-key__foot">
        <span className="install-key__print g-mono" title="The key’s fingerprint, as code hosts list it">
          {info.fingerprint}
        </span>
        <Button size="sm" variant="secondary" icon="copy" onClick={() => copyText(info.publicKey, "Key")}>
          Copy key
        </Button>
      </div>
    </div>
  );
}

/** Where and how to add the key: the code host's own page when it is known, and "allow write access". */
export function KeySteps({ info, repository }: { info: DeployKeyInfo; repository: string }) {
  const page = info.addUrl ?? (repository ? keyPageFor(repository) : null);
  const host = codeHostName(page ?? repository) ?? "the code host";
  return (
    <div className="install-keysteps">
      <ol className="install-keysteps__list">
        <li>{page ? `Open the repository’s key settings on ${host}.` : "On your code host, open the repository’s settings and find its keys."}</li>
        <li>Add a new key, and paste this one in.</li>
        <li>
          Tick <strong>Allow write access</strong>, then save. Without it the editor can read the site but can’t publish.
        </li>
      </ol>
      <KeyBox info={info} />
      {page ? (
        <a className={buttonClass("secondary", "sm")} href={page} target="_blank" rel="noopener noreferrer">
          <Icon name="external" />
          {`Open ${host === "the code host" ? "the key settings" : `${host}’s key settings`}`}
        </a>
      ) : null}
    </div>
  );
}

/** A running (or finished) job: its words, a bar, its own detail. */
export function JobProgress({ job, title }: { job: Job | null; title: string }) {
  const percent = job?.progress !== undefined ? Math.round(job.progress * 100) : null;
  return (
    <div className="install-progress" role="status" aria-live="polite">
      <p className="install-progress__title">
        <Spinner label="Working" />
        <span>{title}</span>
      </p>
      <div className="app-progress" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <span className={percent === null ? "app-progress__bar app-progress__bar--indeterminate" : "app-progress__bar"} style={percent === null ? undefined : { inlineSize: `${Math.max(4, percent)}%` }} />
      </div>
      <p className="install-progress__detail">{job?.detail ?? "Getting ready…"}</p>
    </div>
  );
}

/** A problem said in plain words beside the mark, for errors under a form. */
export function Problem({ children }: { children: string }) {
  return (
    <p className="g-error-text install-problem" role="alert">
      <ProofMark kind="bang" />
      <span>{children}</span>
    </p>
  );
}

type RestoreStage = { at: "file" } | { at: "passphrase"; upload: RestoreUpload; name: string } | { at: "working"; job: Job } | { at: "done" } | { at: "failed"; job: Job };

const META_POLL_MS = 1500;

/**
 * Restoring a backup: choose the file (it uploads at once), give the
 * passphrase it was sealed with, then follow the job. During first run the
 * setup code goes along (lib/api.ts); if the server can't tell this browser
 * about the job any more — it restarted into the restored state — the
 * install's own status says when it is back.
 */
export function RestoreFlow({ onDone, onBusy }: { onDone: () => void; onBusy?: (busy: boolean) => void }) {
  const [stage, setStage] = useState<RestoreStage>({ at: "file" });
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const job = useFollowJob(stage.at === "working" ? stage.job : null, () => setLost(true));

  useEffect(() => {
    onBusy?.(uploading || starting || stage.at === "working");
  }, [uploading, starting, stage.at, onBusy]);

  useEffect(() => {
    if (stage.at !== "working" || !job || job.state === "running") return;
    setStage(job.state === "done" ? { at: "done" } : { at: "failed", job });
  }, [job, stage.at]);

  // The server lost track of the job: it is back when it answers again, no longer mid-restore.
  useEffect(() => {
    if (!lost || stage.at !== "working") return;
    const timer = window.setInterval(() => {
      void useMeta
        .getState()
        .load()
        .then((meta) => {
          if (meta?.install && !meta.install.setupNeeded) setStage({ at: "done" });
        });
    }, META_POLL_MS);
    return () => window.clearInterval(timer);
  }, [lost, stage.at]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setUploading(true);
    try {
      const upload = await uploadBackup(file);
      setStage({ at: "passphrase", upload, name: file.name });
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (stage.at !== "passphrase") return;
    if (!passphrase) {
      setProblem("Enter the passphrase the backup was sealed with.");
      return;
    }
    setProblem(null);
    setStarting(true);
    try {
      const started = await api("POST /api/install/restore", { body: { upload: stage.upload.id, passphrase } });
      setPassphrase("");
      setStage(started.state === "error" ? { at: "failed", job: started } : { at: "working", job: started });
    } catch (caught) {
      setProblem(errorShape(caught).message);
    } finally {
      setStarting(false);
    }
  };

  if (stage.at === "working") return <JobProgress job={job} title="Putting the backup back…" />;
  if (stage.at === "done") {
    return (
      <div className="install-done" role="status">
        <p className="install-done__title">
          <ProofMark kind="reg" />
          <span>The backup is back in place.</span>
        </p>
        <p className="install-done__text">Sign in with the password of the editor the backup came from.</p>
        <div>
          <Button variant="primary" onClick={onDone} data-autofocus>
            Sign in
          </Button>
        </div>
      </div>
    );
  }
  if (stage.at === "failed") {
    return (
      <ErrorState
        compact
        title="Couldn’t restore the backup"
        message={stage.job.detail ?? "The backup couldn’t be put back."}
        detail={stage.job.output}
        retryLabel="Try another file"
        onRetry={() => setStage({ at: "file" })}
      />
    );
  }
  if (stage.at === "passphrase") {
    return (
      <form className="app-form-stack" onSubmit={(event) => void start(event)} noValidate>
        <p className="install-file" role="status">
          <Icon name="check" />
          <span>
            {stage.name} · {bytes(stage.upload.bytes)} uploaded
          </span>
        </p>
        <Field label="Passphrase" hint="The one the backup was sealed with. It can’t be recovered if it’s lost.">
          <Input type="password" autoComplete="off" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} data-autofocus autoFocus />
        </Field>
        {problem ? <Problem>{problem}</Problem> : null}
        <div className="install-actions">
          <Button type="button" variant="quiet" onClick={() => setStage({ at: "file" })}>
            Choose another file
          </Button>
          <span className="g-toolbar__spacer" />
          <Button type="submit" variant="danger" busy={starting} busyLabel="Starting…">
            Restore
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="app-form-stack">
      <Field label="Backup file" hint="A file downloaded from an editor’s Install page">
        <input ref={fileInput} className="install-file-input" type="file" disabled={uploading} onChange={(event) => void choose(event.target.files?.[0])} />
      </Field>
      {uploading ? (
        <p className="install-file" role="status">
          <Spinner label="Uploading" />
          <span>Uploading the backup…</span>
        </p>
      ) : null}
      {problem ? <Problem>{problem}</Problem> : null}
    </div>
  );
}
