/**
 * The Online screen's "Editor online" section: an offer to host the editor
 * when there is none, or the editor that exists — its address, health and
 * host, and (when this computer made it) finishing first run, upgrading,
 * backing up and removing. On a hosted install the section isn't there and
 * none of its routes are called: a hosted install never makes others.
 */
import { useEffect, useState } from "react";
import type { HostedEditorBackup, HostedEditorStatus } from "@galley/core/hosting/types";
import { api, errorShape } from "@/lib/api";
import { useHostedInstall, useMeta } from "@/lib/stores/meta";
import { notify } from "@/lib/stores/toasts";
import { invalidate } from "@/lib/query";
import { keys } from "@/lib/sync";
import { Button, ErrorState, Icon, Skeleton, buttonClass, cx } from "@/ui";
import { HostEditorDialog } from "./HostEditorDialog";
import { cardState, editorAddress, healthWords, upgradeLine } from "./logic";
import { EditorJobFailure, EditorProgress, FilesList, StepsList } from "./parts";
import { RemoveEditorDialog } from "./RemoveEditorDialog";
import { openFirstRun, track, useEditorHosts, useEditorHostingUi, useEditorStatus, useLatestEditorJob } from "./useHosting";

/** Local mode only, decided before anything is asked of the server. */
export function EditorOnlineSection({ siteId }: { siteId: string }) {
  const known = useMeta((s) => s.meta !== null);
  const hosted = useHostedInstall();
  if (!known || hosted) return null;
  return <EditorOnline siteId={siteId} />;
}

function BackupResult({ result }: { result: HostedEditorBackup }) {
  return (
    <p className="host-card__result" role="status">
      <Icon name={result.kind === "snapshot" ? "check" : "download"} />
      <span>
        {result.message}
        {result.snapshot ? (
          <>
            {" "}
            <span className="g-mono">{result.snapshot}</span>
          </>
        ) : null}
      </span>
      {result.kind === "page" && result.url ? (
        <a className={buttonClass("secondary", "sm")} href={result.url} target="_blank" rel="noopener noreferrer">
          <Icon name="external" />
          Open the Install page
        </a>
      ) : null}
    </p>
  );
}

function EditorOnline({ siteId }: { siteId: string }) {
  const status = useEditorStatus(siteId);
  const data = status.data;
  const state = cardState(data);
  const hosts = useEditorHosts(state !== "none");
  const live = useLatestEditorJob(siteId);
  const fromStatus = data?.job ?? null;
  const job = live && (!fromStatus || live.startedAt >= fromStatus.startedAt) ? live : fromStatus;
  /** Kept while the removal dialog is open, so it can say "removed" after the editor is gone. */
  const [removing, setRemoving] = useState<{ address: string; hostId: string; hostName: string } | null>(null);
  const [busy, setBusy] = useState<"upgrade" | "backup" | "check" | null>(null);
  const [backup, setBackup] = useState<HostedEditorBackup | null>(null);
  const [notYet, setNotYet] = useState<string | null>(null);

  const refetch = () => status.refetch();
  const wanted = useEditorHostingUi((s) => s.openFor === siteId);
  // Asked to host it (the palette, a new site) when the site already has an editor: the card says so instead.
  useEffect(() => {
    if (wanted && data && cardState(data) !== "none") useEditorHostingUi.getState().close();
  }, [wanted, data === undefined]);
  const dialog = <HostEditorDialog siteId={siteId} status={data} onStatus={refetch} />;

  if (status.loading) {
    return (
      <>
        <h2 className="app-section__title host-section-title">Editor online</h2>
        <Skeleton height={120} />
        {dialog}
      </>
    );
  }
  if (!data) {
    return (
      <>
        <h2 className="app-section__title host-section-title">Editor online</h2>
        <ErrorState compact title="Couldn’t check for an editor online" error={status.error} onRetry={() => void refetch()} />
        {dialog}
      </>
    );
  }

  const address = editorAddress(data);
  const record = data.record;
  const hostId = record?.host ?? data.config?.host ?? null;
  const hostName = hosts.data?.hosts.find((entry) => entry.id === hostId)?.name ?? hostId ?? "its host";
  const running = job?.state === "running";
  const health = healthWords(data.health);
  const failedCreate = job?.state === "error" && job.label === "Putting the editor online";

  const act = async (what: "upgrade" | "backup" | "check") => {
    setBusy(what);
    setNotYet(null);
    try {
      if (what === "upgrade") track(await api("POST /api/sites/:siteId/editor/upgrade", { params: { siteId } }));
      else if (what === "backup") setBackup(await api("POST /api/sites/:siteId/editor/backup", { params: { siteId } }));
      else {
        const next: HostedEditorStatus = await api("POST /api/sites/:siteId/editor/check", { params: { siteId } });
        invalidate(keys.editor(siteId));
        if (next.pending) setNotYet(`${editorAddress(next) ?? "The editor"} isn’t answering yet. Check the steps, give it a minute, then check again.`);
      }
    } catch (caught) {
      const shape = errorShape(caught);
      notify({ tone: "danger", title: what === "upgrade" ? "Couldn’t start the upgrade" : what === "backup" ? "Couldn’t back up the editor" : "Couldn’t check the editor", body: shape.message, ...(shape.detail ? { detail: shape.detail } : {}) });
    } finally {
      setBusy(null);
    }
  };

  let card;
  if (running) {
    card = (
      <div className="app-card app-card--pad deploy-card">
        <p className="host-card__title">{job.label}</p>
        <EditorProgress job={job} managed={hosts.data?.hosts.find((entry) => entry.id === hostId)?.kind !== "self-run"} stages={false} />
      </div>
    );
  } else if (state === "none") {
    card = (
      <div className="app-card app-card--pad deploy-card">
        <p className="deploy-card__text">Edit this site from any browser, not just this computer. The editor runs on your own account with a host, with its own sign-in: you create its first account, then invite the people who work on the site.</p>
        {failedCreate ? <EditorJobFailure job={job} title="Couldn’t put the editor online" /> : null}
        <div className="deploy-card__actions">
          <Button variant="secondary" size="sm" icon="globe" onClick={() => useEditorHostingUi.getState().open(siteId)}>
            Host the editor online
          </Button>
        </div>
      </div>
    );
  } else if (state === "unfinished") {
    card = (
      <div className="app-card app-card--pad deploy-card">
        <p className="host-card__title">Putting the editor online didn’t finish</p>
        <p className="deploy-card__text">{`Some of it was created on ${hostName}. Remove it, then host the editor again.`}</p>
        {failedCreate ? <EditorJobFailure job={job} title="What happened" /> : null}
        <div className="deploy-card__actions">
          <Button variant="danger-quiet" size="sm" icon="trash" onClick={() => address && setRemoving({ address, hostId: hostId ?? "", hostName })}>
            Remove what was created
          </Button>
        </div>
      </div>
    );
  } else {
    card = (
      <div className="app-card app-card--pad deploy-card">
        <p className="host-card__title">This site also has an editor online</p>
        {address ? (
          <a className="deploy-card__address" href={`https://${address}`} target="_blank" rel="noopener noreferrer">
            {address}
            <Icon name="external" />
          </a>
        ) : null}
        <p className="host-card__facts">
          <span className={cx("host-card__health", `host-card__health--${health.tone}`)}>
            <span className="host-card__dot" aria-hidden="true" />
            {health.text}
          </span>
          <span>{`On ${hostName}`}</span>
          {data.runningVersion ? <span>{`Version ${data.runningVersion}`}</span> : null}
        </p>
        {job?.state === "error" ? <EditorJobFailure job={job} title={job.label === "Upgrading the editor" ? "Couldn’t upgrade the editor" : job.label === "Removing the editor" ? "Couldn’t remove all of it" : "Couldn’t finish"} /> : null}
        {record ? (
          <div className="deploy-card__actions">
            {record.setup === "pending" && !data.pending ? (
              <Button variant="primary" size="sm" icon="external" onClick={() => openFirstRun(siteId)}>
                Finish setting it up
              </Button>
            ) : null}
            {data.upgradeAvailable ? (
              <Button variant="secondary" size="sm" busy={busy === "upgrade"} busyLabel="Starting…" onClick={() => void act("upgrade")}>
                {`Upgrade to ${data.currentVersion}`}
              </Button>
            ) : null}
            {!data.pending ? (
              <Button variant="secondary" size="sm" busy={busy === "backup"} busyLabel="Backing up…" onClick={() => void act("backup")}>
                Back up
              </Button>
            ) : null}
            <Button variant="danger-quiet" size="sm" icon="trash" onClick={() => address && setRemoving({ address, hostId: hostId ?? "", hostName })}>
              Remove the hosted editor
            </Button>
          </div>
        ) : (
          <p className="g-hint">It was set up from another computer, so it can be opened here, but upgraded or removed only from there or on the host itself.</p>
        )}
        {record && data.upgradeAvailable ? <p className="g-hint">{`${upgradeLine(data)}. Its disk and everything on it stay as they are.`}</p> : null}
        {backup ? <BackupResult result={backup} /> : null}
        {data.pending ? (
          <div className="host-card__pending">
            <p className="host-card__title">Still to do</p>
            {data.pending.steps.length ? <StepsList steps={data.pending.steps} /> : null}
            {data.pending.files.length ? <FilesList files={data.pending.files} /> : null}
            {notYet ? <p className="deploy-card__line deploy-card__line--warning">{notYet}</p> : null}
            <div className="deploy-card__actions">
              <Button variant="primary" size="sm" busy={busy === "check"} busyLabel="Checking…" onClick={() => void act("check")}>
                I’ve started it — check
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <h2 className="app-section__title host-section-title">Editor online</h2>
      {card}
      {dialog}
      {removing ? <RemoveEditorDialog siteId={siteId} address={removing.address} hostId={removing.hostId} hostName={removing.hostName} open onClose={() => setRemoving(null)} /> : null}
    </>
  );
}
