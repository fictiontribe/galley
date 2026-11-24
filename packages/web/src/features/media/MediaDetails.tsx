import { useState } from "react";
import type { MediaItem } from "@galley/core/types";
import { rawFileUrl } from "@/lib/api";
import { bytes, relativeTime } from "@/lib/format";
import { Badge, Button, Icon, IconButton, Input } from "@/ui";
import { folderOf, kindOf } from "./mediaPaths";
import { isStored, placeWords, useMediaStorage, useUsage } from "./storage/useMediaStorage";

export interface MediaDetailsProps {
  siteId: string;
  item: MediaItem | null;
  onDelete: (item: MediaItem) => void;
}

const STATUS: Record<MediaItem["status"], string> = { clean: "Published", added: "New — not published yet", modified: "Changed — not published yet", deleted: "Deleted" };

/** Where a file kept in the bucket or Cloudflare Images is used: pages of the working copy, files of the published version. */
function UsedOn({ siteId, item }: { siteId: string; item: MediaItem }) {
  const usage = useUsage(siteId, item);
  if (!usage.data) return <p className="g-hint">Looking for pages that use it…</p>;
  const { working, published } = usage.data;
  const onlyPublished = published.filter((path) => !working.some((page) => page.path === path));
  if (!working.length && !onlyPublished.length) return <p className="g-hint">No page uses it yet. It is public at its address all the same.</p>;
  return (
    <ul className="media-storage__used">
      {working.map((page) => (
        <li key={page.path}>
          <span>{page.title}</span> <span className="g-mono g-hint">{page.path}</span>
        </li>
      ))}
      {onlyPublished.map((path) => (
        <li key={path}>
          <span className="g-mono">{path}</span> <span className="g-hint">— the published version</span>
        </li>
      ))}
    </ul>
  );
}

/** The selected file: a large preview, its address with Copy, size, where it lives, and Delete. */
export function MediaDetails({ siteId, item, onDelete }: MediaDetailsProps) {
  const [copied, setCopied] = useState(false);
  if (!item) {
    return (
      <aside className="app-media-details" aria-label="Details">
        <p className="app-media-details__empty">Choose a file to see its details.</p>
      </aside>
    );
  }
  const copy = async () => {
    await navigator.clipboard.writeText(item.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const isImage = kindOf(item) === "image";
  const stored = isStored(item);
  return (
    <aside className="app-media-details" aria-label={`Details of ${item.name}`}>
      <div className="app-media-details__preview">
        {isImage ? (
          <img src={rawFileUrl(siteId, item.path)} alt="" />
        ) : kindOf(item) === "video" ? (
          <video src={rawFileUrl(siteId, item.path)} controls preload="metadata" playsInline aria-label={item.name} />
        ) : (
          <Icon name="page" size={28} />
        )}
      </div>
      <div>
        <h2 className="app-media-details__name">{item.name}</h2>
        {item.status !== "clean" ? <Badge tone={item.status === "added" ? "insert" : item.status === "deleted" ? "delete" : "change"}>{item.status === "added" ? "New" : item.status === "deleted" ? "Deleted" : "Edited"}</Badge> : null}
      </div>
      <div className="app-media-details__url">
        <Input size="sm" mono readOnly value={item.url} aria-label="Address on the site" onFocus={(event) => event.target.select()} />
        <IconButton icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy address"} onClick={() => void copy()} />
      </div>
      <dl className="app-media-details__facts">
        {item.width && item.height ? (
          <>
            <dt>Size</dt>
            <dd>
              {item.width} × {item.height} px
            </dd>
          </>
        ) : null}
        <dt>File</dt>
        <dd>
          {bytes(item.size)} · {item.type.replace(/^image\//, "").replace("+xml", "").toUpperCase()}
        </dd>
        {stored ? (
          <>
            <dt>Kept in</dt>
            <dd><StoredIn item={item} siteId={siteId} /></dd>
            <dt>Status</dt>
            <dd>{item.status === "added" ? "Uploaded — no published page uses it yet" : "Uploaded"}</dd>
          </>
        ) : (
          <>
            <dt>Folder</dt>
            <dd className="g-mono">{folderOf(item.path)}</dd>
            <dt>Status</dt>
            <dd>{STATUS[item.status]}</dd>
          </>
        )}
        <dt>Changed</dt>
        <dd>{relativeTime(item.modifiedAt)}</dd>
      </dl>
      {stored ? (
        <section className="media-storage__used-on" aria-label="Used on">
          <h3 className="g-eyebrow">Used on</h3>
          <UsedOn siteId={siteId} item={item} />
        </section>
      ) : null}
      <div className="app-media-details__actions">
        <a className="g-btn g-btn--secondary g-btn--sm" href={rawFileUrl(siteId, item.path)} target="_blank" rel="noreferrer noopener">
          <Icon name="external" />
          Open full size
        </a>
        <Button size="sm" variant="danger-quiet" icon="trash" onClick={() => onDelete(item)}>
          {stored ? "Delete for good" : "Delete"}
        </Button>
      </div>
    </aside>
  );
}

function StoredIn({ siteId, item }: { siteId: string; item: MediaItem }) {
  const status = useMediaStorage(siteId);
  const where = placeWords(item, status.data);
  return <>{where.charAt(0).toUpperCase() + where.slice(1)}</>;
}
