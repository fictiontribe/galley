/* ==========================================================================
   Galley — the icon family. One source for the editing app
   (packages/web/src/ui/Icon.tsx) and the marketing site
   (apps/site/src/components/Glyph.astro). Each value is the inside of an
   <svg viewBox="0 0 16 16">; the wrapper sets stroke, fill and size.

   Drawing rules (brand/README.md → "Icons")
     grid      16 units. Keyline: square 2–14, circle Ø13, portrait sheet
               3–13 × 1.5–14.5, landscape 1.5–14.5 × 3–13 (outer edges).
     stroke    1.5, square-cut ends, mitred corners: a ruled line, not a
               marker. Straight strokes are centred on .25 / .75 and free
               ends land on .0 / .5, so every edge falls on a device pixel
               at 2× (and one edge of every stroke at 1×). Centred glyphs
               therefore sit on x = 7.75, a quarter unit left of centre.
     corners   1 unit on sheets and frames: paper is nearly square.
     layers    class="i-a"   accent stroke  — var(--icon-accent, currentColor)
               class="i-af"  accent fill    — var(--icon-accent, currentColor)
               class="i-f"   solid ink fill — currentColor
               class="i-t"   tint fill      — var(--icon-tint, none)
               At rest an icon is one ink. Where it marks the current place
               (the sidebar, a chosen view) the accent part takes the Blue
               Pencil and the body a pencil tint: the editor's mark, nothing
               more. Never colour a whole icon for decoration.
     sizes     16 (UI), 20, 24, 32, 48. Above 16 the wrapper thins the
               stroke in grid units so the line on screen grows slowly:
               16 → 1.5 px · 20 → 1.75 · 24 → 2 · 32 → 2.25 · 48 → 2.75.
   The proof marks (caret, dele, transpose, stet, registration, pilcrow) are
   the brand's own glyphs and keep their geometry and weights.
   ========================================================================== */

export const ICONS = {
  // ── places ─────────────────────────────────────────────────────────────
  home: `<path d="M1.75 7.75 7.75 2.5l6 5.25"/><path d="M3.25 6.5v7.25h9V6.5"/><path class="i-a" d="M6.5 13.75v-3.5h2.5v3.5"/>`,
  proof: `<path d="M2 3.25h11.5M2 7.75h3.25M10.25 7.75h3.25"/><path class="i-a" d="m4.75 13.75 3-4.75 3 4.75"/>`,
  page: `<path class="i-t" d="M3.75 2.25h5.5l3 3v8.5h-8.5z"/><path d="M3.75 2.25h5.5l3 3v8.5h-8.5z"/><path class="i-a" d="M9.25 2.25v3h3"/>`,
  posts: `<path class="i-af" d="M2 2.5h4.5V7H2z"/><path d="M8.5 3.25H14M8.5 6.25H14M2 9.75h12M2 12.75h8"/>`,
  person: `<circle class="i-a" cx="7.75" cy="5" r="2.75"/><path d="M2.5 14c0-3 2.35-5 5.25-5s5.25 2 5.25 5"/>`,
  image: `<rect class="i-t" x="2.25" y="3.25" width="11.5" height="9.5" rx="1"/><rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1"/><path d="m2.25 11.25 3.5-3.5 3.25 3.25 1.5-1.5 3.25 3.25"/><circle class="i-af" cx="10.5" cy="6.25" r="1.25"/>`,
  history: `<path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3"/><path d="M2.25 2.5v3h3"/><path class="i-a" d="M8.25 5v3.25l2.25 1.5"/>`,
  settings: `<path d="M2 4.75h2.5M8 4.75h6M2 11.25h6M11.5 11.25H14"/><circle class="i-a" cx="6.25" cy="4.75" r="1.75"/><circle class="i-a" cx="9.75" cy="11.25" r="1.75"/>`,
  data: `<path d="M5.5 2.25h-.75c-1.25 0-2 .75-2 2v1.5c0 1-.5 1.75-1.25 2.25.75.5 1.25 1.25 1.25 2.25v1.5c0 1.25.75 2 2 2h.75M10 2.25h.75c1.25 0 2 .75 2 2v1.5c0 1 .5 1.75 1.25 2.25-.75.5-1.25 1.25-1.25 2.25v1.5c0 1.25-.75 2-2 2H10"/>`,
  // Site details: the site's card — its mark, its name, its line.
  "site-details": `<rect class="i-t" x="1.75" y="3.25" width="12.5" height="9.5" rx="1"/><rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1"/><path class="i-af" d="M4 5.5h3.5V9H4z"/><path d="M9.5 6.25H12M9.5 8.25H12M4 10.75h8"/>`,
  // Navigation: the menu, with the pencil pointing at the page you're on.
  navigation: `<path d="M2 2.75h12M6.5 7.75H14M2 12.75h12"/><path class="i-a" d="m2.25 5.5 2.25 2.25L2.25 10"/>`,
  // Scripts: a tag the page loads.
  scripts: `<path d="M5 4.25 1.5 7.75 5 11.25M10.5 4.25 14 7.75l-3.5 3.5"/><path class="i-a" d="m9 2.5-2.5 10.5"/>`,
  // Forms: a label, a field, the button.
  form: `<rect class="i-t" x="2.25" y="2.25" width="11.5" height="4.5" rx="1"/><rect x="2.25" y="2.25" width="11.5" height="4.5" rx="1"/><path class="i-a" d="M4.75 3.5v2"/><rect x="2.25" y="9.25" width="11.5" height="4.5" rx="1"/>`,
  // Search & AI: how the page reads in a list of results.
  visibility: `<path d="M2 3.25h12M2 6.25h4.5M2 9.25h2.5"/><circle cx="10.25" cy="9.75" r="2.75"/><path class="i-a" d="m12.25 11.75 2 2"/>`,
  // Brand: a colour bar, the printer's strip of inks.
  brand: `<path d="M1.5 13.5 5.25 2.5h1L10 13.5M3.25 9.75h5"/><rect class="i-af" x="10.5" y="9" width="4" height="4.5" rx=".5"/>`,
  // Sites: a stack of proofs.
  sites: `<path d="M5.25 2.25h5.5M3.75 4.25h8.5"/><rect class="i-t" x="2.25" y="6.25" width="11.5" height="7.5" rx="1"/><rect class="i-a" x="2.25" y="6.25" width="11.5" height="7.5" rx="1"/>`,
  plugin: `<path class="i-a" d="M6 1.5v3.25M9.5 1.5v3.25"/><path d="M3.5 4.75h8.5v2.5a4.25 4.25 0 0 1-8.5 0z"/><path d="M7.75 11.5v3"/>`,
  folder: `<path d="M2.25 3.25h4.25l1.5 1.75h5.75v8H2.25z"/>`,
  "folder-site": `<path class="i-t" d="M2.25 3.25h4.25l1.5 1.75h5.75v8H2.25z"/><path d="M2.25 3.25h4.25l1.5 1.75h5.75v8H2.25z"/><path class="i-a" d="m5.5 11.25 2.25-3.5 2.25 3.5"/>`,
  inbox: `<path class="i-t" d="M2.25 9.25 4 2.75h7.5l1.75 6.5v4.5h-11z"/><path d="M2.25 9.25 4 2.75h7.5l1.75 6.5v4.5h-11z"/><path class="i-a" d="M2.25 9.25h3.5l1 1.5h2l1-1.5h3.5"/>`,
  globe: `<circle cx="8" cy="8" r="5.75"/><path d="M2.25 8h11.5"/><path class="i-a" d="M8 2.25C6.25 3.75 5.5 5.75 5.5 8s.75 4.25 2.5 5.75c1.75-1.5 2.5-3.5 2.5-5.75S9.75 3.75 8 2.25"/>`,
  link: `<path d="M6.75 9.25a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5l-.75.75"/><path class="i-a" d="M9.25 6.75a2.5 2.5 0 0 0-3.5 0l-2.5 2.5a2.5 2.5 0 0 0 3.5 3.5l.75-.75"/>`,
  key: `<circle class="i-a" cx="5.25" cy="10.75" r="3"/><path d="m7.5 8.5 6-6M11.25 4.75 13 6.5"/>`,
  chat: `<path d="M3.25 2.25h9.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-3.25 2.5v-2.5h-.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"/><path class="i-a" d="M5 5.25h6M5 8.25h3.5"/>`,
  window: `<path class="i-t" d="M2.75 2.75h10.5a1 1 0 0 1 1 1v2h-12.5v-2a1 1 0 0 1 1-1z"/><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1"/><path d="M1.75 5.75h12.5"/><circle class="i-af" cx="4" cy="4.25" r=".75"/><circle class="i-f" cx="6.25" cy="4.25" r=".75"/>`,
  terminal: `<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1"/><path d="m4.5 6 2 1.75-2 1.75"/><path class="i-a" d="M8 10.25h3.5"/>`,
  publish: `<path class="i-a" d="M7.75 11V2.5M4.25 6l3.5-3.5 3.5 3.5"/><path d="M2 13.75h11.5"/>`,

  // ── actions ────────────────────────────────────────────────────────────
  plus: `<path d="M7.75 2.5V13M2.5 7.75H13"/>`,
  close: `<path d="m3.5 3.5 8.5 8.5M12 3.5 3.5 12"/>`,
  search: `<circle cx="7" cy="7" r="4.75"/><path class="i-a" d="m10.5 10.5 3.75 3.75"/>`,
  clone: `<path class="i-a" d="M7.75 1.75v8.5M4.25 6.75l3.5 3.5 3.5-3.5"/><path d="M2 13.25h11.5"/>`,
  upload: `<path class="i-a" d="M7.75 10.5V2M4.5 5.25 7.75 2 11 5.25"/><path d="M2.25 9.25v4.5h11v-4.5"/>`,
  download: `<path class="i-a" d="M7.75 2v8.5M4.5 7.25l3.25 3.25L11 7.25"/><path d="M2.25 9.25v4.5h11v-4.5"/>`,
  external: `<path d="M12.75 9.25v4.5H2.25V3.25h4.5"/><path class="i-a" d="M9.25 2.25h4.5v4.5M13.75 2.25 7.5 8.5"/>`,
  refresh: `<path d="M13.25 8a5.25 5.25 0 1 1-1.55-3.7"/><path class="i-a" d="M13.75 2.5v3h-3"/>`,
  undo: `<path d="M5 6.25h5.25a3 3 0 0 1 0 6H6.5"/><path class="i-a" d="M7.5 3.75 5 6.25l2.5 2.5"/>`,
  trash: `<path d="M2 4.25h11.5M6 4.25v-2h3.5v2M3.75 4.25l.75 9.5h6.5l.75-9.5"/><path class="i-a" d="M6.25 7v4M9.25 7v4"/>`,
  copy: `<rect class="i-t" x="5.25" y="5.25" width="8.5" height="8.5" rx="1"/><rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1"/><path d="M2.25 10.75v-7.5a1 1 0 0 1 1-1h7.5"/>`,
  check: `<path d="m2.5 8.25 3.5 3.5 7.5-7.5"/>`,
  play: `<path class="i-f" d="M4.5 2.5v11L13 8z"/>`,
  pause: `<path class="i-f" d="M4 2.5h2.5v11H4zM9 2.5h2.5v11H9z"/>`,
  stop: `<rect class="i-f" x="3.5" y="3.5" width="8.5" height="8.5" rx="1"/>`,
  more: `<circle class="i-f" cx="3.25" cy="8" r="1.25"/><circle class="i-f" cx="7.75" cy="8" r="1.25"/><circle class="i-f" cx="12.25" cy="8" r="1.25"/>`,
  grip: `<circle class="i-f" cx="5.75" cy="3.75" r="1"/><circle class="i-f" cx="9.75" cy="3.75" r="1"/><circle class="i-f" cx="5.75" cy="8" r="1"/><circle class="i-f" cx="9.75" cy="8" r="1"/><circle class="i-f" cx="5.75" cy="12.25" r="1"/><circle class="i-f" cx="9.75" cy="12.25" r="1"/>`,
  eye: `<path d="M1.5 8S3.75 3.75 8 3.75 14.5 8 14.5 8 12.25 12.25 8 12.25 1.5 8 1.5 8z"/><circle class="i-af" cx="8" cy="8" r="2"/>`,
  pin: `<path d="M5.5 2.25h4.5M6.5 2.25v3.5l-2 3.5h6.5l-2-3.5v-3.5"/><path class="i-a" d="M7.75 9.25v5"/>`,
  expand: `<path d="M2.25 6V2.25H6M9.5 2.25h3.75V6M13.25 9.5v3.75H9.5M6 13.25H2.25V9.5"/>`,
  warning: `<path d="M7.75 1.75 14.25 13.25h-13z"/><path class="i-a" d="M7.75 6v3.5"/><circle class="i-af" cx="7.75" cy="11.25" r=".9"/>`,

  // ── direction ──────────────────────────────────────────────────────────
  "chevron-down": `<path d="m4 6 3.75 3.75L11.5 6"/>`,
  "chevron-right": `<path d="m6 4 3.75 3.75L6 11.5"/>`,
  "chevron-left": `<path d="M9.5 4 5.75 7.75 9.5 11.5"/>`,
  "chevron-up-down": `<path d="m4.75 5.75 3-3 3 3M4.75 9.75l3 3 3-3"/>`,
  "arrow-up": `<path d="M7.75 13.5V2.5M3.5 6.75 7.75 2.5 12 6.75"/>`,
  "arrow-down": `<path d="M7.75 2v11M3.5 8.75 7.75 13 12 8.75"/>`,

  // ── layout and views ───────────────────────────────────────────────────
  columns: `<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1"/><path d="M7.75 2.75v10.5"/>`,
  "panel-left": `<path class="i-t" d="M2.25 3.75a1 1 0 0 1 1-1h3v10.5h-3a1 1 0 0 1-1-1z"/><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1"/><path class="i-a" d="M6.25 2.75v10.5"/>`,
  "panel-right": `<path class="i-t" d="M9.75 2.75h3a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-3z"/><rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1"/><path class="i-a" d="M9.75 2.75v10.5"/>`,
  cards: `<rect x="2.25" y="2.25" width="4.5" height="4.5" rx=".75"/><rect x="9.25" y="2.25" width="4.5" height="4.5" rx=".75"/><rect x="2.25" y="9.25" width="4.5" height="4.5" rx=".75"/><rect x="9.25" y="9.25" width="4.5" height="4.5" rx=".75"/>`,
  rows: `<path d="M2 3.25h12M2 7.75h12M2 12.25h12"/>`,

  // ── theme ──────────────────────────────────────────────────────────────
  sun: `<circle class="i-a" cx="8" cy="8" r="2.75"/><path d="M8 1v1.75M8 13.25V15M1 8h1.75M13.25 8H15M3.05 3.05l1.24 1.24M11.71 11.71l1.24 1.24M3.05 12.95l1.24-1.24M11.71 4.29l1.24-1.24"/>`,
  moon: `<path class="i-a" d="M13.25 9.75A5.75 5.75 0 1 1 6.25 2.75a4.75 4.75 0 0 0 7 7z"/>`,
  "theme-system": `<circle cx="8" cy="8" r="5.75"/><path class="i-f" d="M8 2.25a5.75 5.75 0 0 1 0 11.5z"/>`,

  // ── text (the body editor's toolbar) ──────────────────────────────────
  bold: `<path d="M4.5 2.5h4.25a2.63 2.63 0 0 1 0 5.25H4.5zM4.5 7.75h4.75a3 3 0 0 1 0 6H4.5z" style="stroke-width:calc(var(--icon-stroke,1.5) * 1.333)"/>`,
  italic: `<path d="M6.5 2.25h6M3 13.75h6M9.75 2.25 5.75 13.75"/>`,
  heading: `<path d="M2.75 2.5v11M8.75 2.5v11M2.75 7.75h6"/><path class="i-a" d="M11.25 9.25 13 8.5v5"/>`,
  quote: `<path class="i-a" d="M2.75 2.5v11"/><path d="M6 3.25h8M6 7.75h8M6 12.25h5"/>`,
  "list-bullet": `<circle class="i-f" cx="3" cy="3.25" r="1.1"/><circle class="i-f" cx="3" cy="7.75" r="1.1"/><circle class="i-f" cx="3" cy="12.25" r="1.1"/><path d="M6 3.25h8M6 7.75h8M6 12.25h8"/>`,
  "list-number": `<path d="M6.5 3.25H14M6.5 7.75H14M6.5 12.25H14"/><path class="i-a" d="M2 2.5l1.25-.75V5.5M1.75 9.25c.25-.75 2.25-.75 2.25.5 0 .75-2.25 1.75-2.25 2.5H4.5" style="stroke-width:calc(var(--icon-stroke,1.5) * .833)"/>`,
  code: `<path d="M5.25 4 1.5 7.75l3.75 3.75M10.25 4 14 7.75l-3.75 3.75"/>`,

  // ── proof marks (the brand's glyphs, scaled from their 12-unit grid) ───
  caret: `<path d="M2.1 13.9 8 4.3l5.9 9.6" style="stroke-width:calc(var(--icon-stroke,1.5) * 1.467)"/>`,
  dele: `<path d="M1.1 9.9h7.5c2.9 0 4.5-1.7 4-3.6-.5-1.7-2.9-1.9-3.5-.1-.7 2.3 1.7 4.8 5.9 5.2" stroke-linecap="round" style="stroke-width:calc(var(--icon-stroke,1.5) * 1.267)"/>`,
  transpose: `<path d="M1.6 11.5C3.5 4 6.7 3.2 8 8s4.5 4 6.4-3.5" stroke-linecap="round" style="stroke-width:calc(var(--icon-stroke,1.5) * 1.333)"/>`,
  stet: `<circle class="i-f" cx="2.7" cy="9.3" r="1.7"/><circle class="i-f" cx="8" cy="9.3" r="1.7"/><circle class="i-f" cx="13.3" cy="9.3" r="1.7"/>`,
  registration: `<circle class="i-a" cx="8" cy="8" r="4.1"/><path d="M.7 8h14.6M8 .7v14.6"/>`,
  pilcrow: `<path d="M6.9 2h7.1M9.3 2v12.7M12.5 2v12.7" style="stroke-width:calc(var(--icon-stroke,1.5) * 1.133)"/><path class="i-f" d="M9.3 2H7.2a3.2 3.2 0 0 0 0 6.4h2.1z"/>`,
} as const;

export type IconName = keyof typeof ICONS;

/** Stroke in grid units for a rendered size, so the line on screen grows slowly with the icon. */
export function iconStroke(size: number): number {
  if (size <= 16) return 1.5;
  if (size <= 20) return 1.4;
  if (size <= 24) return 1.333;
  if (size <= 32) return 1.125;
  return 0.917;
}
