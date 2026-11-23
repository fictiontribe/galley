import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { EntryList, EntrySummary, MediaConfig } from "@galley/core/types";
import { useQuery, type QueryKey } from "@/lib/query";
import { Skeleton } from "@/ui";
import { EntryRow, type RowColumns } from "./EntryRow";
import { rowWindow, scrollToRow } from "./window";

export const PAGE_SIZE = 50;
const ROW_HEIGHT = 52;

export interface EntryRowsProps {
  siteId: string;
  /** Cache key prefix for this query (collection + search/sort/filter). */
  queryKey: QueryKey;
  fetchPage: (offset: number, limit: number) => Promise<EntryList>;
  total: number;
  columns: RowColumns;
  media: MediaConfig | null;
  label: string;
  onDelete: (entry: EntrySummary) => void;
  siteUrl: (path: string) => string | null;
}

function PageRows({ page, props, active, onActivate, focusRequest }: { page: number; props: EntryRowsProps; active: number; onActivate: (index: number) => void; focusRequest: RefObject<boolean> }) {
  const { siteId, queryKey, fetchPage, total, columns, media, onDelete, siteUrl } = props;
  const result = useQuery([...queryKey, page], () => fetchPage(page * PAGE_SIZE, PAGE_SIZE));
  const start = page * PAGE_SIZE;
  if (!result.data) {
    const rows = Math.min(PAGE_SIZE, Math.max(0, total - start));
    return (
      <>
        {Array.from({ length: Math.min(rows, 12) }, (_, offset) => (
          <div key={offset} className="app-row app-row--skeleton" style={{ top: (start + offset) * ROW_HEIGHT }} aria-hidden="true">
            {columns.thumb ? <Skeleton width={48} height={36} /> : null}
            <Skeleton width={`${50 + ((offset * 17) % 35)}%`} height={13} />
            {columns.author ? <Skeleton width={80} height={11} /> : null}
            {columns.date ? <Skeleton width={72} height={11} /> : null}
            <span />
            <span />
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {result.data.items.map((entry, offset) => (
        <EntryRow
          key={entry.path}
          siteId={siteId}
          entry={entry}
          index={start + offset}
          top={(start + offset) * ROW_HEIGHT}
          columns={columns}
          active={active === start + offset}
          media={media}
          onActivate={onActivate}
          onDelete={onDelete}
          siteUrl={siteUrl}
          focusRequest={focusRequest}
        />
      ))}
    </>
  );
}

/**
 * The rows, windowed: only what's on screen (plus a margin) is rendered, and
 * pages of 50 are fetched as they scroll into view, so 1,000+ entries stay
 * smooth. ↑/↓ move, Home/End jump, Enter opens.
 */
export function EntryRows(props: EntryRowsProps) {
  const { total, label } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const [active, setActive] = useState(0);
  const pendingFocus = useRef(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView({ top: el.scrollTop, height: el.clientHeight }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  // A new search or sort starts at the top.
  const keyHash = JSON.stringify(props.queryKey);
  useEffect(() => {
    setActive(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [keyHash]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const link = document.getElementById(`row-${active}`);
    if (link) {
      pendingFocus.current = false;
      link.focus({ preventScroll: true });
    }
  });

  const moveTo = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(total - 1, index));
      setActive(next);
      pendingFocus.current = true;
      const el = scroller.current;
      if (!el) return;
      const top = scrollToRow(next, el.scrollTop, el.clientHeight, ROW_HEIGHT);
      if (top !== null) el.scrollTop = top;
    },
    [total],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[role=menu]") || target.getAttribute("aria-haspopup") === "menu") return;
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 520) / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, PageDown: active + page, PageUp: active - page, Home: 0, End: total - 1 };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      moveTo(next);
    } else if (event.key === "Enter" && target === scroller.current) {
      document.getElementById(`row-${active}`)?.click();
    }
  };

  const range = rowWindow(view.top, view.height, ROW_HEIGHT, total, PAGE_SIZE);
  return (
    <div
      ref={scroller}
      className="app-rows"
      role="list"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="app-rows__space" style={{ blockSize: total * ROW_HEIGHT }}>
        {range.pages.map((page) => (
          <PageRows key={page} page={page} props={props} active={active} onActivate={setActive} focusRequest={pendingFocus} />
        ))}
      </div>
    </div>
  );
}
