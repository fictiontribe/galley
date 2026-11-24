import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useChrome, useTopBar } from "@/app/chrome";
import { count, relativeTime } from "@/lib/format";
import { useChanges } from "@/lib/stores/changes";
import { useSite } from "@/lib/stores/site";
import { Button, EmptyState, ErrorState, Skeleton, buttonClass } from "@/ui";
import { SharePreviewButton } from "@/features/deploy/SharePreview";
import { BrandCheckNotes } from "@/features/brand/BrandCheckNotes";
import { ChangeDetail, type ProofView } from "./ChangeDetail";
import { ChangeList } from "./ChangeList";
import { groupChanges, orderedPaths } from "./changes";
import { useChangeName, useCollections } from "./useNames";
import { ValidationSummary } from "./ValidationSummary";
import { StoreUploads } from "./StoreUploads";
import "./proof.css";
import { useMay } from "@/lib/may";

function LoadingProof() {
  return (
    <div className="proof" aria-busy="true">
      <div className="proof-head">
        <Skeleton width={220} height={28} />
      </div>
      <div className="proof-main">
        <div className="proof-list">
          {[0, 1, 2].map((index) => (
            <div key={index} className="g-file">
              <Skeleton width={56} height={20} pill />
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
        <div className="proof-detail">
          <Skeleton lines={6} />
        </div>
      </div>
    </div>
  );
}

const shorten = (text: string, max = 72) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function NothingWaiting({ siteId }: { siteId: string }) {
  const last = useSite((s) => s.detail?.git.lastCommit);
  return (
    <div className="app-screen app-screen--center">
      <EmptyState
        title="Nothing waiting."
        body={
          last
            ? `Every change lands here before anything goes live. The last version was published ${relativeTime(last.date)} by ${last.author}: “${shorten(last.message.split("\n")[0] ?? "")}”.`
            : "Every change lands here before anything goes live. Edit a field, click text on the page, or ask in chat."
        }
        actions={
          <>
            <Link className={buttonClass("secondary", "md")} to={`/sites/${siteId}/edit`}>
              Open the editor
            </Link>
            {last ? (
              <Link className={buttonClass("quiet", "md")} to={`/sites/${siteId}/history`}>
                See version history
              </Link>
            ) : null}
          </>
        }
      />
    </div>
  );
}

/** /sites/:siteId/proof — everything waiting to be published, in plain words, before it goes live. */
export function ProofScreen() {
  const { siteId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const changes = useChanges((s) => s.changes);
  const status = useChanges((s) => s.status);
  const error = useChanges((s) => s.error);
  const refresh = useChanges((s) => s.refresh);
  const setDiscardOpen = useChrome((s) => s.setDiscardOpen);
  const [view, setView] = useState<ProofView>("what");
  const mayPublish = useMay()("POST /api/sites/:siteId/publish");
  const total = changes?.totals.files ?? 0;
  useTopBar({ crumbs: [{ label: "Proof" }], tag: total > 0 ? { label: count(total, "change"), tone: "change" } : undefined });

  const collections = useCollections();
  const nameOf = useChangeName();
  const groups = useMemo(() => groupChanges(changes?.files ?? [], collections), [changes, collections]);
  const paths = orderedPaths(groups);
  const wanted = params.get("path");
  const selected = wanted && paths.includes(wanted) ? wanted : (paths[0] ?? null);
  const change = changes?.files.find((file) => file.path === selected) ?? null;
  const titles = useMemo(() => new Map((changes?.files ?? []).map((file) => [file.path, nameOf(file)])), [changes, nameOf]);

  const select = (path: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("path", path);
        return next;
      },
      { replace: true },
    );

  // A discarded selection falls through to the first change still waiting.
  useEffect(() => {
    if (wanted && changes && !paths.includes(wanted) && paths[0]) select(paths[0]);
  }, [wanted, changes]);

  if (!changes) {
    if (status === "error") {
      return (
        <div className="app-screen app-screen--center">
          <ErrorState title="Couldn’t read what’s waiting" error={error} onRetry={() => void refresh()} />
        </div>
      );
    }
    return <LoadingProof />;
  }
  const uploads = changes.storeUploads ?? [];
  if (changes.files.length === 0 && uploads.length === 0) return <NothingWaiting siteId={siteId} />;

  return (
    <div className="proof">
      <header className="proof-head">
        <div>
          <p className="g-eyebrow">Proof</p>
          <h1 className="g-title proof-head__title">{total > 0 ? `${count(total, "change")} waiting to be published` : "Nothing waiting to be published"}</h1>
          <p className="proof-head__lede">{mayPublish ? "Check each one. Nothing goes live until you publish." : "Check each one. Nothing goes live until an editor or owner publishes."}</p>
        </div>
        <div className="proof-head__actions">
          <SharePreviewButton siteId={siteId} />
          <Button variant="danger-quiet" size="sm" icon="trash" onClick={() => setDiscardOpen(true)}>
            Discard all
          </Button>
        </div>
      </header>
      <ValidationSummary siteId={siteId} changes={changes} titles={titles} />
      {uploads.length ? <StoreUploads siteId={siteId} items={uploads} /> : null}
      <div className="proof-brand">
        <BrandCheckNotes siteId={siteId} />
      </div>
      <div className="proof-main">
        <nav className="proof-nav" aria-label="Changes">
          <ChangeList groups={groups} selected={selected} onSelect={select} />
        </nav>
        {change ? <ChangeDetail siteId={siteId} change={change} view={view} onView={setView} /> : null}
      </div>
    </div>
  );
}
