import { useState } from "react";
import { useParams } from "react-router-dom";
import type { GitStatus, HistoryEntry, PublishResult } from "@galley/core/types";
import { useTopBar } from "@/app/chrome";
import { versionNote } from "./note";
import { api, errorShape } from "@/lib/api";
import { absoluteTime, count, fileName, relativeTime } from "@/lib/format";
import { invalidate, setQueryData, useQuery } from "@/lib/query";
import { useSite } from "@/lib/stores/site";
import { notify } from "@/lib/stores/toasts";
import { keys } from "@/lib/sync";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, ProofMark, Skeleton } from "@/ui";
import { sendNowWithToast } from "@/features/proof/sendNow";
import { PutLiveButton } from "@/features/deploy/Online";

const PAGE = 50;

function SyncStatus({ siteId }: { siteId: string }) {
  const git = useQuery(keys.git(siteId), () => api("GET /api/sites/:siteId/git", { params: { siteId } }));
  const [pulling, setPulling] = useState(false);
  const [sending, setSending] = useState(false);

  const pull = async () => {
    setPulling(true);
    try {
      const status = await api("POST /api/sites/:siteId/pull", { params: { siteId } });
      setQueryData(keys.git(siteId), status);
      invalidate(keys.site(siteId));
      void useSite.getState().refresh();
      notify({ tone: "success", title: "Up to date", body: "This copy now has the newest published versions." });
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t get the latest versions", body: `${shape.message} Your edits are safe.`, detail: shape.detail });
    } finally {
      setPulling(false);
    }
  };

  if (git.loading) return <Skeleton width={320} height={36} />;
  if (!git.data) return git.status === "error" ? <ErrorState compact title="Couldn’t check for newer versions" error={git.error} onRetry={() => void git.refetch()} /> : null;
  const status: GitStatus = git.data;

  let text: string;
  let tone: "success" | "warning" | "neutral" = "neutral";
  if (!status.hasRemote) text = "Versions are kept on this computer only — they aren’t backed up or shared anywhere.";
  else if (status.behind > 0) {
    text = `${count(status.behind, "newer version")} published elsewhere ${status.behind === 1 ? "isn’t" : "aren’t"} in this copy yet.`;
    tone = "warning";
  } else if (status.ahead > 0) {
    text = `${count(status.ahead, "version")} published here ${status.ahead === 1 ? "hasn’t" : "haven’t"} been sent to the shared copy yet.`;
    tone = "warning";
  } else {
    text = "In step with the shared copy. Everything published is here.";
    tone = "success";
  }

  return (
    <div className="app-sync" role="status">
      <ProofMark kind={tone === "success" ? "reg" : tone === "warning" ? "bang" : "stet"} className={`app-sync__mark app-sync__mark--${tone}`} />
      <span>{text}</span>
      {status.hasRemote && status.ahead > 0 ? (
        <Button
          size="sm"
          variant="primary"
          busy={sending}
          busyLabel="Sending…"
          onClick={() => {
            setSending(true);
            void sendNowWithToast(siteId, status.ahead).finally(() => setSending(false));
          }}
        >
          Send now
        </Button>
      ) : null}
      {status.hasRemote ? (
        <Button size="sm" variant="secondary" icon="download" busy={pulling} busyLabel="Getting latest" onClick={() => void pull()}>
          Get latest
        </Button>
      ) : null}
    </div>
  );
}

function VersionRow({ item, onUndo, latest, first }: { item: HistoryEntry; onUndo: (item: HistoryEntry) => void; latest: boolean; first: boolean }) {
  const [open, setOpen] = useState(false);
  const note = versionNote(item.message);
  return (
    <li className="app-version">
      <span className="app-version__rail" aria-hidden="true">
        <ProofMark kind={item.viaGalley ? "reg" : "stet"} />
      </span>
      <div className="app-version__main">
        <div className="app-version__head">
          <h3 className="app-version__message">{note.title}</h3>
          {latest ? <Badge tone="success">Latest</Badge> : null}
          {item.viaGalley ? (
            <Badge tone="accent" mark={null}>
              Published here
            </Badge>
          ) : null}
        </div>
        <p className="app-version__meta">
          <span>{item.author}</span>
          <span aria-hidden="true"> · </span>
          <time dateTime={item.date} title={absoluteTime(item.date)}>
            {relativeTime(item.date)}
          </time>
          <span aria-hidden="true"> · </span>
          <button type="button" className="app-link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {count(item.files.length, "file")}
          </button>
        </p>
        {note.body ? <p className="app-version__body">{note.body}</p> : null}
        {note.technical.length ? (
          <details className="app-details app-version__tech">
            <summary>Technical details</summary>
            <pre className="app-error__detail">{[`Version ${item.commit}`, ...note.technical].join("\n")}</pre>
          </details>
        ) : null}
        {open ? (
          <ul className="app-version__files">
            {item.files.map((file) => (
              <li key={file} className="g-mono" title={file}>
                {fileName(file)} <span className="g-faint">{file}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="app-version__actions">
        {latest ? <PutLiveButton /> : null}
        {/* The very first version is the site itself; undoing it would empty the site. */}
        {first ? (
          <Badge mark={null}>First version</Badge>
        ) : (
          <Button size="sm" variant="quiet" icon="undo" onClick={() => onUndo(item)}>
            Undo this publish
          </Button>
        )}
      </div>
    </li>
  );
}

function describeResult(siteId: string, result: PublishResult, item: HistoryEntry): void {
  const when = absoluteTime(item.date);
  if (!result.ok) {
    notify({ tone: "danger", title: "Couldn’t undo this publish", body: `${result.error ?? "The undo didn’t go through."} Nothing was changed.`, detail: result.detail });
  } else if (result.pushError) {
    notify({
      tone: "warning",
      title: "Undone here, not live yet",
      body: `The undo is recorded on this computer but didn’t reach the shared copy. ${result.pushError}`,
      detail: result.detail,
      action: { label: "Send now", onClick: () => void sendNowWithToast(siteId) },
    });
  } else if (result.pullRequestUrl) {
    notify({ tone: "success", title: "Sent for review", body: "A developer can approve the undo before it goes live.", action: { label: "View request", onClick: () => window.open(result.pullRequestUrl, "_blank", "noopener") } });
  } else {
    notify({ tone: "success", title: "Publish undone", body: `The site is back to how it was before ${when}. That undo is now in Version history too.` });
  }
}

/** /sites/:siteId/history — published versions, undo a publish, get the latest from the host. */
export function HistoryScreen() {
  const { siteId = "" } = useParams();
  useTopBar({ crumbs: [{ label: "Version history" }] });
  const history = useQuery(keys.history(siteId, PAGE), () => api("GET /api/sites/:siteId/history", { params: { siteId }, query: { limit: PAGE } }));
  const [undoing, setUndoing] = useState<HistoryEntry | null>(null);
  const items = history.data?.items ?? [];

  let body;
  if (history.loading) {
    body = (
      <ol className="app-versions" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <li key={index} className="app-version" aria-hidden="true">
            <span className="app-version__rail" />
            <div className="app-version__main">
              <Skeleton width={300 - index * 40} height={16} />
              <Skeleton width={180} height={12} style={{ marginBlockStart: 8 }} />
            </div>
          </li>
        ))}
      </ol>
    );
  } else if (history.status === "error" && !history.data) {
    body = <ErrorState title="Couldn’t load the version history" error={history.error} onRetry={() => void history.refetch()} />;
  } else if (items.length === 0) {
    body = <EmptyState title="Nothing published yet." body="Each time you publish, a version appears here — and you can undo it." mark="reg" />;
  } else {
    body = (
      <ol className="app-versions">
        {items.map((item, index) => (
          <VersionRow key={item.commit} item={item} latest={index === 0} first={index === items.length - 1 && items.length < PAGE} onUndo={setUndoing} />
        ))}
      </ol>
    );
  }

  return (
    <div className="app-screen">
      <div className="app-screen__inner">
        <PageHeader title="Version history" description="Every published version of this site, newest first. Undoing a publish adds a new version that reverses it; nothing here is ever erased." />
        <SyncStatus siteId={siteId} />
        {body}
      </div>
      <ConfirmDialog
        open={Boolean(undoing)}
        onClose={() => setUndoing(null)}
        title="Undo this publish?"
        body={
          undoing
            ? `This takes back “${undoing.message}” from ${absoluteTime(undoing.date)}. It adds a new version on top, so Version history keeps everything — and you can undo the undo.`
            : ""
        }
        confirmLabel="Undo this publish"
        busyLabel="Undoing…"
        cancelLabel="Keep it"
        tone="primary"
        errorTitle="Couldn’t undo this publish"
        onConfirm={async () => {
          if (!undoing) return;
          const result = await api("POST /api/sites/:siteId/revert", { params: { siteId }, body: { commit: undoing.commit } });
          describeResult(siteId, result, undoing);
          invalidate(["site", siteId, "history"]);
          invalidate(keys.git(siteId));
        }}
      />
    </div>
  );
}
