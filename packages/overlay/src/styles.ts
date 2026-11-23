/**
 * The overlay's only styles, injected once as one <style> element. Every
 * selector is namespaced so nothing reaches the site's own elements unless
 * the overlay put a class on them; outlines and a fixed-position tag never
 * move the page's layout.
 *
 * The page is somebody else's site, so the app's design tokens aren't
 * available here. Until the host sends its look (`appearance`), the colours
 * are the brand's default accent (tokens.json `whiteLabel.default`) and its
 * on-accent ink, with the outline pulled a quarter toward black (toward white
 * in a dark app) as in components.css (`.g-editable-hover`).
 */
export const ACCENT = "#2E2BFF";
export const ACCENT_ON = "#FEFEFE";
const INK_DARK = "#14130F";

export const STYLE_ID = "__galley-overlay-style";
export const HOVER_CLASS = "__galley-hover";
export const ACTIVE_CLASS = "__galley-active";
export const EDITING_CLASS = "__galley-editing";
export const TAG_ATTR = "data-galley-tag";
export const TAG_ACTION_ATTR = "data-galley-tag-action";
/** Arrange mode: a section root the chrome manages (focusable, no native focus ring). */
export const ROOT_ATTR = "data-galley-arrange-root";
/** Arrange mode: the section being dragged, and the sections that moved aside to make room. */
export const LIFTED_CLASS = "__galley-lifted";
export const SHIFTED_CLASS = "__galley-shifted";
export const DRAGGING_CLASS = "__galley-dragging";
/** How far sections move aside to open the slot where a dragged section will land. */
export const ROOM_PX = 48;

export interface Appearance {
  accent: string;
  theme: "light" | "dark";
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Whether a value is a hex colour the overlay will use. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Relative luminance of a hex colour (0 black – 1 white). */
function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const channel = (at: number) => {
    const value = parseInt(full.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Text on the accent: light on dark accents, dark on light ones. */
export function inkOn(accent: string): string {
  return luminance(accent) > 0.45 ? INK_DARK : ACCENT_ON;
}

export function overlayCss({ accent, theme }: Appearance = { accent: ACCENT, theme: "light" }): string {
  const colour = isHexColor(accent) ? accent : ACCENT;
  const outline = `color-mix(in oklab, ${colour} 75%, ${theme === "dark" ? "#fff" : "#000"})`;
  const ink = inkOn(colour);
  return `
.${HOVER_CLASS}{outline:1.5px dashed ${outline}!important;outline-offset:3px!important;border-radius:2px;cursor:text!important}
img.${HOVER_CLASS}{cursor:pointer!important}
.${ACTIVE_CLASS}{outline:2px solid ${outline}!important;outline-offset:3px!important;border-radius:2px}
.${EDITING_CLASS}{outline:2px solid ${outline}!important;outline-offset:3px!important;border-radius:2px;cursor:text!important;caret-color:${outline}}
[${TAG_ATTR}]{all:initial;position:fixed;z-index:2147483647;pointer-events:none;display:flex;align-items:center;gap:2px;box-sizing:border-box;padding:3px;border-radius:999px;background:${colour};color:${ink};font:600 11px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.01em;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.18),0 4px 12px rgba(0,0,0,.14);opacity:0;transition:opacity .12s ease}
[${TAG_ATTR}][data-theme=dark]{box-shadow:0 0 0 1px rgba(255,255,255,.28),0 4px 12px rgba(0,0,0,.4)}
[${TAG_ATTR}][data-show]{opacity:1}
[${TAG_ATTR}] span{all:unset;padding:2px 5px}
[${TAG_ATTR}] button{all:unset;pointer-events:auto;cursor:pointer;padding:2px 7px;border-radius:999px;background:color-mix(in oklab, ${ink} 18%, transparent)}
[${TAG_ATTR}] button:hover{background:color-mix(in oklab, ${ink} 30%, transparent)}
[${ROOT_ATTR}]:focus{outline:none!important}
.${LIFTED_CLASS}{opacity:.35!important}
.${SHIFTED_CLASS}{translate:0 ${ROOM_PX}px!important}
html.${DRAGGING_CLASS} [${ROOT_ATTR}]{transition:translate .16s ease}
html.${DRAGGING_CLASS},html.${DRAGGING_CLASS} *{cursor:grabbing!important;user-select:none!important}
@media (prefers-reduced-motion:reduce){[${TAG_ATTR}],html.${DRAGGING_CLASS} [${ROOT_ATTR}]{transition:none}}
`;
}

/** The default stylesheet, before the host says otherwise. */
export const OVERLAY_CSS = overlayCss();

/** Adds the overlay's <style> once; returns it. */
export function injectStyles(doc: Document): Element {
  const existing = doc.getElementById(STYLE_ID);
  if (existing) return existing;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = OVERLAY_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
  return style;
}

/** Recolour the overlay to the app's accent and theme. */
export function applyAppearance(doc: Document, appearance: Appearance): void {
  const style = injectStyles(doc);
  style.textContent = overlayCss(appearance);
}
