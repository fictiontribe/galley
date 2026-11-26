// Vendored from @galley/astro 0.4.9 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// The built-in consent banner: a small, non-modal region at the foot of the
// page with three equal choices — accept all, reject all, choose — and the
// categories this site actually uses. Server-rendered and hidden; the scripts
// runtime shows it when no choice is stored, and again whenever an element
// with `data-galley-consent-open` is clicked (a footer link, say).
//
// Every word comes from scripts.json → consent.banner, falling back to the
// defaults below (written to brand/voice.md). Styled only through custom
// properties, so a site themes it like its forms.

import { escapeHtml as esc, inlineMarkdown, withBase } from "../shared/markdown.js";

/** @typedef {import("../kit").ConsentSettings} ConsentSettings */
/** @typedef {import("../kit").ConsentCategory} ConsentCategory */

export const BANNER_DEFAULTS = Object.freeze({
  title: "Cookies and tracking",
  text: "This site would like to measure visits and the success of its marketing. Choose what it may use. You can change this at any time from the link at the bottom of each page.",
  acceptLabel: "Accept all",
  rejectLabel: "Reject all",
  settingsLabel: "Choose…",
  saveLabel: "Save choices",
  policyLabel: "Privacy policy",
});

export const CATEGORY_DEFAULTS = Object.freeze({
  necessary: { label: "Necessary", description: "Needed for the site to work. Always on." },
  analytics: { label: "Analytics", description: "Counts visits and shows which pages are used." },
  marketing: { label: "Marketing", description: "Measures ads and remembers visits for campaigns." },
  preferences: { label: "Preferences", description: "Remembers choices such as chat conversations." },
});

/**
 * @param {ConsentSettings} consent
 * @param {ConsentCategory[]} categories  The optional categories the site uses, in order.
 * @param {{ base?: string }} [options]  `base`: the site's base path, for a policyUrl or text links written from the site root.
 */
export function renderBanner(consent, categories, options = {}) {
  const base = options.base ?? "";
  const text = { ...BANNER_DEFAULTS, ...Object.fromEntries(Object.entries(consent.banner ?? {}).filter(([, value]) => typeof value === "string" && value)) };
  /** @param {ConsentCategory} category */
  const category = (category) => ({ ...CATEGORY_DEFAULTS[category], ...(consent.banner?.categories?.[category] ?? {}) });
  const rows = /** @type {ConsentCategory[]} */ (["necessary", ...categories])
    .map((name) => {
      const info = category(name);
      const id = `galley-consent-${name}`;

      return `<div class="galley-consent__category"><input type="checkbox" id="${id}"${name === "necessary" ? " checked disabled" : ` data-category="${name}"`}><label for="${id}"><span class="galley-consent__category-name">${esc(info.label)}</span> <span class="galley-consent__category-text">${esc(info.description)}</span></label></div>`;
    })
    .join("");
  const policy = consent.banner?.policyUrl ? ` <a href="${esc(withBase(consent.banner.policyUrl, base))}">${esc(text.policyLabel)}</a>` : "";

  return (
    `<section class="galley-consent" data-galley-consent aria-labelledby="galley-consent-title" hidden>` +
    `<div class="galley-consent__inner">` +
    `<p class="galley-consent__title" id="galley-consent-title">${esc(text.title)}</p>` +
    `<p class="galley-consent__text">${inlineMarkdown(text.text, { base })}${policy}</p>` +
    `<fieldset class="galley-consent__choices" id="galley-consent-choices" data-galley-consent-choices hidden><legend class="galley-visually-hidden">${esc(text.settingsLabel.replace(/…$/, ""))}</legend>${rows}</fieldset>` +
    `<div class="galley-consent__actions">` +
    `<button type="button" class="galley-consent__button" data-galley-consent-accept>${esc(text.acceptLabel)}</button>` +
    `<button type="button" class="galley-consent__button" data-galley-consent-reject>${esc(text.rejectLabel)}</button>` +
    `<button type="button" class="galley-consent__button galley-consent__button--quiet" data-galley-consent-settings aria-expanded="false" aria-controls="galley-consent-choices">${esc(text.settingsLabel)}</button>` +
    `<button type="button" class="galley-consent__button" data-galley-consent-save hidden>${esc(text.saveLabel)}</button>` +
    `</div></div></section>`
  );
}

/*
 * Custom properties (with fallbacks):
 *   --galley-consent-bg      Canvas           --galley-consent-text    CanvasText
 *   --galley-consent-border  currentColor 25% --galley-consent-radius  0.5rem
 *   --galley-consent-shadow  a soft shadow    --galley-consent-width   44rem
 *   --galley-button-bg / --galley-button-text / --galley-button-radius (shared with forms;
 *     CanvasText on Canvas when unset — never currentColor, which on a button
 *     is its own text colour)
 *   --galley-field-focus     focus ring
 */
export const BANNER_CSS = `.galley-consent [hidden]{display:none!important}.galley-consent{position:fixed;inset-inline:0;inset-block-end:0;z-index:2147483000;display:flex;justify-content:center;padding:0.75rem;pointer-events:none}.galley-consent[hidden]{display:none}.galley-consent__inner{box-sizing:border-box;display:grid;gap:0.75rem;width:min(100%,var(--galley-consent-width,44rem));max-height:calc(100vh - 1.5rem);overflow:auto;padding:1rem 1.25rem;border:1px solid var(--galley-consent-border,color-mix(in srgb,currentColor 25%,transparent));border-radius:var(--galley-consent-radius,0.5rem);background:var(--galley-consent-bg,Canvas);color:var(--galley-consent-text,CanvasText);box-shadow:var(--galley-consent-shadow,0 8px 30px rgb(0 0 0 / 0.18));font:inherit;pointer-events:auto}.galley-consent__title{margin:0;font-weight:700}.galley-consent__text{margin:0}.galley-consent__text a{color:inherit}.galley-consent__choices{display:grid;gap:0.5rem;margin:0;padding:0;border:0}.galley-consent__category{display:grid;grid-template-columns:auto 1fr;gap:0.6rem;align-items:start}.galley-consent__category input{width:1.1em;height:1.1em;margin:0.2em 0 0;accent-color:var(--galley-field-focus,Highlight)}.galley-consent__category-name{font-weight:600}.galley-consent__actions{display:flex;flex-wrap:wrap;gap:0.5rem}.galley-consent__button{min-height:2.5rem;padding:0.5em 1em;border:1px solid var(--galley-button-bg,CanvasText);border-radius:var(--galley-button-radius,0.375rem);background:var(--galley-button-bg,CanvasText);color:var(--galley-button-text,Canvas);font:inherit;font-weight:600;cursor:pointer}.galley-consent__button--quiet{background:transparent;color:inherit}.galley-consent__button:focus-visible,.galley-consent input:focus-visible,.galley-consent a:focus-visible{outline:2px solid var(--galley-field-focus,Highlight);outline-offset:2px}.galley-visually-hidden{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important}`;
