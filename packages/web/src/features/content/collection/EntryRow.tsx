import { memo, useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router-dom";
import type { EntrySummary, MediaConfig } from "@galley/core/types";
import { rawFileUrl } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Badge, Icon, Menu, Tag, cx, type MenuItem } from "@/ui";
import { thumbnailSource } from "@/features/media/mediaPaths";

export interface RowColumns {
  thumb: boolean;
  /** Shown when the entries carry an author. */
  author: boolean;
  date: boolean;
}

export interface EntryRowProps {
  siteId: string;
  entry: EntrySummary;
  index: number;
  top: number;
  columns: RowColumns;
  active: boolean;
  media: MediaConfig | null;
  onActivate: (index: number) => void;
  onDelete: (entry: EntrySummary) => void;
  /** Where the live/preview page opens, or null. */
  siteUrl: (path: string) => string | null;
  /** Set when keyboard movement wants the active row focused once it is on screen (it may still be loading). */
  focusRequest?: RefObject<boolean>;
}

function displayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function StatusBadges({ entry }: { entry: Pick<EntrySummary, "status" | "draft"> }) {
  return (
    <>
      {entry.draft ? <Tag variant="outline">Draft</Tag> : null}
      {entry.status === "added" ? <Badge tone="insert">New</Badge> : null}
      {entry.status === "modified" ? <Badge tone="change">Edited</Badge> : null}
      {entry.status === "deleted" ? <Badge tone="delete">Deleted</Badge> : null}
    </>
  );
}

/** One entry in the collection list: a link that opens the editor, plus a menu. */
export const EntryRow = memo(function EntryRow({ siteId, entry, index, top, columns, active, media, onActivate, onDelete, siteUrl, focusRequest }: EntryRowProps) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!active || !focusRequest?.current) return;
    focusRequest.current = false;
    link.current?.focus({ preventScroll: true });
  }, [active, focusRequest]);
  const href = `/sites/${siteId}/edit?path=${encodeURIComponent(entry.path)}`;
  const thumb = columns.thumb && entry.image ? thumbnailSource(entry.image, media, (path) => rawFileUrl(siteId, path)) : null;
  const live = entry.url ? siteUrl(entry.url) : null;
  const items: MenuItem[] = [
    { id: "open", label: "Open", icon: "page", onSelect: () => document.getElementById(`row-${index}`)?.click() },
    { id: "site", label: "Open on the site", icon: "external", disabled: !live, onSelect: () => live && window.open(live, "_blank", "noopener") },
    { kind: "separator", id: "sep" },
    { id: "delete", label: "Delete…", icon: "trash", tone: "danger", disabled: entry.status === "deleted", onSelect: () => onDelete(entry) },
  ];

  return (
    <div className={cx("app-row", active && "app-row--active")} style={{ top }} role="listitem" onMouseDown={() => onActivate(index)}>
      {columns.thumb ? <span className="app-row__thumb">{thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name="image" />}</span> : null}
      <Link ref={link} id={`row-${index}`} to={href} className="app-row__main app-row__link" tabIndex={active ? 0 : -1} onFocus={() => onActivate(index)}>
        <span className={cx("app-row__title", entry.titleSource === "filename" && "app-row__title--guess")}>{entry.title}</span>
        <span className="app-row__url">{entry.url ?? entry.slug}</span>
      </Link>
      {columns.author ? (
        <span className="app-row__author" title={entry.author}>
          {entry.author ?? "—"}
        </span>
      ) : null}
      {columns.date ? <span className="app-row__date">{entry.date ? displayDate(entry.date) : "—"}</span> : null}
      <span className="app-row__status" title={`Changed ${relativeTime(entry.modifiedAt)}`}>
        <StatusBadges entry={entry} />
      </span>
      <Menu
        label={`${entry.title} options`}
        placement="bottom-end"
        items={items}
        trigger={(props) => (
          <button {...props} type="button" tabIndex={active ? 0 : -1} className="g-btn g-btn--quiet g-btn--sm g-btn--icon app-row__menu" aria-label={`More for ${entry.title}`}>
            <Icon name="more" />
          </button>
        )}
      />
    </div>
  );
});
