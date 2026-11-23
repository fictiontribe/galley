/**
 * Windowing arithmetic for long lists: which rows are on screen, and which
 * pages of rows must be fetched to show them.
 */

export interface RowWindow {
  /** First and last row index to render (inclusive), overscan included. */
  first: number;
  last: number;
  /** Pages (of `pageSize` rows) those rows fall in. */
  pages: number[];
}

export function rowWindow(scrollTop: number, viewport: number, rowHeight: number, total: number, pageSize: number, overscan = 8): RowWindow {
  if (total <= 0) return { first: 0, last: -1, pages: [0] };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total - 1, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  const pages: number[] = [];
  for (let page = Math.floor(first / pageSize); page <= Math.floor(last / pageSize); page++) pages.push(page);
  return { first, last, pages };
}

/** The scrollTop that brings row `index` fully into view, or null when it already is. */
export function scrollToRow(index: number, scrollTop: number, viewport: number, rowHeight: number): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return null;
}
