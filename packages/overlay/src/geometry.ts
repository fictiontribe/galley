/**
 * Drop arithmetic for arranging sections, as plain functions over section
 * boxes (document coordinates: top and bottom from the top of the page).
 * A gap `k` is the place before section k; gap n is after the last.
 */

export interface Span {
  top: number;
  bottom: number;
}

/** The gap a pointer at document height `y` means: before the first section whose middle is below it. */
export function gapAt(spans: readonly Span[], y: number): number {
  let gap = 0;
  for (const span of spans) {
    if (y > (span.top + span.bottom) / 2) gap++;
    else break;
  }
  return gap;
}

/** Where gap `k` sits on the page: the top of the first section, between two, or the bottom of the last. */
export function gapY(spans: readonly Span[], gap: number): number {
  const before = spans[gap - 1];
  const after = spans[gap];
  if (before && after) return (before.bottom + after.top) / 2;
  if (after) return after.top;
  return before ? before.bottom : 0;
}

/** The final position of section `from` dropped into gap `gap`, or null when it wouldn't move. */
export function moveTo(from: number, gap: number): number | null {
  const to = gap > from ? gap - 1 : gap;
  return to === from ? null : to;
}

/**
 * The gap nearest a pointer at `y` within `reach` pixels of a boundary, for
 * showing one ＋ while hovering; null when no boundary is that close.
 */
export function nearGap(spans: readonly Span[], y: number, reach: number): number | null {
  let best: number | null = null;
  let distance = reach;
  for (let gap = 0; gap <= spans.length; gap++) {
    const away = Math.abs(gapY(spans, gap) - y);
    if (away <= distance) {
      distance = away;
      best = gap;
    }
  }
  return best;
}

/** Pixels to scroll this frame for a pointer at `y` in a viewport `height` tall: negative is up, 0 outside the edge bands. */
export function edgeSpeed(y: number, height: number, band = 64, max = 22): number {
  const zone = Math.min(band, height / 4);
  if (zone <= 0) return 0;
  if (y < zone) return -Math.ceil(max * Math.min(1, (zone - y) / zone));
  if (y > height - zone) return Math.ceil(max * Math.min(1, (y - (height - zone)) / zone));
  return 0;
}
