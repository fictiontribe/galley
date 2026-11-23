import { useRef, type KeyboardEvent } from "react";
import type { MediaItem } from "@galley/core/types";
import { rawFileUrl } from "@/lib/api";
import { bytes } from "@/lib/format";
import { Badge, Icon, cx } from "@/ui";
import { kindOf } from "./mediaPaths";

export interface MediaGridProps {
  siteId: string;
  items: MediaItem[];
  selected: string | null;
  onSelect: (item: MediaItem) => void;
  /** Enter or double-click: use it (picker) or open it (library). */
  onActivate?: (item: MediaItem) => void;
  label: string;
}

function StatusMark({ status }: { status: MediaItem["status"] }) {
  if (status === "added") return <Badge tone="insert">New</Badge>;
  if (status === "modified") return <Badge tone="change">Edited</Badge>;
  return null;
}

function Thumb({ siteId, item }: { siteId: string; item: MediaItem }) {
  const kind = kindOf(item);
  if (kind === "image") return <img src={rawFileUrl(siteId, item.path)} alt="" loading="lazy" decoding="async" />;
  return (
    <span className="app-media-tile__file">
      <Icon name={kind === "video" ? "play" : "page"} size={22} />
      <span className="g-mono">{item.name.split(".").pop()?.toUpperCase()}</span>
    </span>
  );
}

/** Columns in the grid right now, measured from the tiles' positions. */
function columnsOf(list: HTMLElement): number {
  const tiles = [...list.children] as HTMLElement[];
  const top = tiles[0]?.offsetTop;
  const sameRow = tiles.findIndex((tile) => tile.offsetTop !== top);
  return sameRow === -1 ? tiles.length : sameRow;
}

/** The library as a grid of real thumbnails. Arrow keys move, Enter uses. */
export function MediaGrid({ siteId, items, selected, onSelect, onActivate, label }: MediaGridProps) {
  const list = useRef<HTMLUListElement>(null);
  const index = Math.max(0, items.findIndex((item) => item.path === selected));

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!list.current || items.length === 0) return;
    const columns = columnsOf(list.current);
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns, Home: -index, End: items.length - 1 - index };
    const delta = moves[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      const next = Math.min(items.length - 1, Math.max(0, index + delta));
      const item = items[next];
      if (item) {
        onSelect(item);
        (list.current.children[next] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
      }
    } else if (event.key === "Enter" && onActivate) {
      const item = items[index];
      if (item) {
        event.preventDefault();
        onActivate(item);
      }
    }
  };

  return (
    <ul
      ref={list}
      className="app-media-grid"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={items[index] ? `media-${items[index].path}` : undefined}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <li
          key={item.path}
          id={`media-${item.path}`}
          role="option"
          aria-selected={item.path === selected}
          className={cx("app-media-tile", item.path === selected && "app-media-tile--selected")}
          onClick={() => onSelect(item)}
          onDoubleClick={() => onActivate?.(item)}
        >
          <span className="app-media-tile__thumb">
            <Thumb siteId={siteId} item={item} />
            <span className="app-media-tile__status">
              <StatusMark status={item.status} />
            </span>
          </span>
          <span className="app-media-tile__name" title={item.path}>
            {item.name}
          </span>
          <span className="app-media-tile__meta">
            {item.width && item.height ? `${item.width} × ${item.height} · ` : ""}
            {bytes(item.size)}
          </span>
        </li>
      ))}
    </ul>
  );
}
