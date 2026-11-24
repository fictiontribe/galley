/**
 * "Remove the hosted editor": first exactly what would be deleted, by where
 * each thing lives, what is left alone and why, what stays, and the warning
 * about unpublished changes there — then the editor's address typed to say
 * yes, then the job, and what it took.
 */
import { useEffect, useRef, useState } from "react";
import type { HostedEditorRemoval } from "@galley/core/hosting/types";
import type { Job } from "@galley/core/types";
import { useFollowJob } from "@/features/install/transport";
import { api } from "@/lib/api";
import { invalidate } from "@/lib/query";
import { useShowingJob } from "@/lib/stores/jobs";
import { keys } from "@/lib/sync";
import { Button, Dialog, ErrorState, Field, Icon, Input, ProofMark, Skeleton, buttonClass } from "@/ui";
import { removalConfirmed, removedLine, type KnownNames } from "./logic";
import { EditorJobFailure, EditorProgress, ResourceRow, ResourceSections } from "./parts";
import { removeEditor } from "./useHosting";

/**
 * The names of the accounts and places the record keeps only by id, asked of
 * the host the way the guided flow asks (it creates nothing). Without them —
 * no key any more, the host not answering — the rows show the ids, which are
 * still true.
 */
function useKnownNames(hostId: string, open: boolean): KnownNames {
  const [known, setKnown] = useState<KnownNames>({});
  useEffect(() => {
    if (!open || !hostId || hostId === "own-server") return;
    let current = true;
    api("POST /api/editor-hosts/:hostId/connect", { params: { hostId }, body: {} }).then(
      (account) => current && setKnown({ accounts: account.accounts, regions: account.regions }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [hostId, open]);
  return known;
}

export function RemoveEditorDialog({ siteId, address, hostId, hostName, open, onClose }: { siteId: string; address: string; hostId: string; hostName: string; open: boolean; onClose: () => void }) {
  const [removal, setRemoval] = useState<HostedEditorRemoval | null>(null);
  const known = useKnownNames(hostId, open);
  const host = { id: hostId, name: hostName };
  const confirmInput = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [started, setStarted] = useState<Job | null>(null);
  const job = useFollowJob(started);
  useShowingJob(started?.id ?? null, open);

  const load = () => {
    setLoadError(null);
    setRemoval(null);
    api("GET /api/sites/:siteId/editor/removal", { params: { siteId } }).then(setRemoval, setLoadError);
  };

  useEffect(() => {
    if (!open) return;
    if (started && job?.state === "running") return;
    setTyped("");
    setStarted(null);
    setStartError(null);
    load();
  }, [open]);

  useEffect(() => {
    if (job && job.state !== "running") invalidate(keys.editor(siteId));
  }, [job?.state]);

  // The dialog opens on a skeleton; once the list is in, the confirm field takes the focus it was meant to have.
  useEffect(() => {
    if (removal && !started) confirmInput.current?.focus();
  }, [removal]);

  const confirmed = removalConfirmed(typed, address);
  const remove = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setStartError(null);
    try {
      setStarted(await removeEditor(siteId));
    } catch (caught) {
      setStartError(caught);
    } finally {
      setBusy(false);
    }
  };

  const running = job?.state === "running";
  const title = job?.state === "done" ? "The hosted editor is removed" : job?.state === "error" ? "Couldn’t remove all of it" : running ? "Removing the hosted editor…" : `Remove the editor at ${address}?`;

  let body;
  if (job) {
    body =
      job.state === "done" ? (
        <>
          <p className="deploy-setup__note" role="status">
            <Icon name="check" />
            {/* A clean finish ("Removed.") means everything recorded went, so it is counted here by place; when something was left alone at the last check, the server's own sentence says so. */}
            <span>{removal && job.detail === "Removed." ? removedLine({ resources: [...removal.resources, ...removal.skipped.map((entry) => entry.resource)] }, host) : job.detail}</span>
          </p>
          {removal && removal.kept.length > 0 ? (
            <section className="host-section">
              <h3 className="host-section__title">Kept</h3>
              <ul className="host-list">
                {removal.kept.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : job.state === "error" ? (
        <EditorJobFailure job={job} title="Couldn’t remove all of it" />
      ) : (
        <EditorProgress job={job} managed stages={false} />
      );
  } else if (loadError) {
    body = <ErrorState compact title="Couldn’t check what would be removed" error={loadError} onRetry={load} />;
  } else if (!removal) {
    body = <Skeleton lines={6} />;
  } else {
    body = (
      <>
        {removal.resources.length > 0 ? (
          <ResourceSections resources={removal.resources} host={host} known={known} title={(place) => `Deleted from ${place}`} fallback="Deleted" />
        ) : (
          <section className="host-section">
            <h3 className="host-section__title">Deleted</h3>
            <p className="host-text">Nothing on an account. Stop the editor on your own computer too.</p>
          </section>
        )}
        {removal.skipped.length > 0 ? (
          <section className="host-section">
            <h3 className="host-section__title">Left alone</h3>
            <ul className="host-list">
              {removal.skipped.map((entry) => (
                <li key={`${entry.resource.kind}-${entry.resource.name}`} className="host-list__item">
                  <ResourceRow resource={entry.resource} known={known} />
                  <span className="host-text">{entry.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {removal.kept.length > 0 ? (
          <section className="host-section">
            <h3 className="host-section__title">Kept</h3>
            <ul className="host-list">
              {removal.kept.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="host-warning" role="note">
          <ProofMark kind="bang" />
          <div className="host-warning__body">
            <span>{removal.warning}</span>
            {/* Every hosted editor's own backup is downloaded from its Install page, whatever its host can copy: so the way to it is offered right here. */}
            <a className={buttonClass("secondary", "sm")} href={`https://${address}/install`} target="_blank" rel="noopener noreferrer">
              <Icon name="external" />
              Open its Install page
            </a>
          </div>
        </div>
        <Field label={`Type ${address} to confirm`}>
          <Input ref={confirmInput} mono value={typed} autoComplete="off" spellCheck={false} placeholder={address} onChange={(event) => setTyped(event.target.value)} data-autofocus />
        </Field>
        {startError ? <ErrorState compact title="Couldn’t start removing it" error={startError} /> : null}
      </>
    );
  }

  const footer = job ? (
    <Button variant={running ? "secondary" : "primary"} onClick={onClose}>
      {running ? "Keep going in the background" : "Close"}
    </Button>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Keep it
      </Button>
      <Button variant="danger" busy={busy} busyLabel="Starting…" disabled={!removal || !confirmed} onClick={() => void remove()}>
        Remove the hosted editor
      </Button>
    </>
  );

  return (
    <Dialog open={open} onClose={onClose} title={title} size="lg" footer={footer} dismissible={!busy}>
      <div className="host-remove">{body}</div>
    </Dialog>
  );
}
