/**
 * "Share a preview link" (Proof): the site exactly as it is here, pending
 * changes included, at an address of its own — to send to a colleague before
 * publishing. Says plainly that the link shows unpublished changes, and who
 * can open it and for how long, per the host's docs.
 */
import { useEffect, useState } from "react";
import { errorShape } from "@/lib/api";
import { count } from "@/lib/format";
import { usePendingCount } from "@/lib/stores/changes";
import { useJob, useShowingJob } from "@/lib/stores/jobs";
import { Button, Dialog, ErrorState, Field, Input } from "@/ui";
import { failureFor, targetName } from "./logic";
import { AddressBlock, DeployProgress, JobFailure } from "./parts";
import { startDeploy, useDeployStatus, useDeployTargets, useDeployUi } from "./useDeploy";

export function SharePreviewButton({ siteId }: { siteId: string }) {
  const status = useDeployStatus(siteId);
  const config = status.data?.config;
  if (status.data && config?.previewOnShare === false) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      icon="link"
      onClick={() => (config ? useDeployUi.getState().setShare(true) : useDeployUi.getState().openSetup("preview"))}
      disabled={!status.data}
    >
      Share a preview link
    </Button>
  );
}

export function SharePreviewDialog({ siteId }: { siteId: string }) {
  const open = useDeployUi((s) => s.share);
  const setShare = useDeployUi((s) => s.setShare);
  const pending = usePendingCount();
  const status = useDeployStatus(siteId);
  const targets = useDeployTargets();
  const [label, setLabel] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId);
  const config = status.data?.config;
  const target = targets.data?.find((candidate) => candidate.id === config?.target);
  const host = targetName(targets.data, config?.target);

  useShowingJob(jobId, open);
  useEffect(() => {
    if (!open) return;
    setJobId(null);
    setLabel("");
    setError(null);
  }, [open]);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      setJobId((await startDeploy(siteId, "preview", label.trim() || undefined)).id);
    } catch (caught) {
      setError(failureFor(errorShape(caught), host).body);
    } finally {
      setBusy(false);
    }
  };
  const close = () => setShare(false);
  const state = job?.state ?? null;

  const title = state === "done" ? "The preview link is ready" : state === "running" ? "Making a preview link…" : state === "error" ? "Couldn’t make the preview link" : "Share a preview link";
  const footer =
    state === "done" ? (
      <Button variant="primary" onClick={close} data-autofocus>
        Done
      </Button>
    ) : state === "running" ? (
      <Button variant="secondary" onClick={close}>
        Keep going in the background
      </Button>
    ) : (
      <>
        <Button variant="secondary" onClick={close} disabled={busy}>
          Not now
        </Button>
        <Button variant="primary" busy={busy} busyLabel="Starting…" onClick={() => void make()}>
          {state === "error" ? "Try again" : "Make preview link"}
        </Button>
      </>
    );

  return (
    <Dialog open={open} onClose={close} title={title} size="md" footer={footer} dismissible={!busy}>
      <div className="deploy-setup">
        {state === "running" ? (
          <DeployProgress job={job} intent="preview" />
        ) : state === "done" && job?.url ? (
          <>
            <AddressBlock url={job.url} caption="Preview link" />
            <p className="deploy-setup__note">
              <span>This link shows your unpublished changes. The live site stays as it is until you publish. {target?.previewNote}</span>
            </p>
          </>
        ) : (
          <>
            {state === "error" && job ? <JobFailure job={job} /> : null}
            <p className="deploy-setup__lede">
              Puts the site as it is here{pending > 0 ? ` — with your ${count(pending, "unpublished change")} —` : ""} at an address of its own on {host}, so someone can check it before you publish. The live site doesn’t change.
            </p>
            <p className="g-hint">{target?.previewNote}</p>
            <Field label="Note" hint="Optional. Who it’s for, or what to check — kept with the preview.">
              <Input value={label} maxLength={120} placeholder="For Sam: the new pricing section" onChange={(event) => setLabel(event.target.value)} data-autofocus />
            </Field>
            {error ? <ErrorState compact title="Couldn’t make the preview link" message={error} /> : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
