import { useState } from "react";
import type { MediaItem } from "@galley/core/types";
import { rawFileUrl } from "@/lib/api";
import { bytes, relativeTime } from "@/lib/format";
import { Badge, Button, Icon, IconButton, Input } from "@/ui";
import { folderOf, kindOf } from "./mediaPaths";

export interface MediaDetailsProps {
  siteId: string;
  item: MediaItem | null;
  onDelete: (item: MediaItem) => void;
}

const STATUS: Record<MediaItem["status"], string> = { clean: "Published", added: "New — not published yet", modified: "Changed — not published yet", deleted: "Deleted" };

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
        <dt>Folder</dt>
        <dd className="g-mono">{folderOf(item.path)}</dd>
        <dt>Status</dt>
        <dd>{STATUS[item.status]}</dd>
        <dt>Changed</dt>
        <dd>{relativeTime(item.modifiedAt)}</dd>
      </dl>
      <div className="app-media-details__actions">
        <a className="g-btn g-btn--secondary g-btn--sm" href={rawFileUrl(siteId, item.path)} target="_blank" rel="noreferrer noopener">
          <Icon name="external" />
          Open full size
        </a>
        <Button size="sm" variant="danger-quiet" icon="trash" onClick={() => onDelete(item)}>
          Delete
        </Button>
      </div>
    </aside>
  );
}
