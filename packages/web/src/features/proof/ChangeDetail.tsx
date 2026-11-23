import { Link } from "react-router-dom";
import type { FileChange } from "@galley/core/types";
import { PreviewPane } from "@/features/preview/PreviewPane";
import { Badge, TabPanel, Tabs, buttonClass, type TabItem } from "@/ui";
import { firstChangedText, groupOf } from "./changes";
import { useChangeName, useCollections } from "./useNames";
import { SourceView } from "./SourceView";
import { WhatChanged } from "./WhatChanged";

export type ProofView = "what" | "page" | "source";

const STATUS = {
  added: { label: "New", tone: "insert" },
  modified: { label: "Edited", tone: "change" },
  deleted: { label: "Deleted", tone: "delete" },
} as const;

const noop = () => undefined;

/** One change in three views: in content terms, on the page beside the live site, and as source lines. */
export function ChangeDetail({ siteId, change, view, onView }: { siteId: string; change: FileChange; view: ProofView; onView: (view: ProofView) => void }) {
  const pageUrl = change.url && change.status !== "deleted" ? change.url : null;
  const items: TabItem[] = [{ id: "what", label: "What changed" }, ...(pageUrl ? [{ id: "page", label: "On the page" }] : []), { id: "source", label: "Source" }];
  const current: ProofView = view === "page" && !pageUrl ? "what" : view;
  const status = STATUS[change.status];
  const name = useChangeName()(change);
  const group = groupOf(change, useCollections());

  return (
    <article className="proof-detail" aria-labelledby="proof-detail-title">
      <header className="proof-detail__head">
        <div className="proof-detail__titles">
          <p className="g-eyebrow">{group === "content" ? "Content" : group === "media" ? "Media" : "Code & settings"}</p>
          <h2 id="proof-detail-title" className="g-title proof-detail__title">
            {name}
          </h2>
          <p className="proof-detail__summary">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{change.summary}</span>
          </p>
        </div>
        {change.kind === "content" && change.status !== "deleted" ? (
          <Link className={buttonClass("secondary", "sm")} to={`/sites/${siteId}/edit?path=${encodeURIComponent(change.path)}`}>
            Open in editor
          </Link>
        ) : null}
      </header>
      <Tabs label="How to see this change" idBase="proof-view" items={items} value={current} onChange={(id) => onView(id as ProofView)} className="proof-detail__tabs" />
      <TabPanel idBase="proof-view" id="what" value={current} className="proof-detail__panel">
        <WhatChanged key={change.path} siteId={siteId} change={change} />
      </TabPanel>
      {pageUrl ? (
        <TabPanel idBase="proof-view" id="page" value={current} className="proof-detail__panel proof-detail__panel--page">
          <PreviewPane siteId={siteId} urlPath={pageUrl} onNavigate={noop} mode="split" editable={false} highlight={firstChangedText(change) ?? undefined} />
        </TabPanel>
      ) : null}
      <TabPanel idBase="proof-view" id="source" value={current} className="proof-detail__panel">
        <SourceView key={change.path} siteId={siteId} change={change} />
      </TabPanel>
    </article>
  );
}
