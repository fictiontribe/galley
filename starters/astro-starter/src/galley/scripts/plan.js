// Vendored from @galley/astro 0.4.8 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// scripts.json → what one page gets, and the HTML for each place it goes.
// Used by the integration's middleware (no template changes), by <Scripts />
// for sites that place things themselves, by the build summary and by the
// dev-only manifest at /__galley/scripts.json.
//
// Every snippet goes into the page inert — <script type="text/plain"> — and
// only the inline runtime (runtime.js) turns it into a running script, after
// checking consent, the load moment and whether the page is in the editor's
// preview. <noscript> fallbacks are written only for scripts that need no
// consent, because a page without JavaScript can't ask for it.

import { SCRIPT_INTEGRATIONS } from "../catalog-data.js";
import { inScope } from "../shared/glob.js";
import { BANNER_CSS, renderBanner } from "./banner.js";
import { RUNTIME } from "./runtime.gen.js";
import { buildSnippet } from "./snippets.js";

/** @typedef {import("../kit").ScriptsConfig} ScriptsConfig */
/** @typedef {import("../kit").ScriptEntry} ScriptEntry */
/** @typedef {import("../kit").ConsentCategory} ConsentCategory */
/** @typedef {import("./snippets.js").ScriptPart} ScriptPart */
/** @typedef {"head" | "body-start" | "body-end"} Placement */

/**
 * @typedef {object} ResolvedEntry
 * @property {ScriptEntry} entry
 * @property {string} name
 * @property {ConsentCategory} consent
 * @property {Placement} placement
 * @property {"eager" | "idle" | "interaction"} load
 * @property {ScriptPart[]} parts
 */

/**
 * @typedef {object} PagePlan
 * @property {ResolvedEntry[]} entries  The entries this page carries.
 * @property {boolean} runtime  Whether the page needs the inline runtime at all.
 * @property {boolean} banner
 * @property {ConsentCategory[]} categories  Optional categories used anywhere on the site.
 * @property {Record<string, unknown>} config  The runtime's configuration.
 * @property {(category: ConsentCategory) => boolean} grantedByDefault
 */

export const PLACEMENTS = /** @type {const} */ (["head", "body-start", "body-end"]);
const ORDER = /** @type {ConsentCategory[]} */ (["analytics", "marketing", "preferences"]);

/**
 * Every enabled entry with its consent, placement, load moment and parts.
 * Throws (a ScriptSettingsError) on an id that doesn't fit its integration.
 *
 * @param {ScriptsConfig} config
 * @returns {ResolvedEntry[]}
 */
export function resolveEntries(config) {
  return config.scripts
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const info = SCRIPT_INTEGRATIONS.find((item) => item.kind === entry.kind);

      return {
        entry,
        name: entry.label ?? info?.name ?? entry.kind,
        consent: entry.consent ?? info?.defaultConsent ?? "marketing",
        placement: entry.placement ?? info?.defaultPlacement ?? "body-end",
        load: entry.load ?? "eager",
        parts: buildSnippet(entry),
      };
    });
}

/**
 * @param {ScriptsConfig | null | undefined} config
 * @param {{ path: string; dev?: boolean; host?: string; utm?: boolean; resolved?: ResolvedEntry[] }} page
 * @returns {PagePlan}
 */
export function planPage(config, page) {
  const consent = config?.consent ?? { mode: "none" };
  const all = config ? page.resolved ?? resolveEntries(config) : [];
  const entries = all.filter(({ entry }) => inScope(page.path, entry) && (!page.dev || entry.inPreview === true));
  // UTM memory for forms is marketing attribution: under a consent mode it is
  // stored only once "marketing" is granted, so a site whose forms use it
  // offers Marketing in the banner even when no script needs it (docs/scripts.md).
  const categories = ORDER.filter((category) => all.some((item) => item.consent === category) || (category === "marketing" && Boolean(page.utm)));
  const defaults = consent.defaults ?? [];
  const grantedByDefault = (/** @type {ConsentCategory} */ category) => category === "necessary" || consent.mode === "none" || defaults.includes(category);
  const banner = consent.mode === "banner" && categories.length > 0;
  const runtime = entries.length > 0 || banner || Boolean(page.utm) || (consent.mode !== "none" && Boolean(consent.googleConsentMode));

  return {
    entries,
    runtime,
    banner,
    categories,
    grantedByDefault,
    config: { mode: consent.mode, defaults, gcm: Boolean(consent.googleConsentMode), host: page.host ?? "", utm: Boolean(page.utm) },
  };
}

/** Script text that can sit inside <script>…</script> without ending it early. */
const scriptText = (/** @type {string} */ code) => code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
/** @param {string} value */
const attr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The constant text of the runtime's inline script for this configuration. */
export function runtimeScript(/** @type {PagePlan} */ plan) {
  return `(${RUNTIME})(${JSON.stringify(plan.config)})`;
}

/** @param {Placement} placement */
export const runCall = (placement) => `galleyScripts.run("${placement}")`;

/**
 * The HTML for one placement of one page ("" when it has nothing).
 *
 * @param {PagePlan} plan
 * @param {Placement} placement
 * @param {{ consent?: import("../kit").ConsentSettings; base?: string }} [extra]  `base`: the site's base path.
 */
export function renderPlacement(plan, placement, extra = {}) {
  if (!plan.runtime) return "";
  let html = "";

  if (placement === "head") {
    html += `<script data-galley-scripts="head">${runtimeScript(plan)}</script>`;
    if (plan.banner) html += `<style data-galley-consent-style>${BANNER_CSS}</style>`;
  }
  let blocks = 0;

  for (const item of plan.entries) {
    for (const [index, part] of item.parts.entries()) {
      const at = part.placement ?? item.placement;

      if (at !== placement) continue;
      if (part.type === "noscript") {
        if (plan.grantedByDefault(item.consent)) html += `<noscript data-galley-script="${attr(item.entry.id)}">${part.html ?? ""}</noscript>`;
        continue;
      }
      blocks += 1;
      html +=
        `<script type="text/plain" data-galley-script="${attr(item.entry.id)}" data-part="${index}" data-placement="${placement}" data-consent="${item.consent}" data-load="${item.load}"` +
        (item.entry.inPreview ? " data-preview" : "") +
        (part.src ? ` data-src="${attr(part.src)}"` : "") +
        (part.attrs && Object.keys(part.attrs).length > 0 ? ` data-attrs="${attr(JSON.stringify(part.attrs))}"` : "") +
        `>${part.src ? "" : scriptText(part.code ?? "")}</script>`;
    }
  }
  if (placement === "body-end" && plan.banner && extra.consent) html += renderBanner(extra.consent, plan.categories, { base: extra.base });
  if (blocks > 0 || placement === "body-end") html += `<script data-galley-scripts="${placement}">${runCall(placement)}</script>`;
  return html;
}

/**
 * Puts each placement's HTML into a finished page: the head part right after
 * <meta charset> (else right after <head>), body-start right after <body>,
 * body-end before </body>. A placement the page already carries (because the
 * layout uses <Scripts />) is left alone.
 *
 * @param {string} html
 * @param {PagePlan} plan
 * @param {{ consent?: import("../kit").ConsentSettings; base?: string }} [extra]
 */
export function injectPlan(html, plan, extra = {}) {
  if (!plan.runtime) return html;
  let out = html;
  const has = (/** @type {Placement} */ placement) => out.includes(`data-galley-scripts="${placement}"`);

  if (!has("head")) {
    const head = renderPlacement(plan, "head", extra);
    const charset = /<meta[^>]+charset[^>]*>/i.exec(out);
    const headOpen = /<head\b[^>]*>/i.exec(out);
    const at = charset && headOpen && charset.index > headOpen.index ? charset.index + charset[0].length : headOpen ? headOpen.index + headOpen[0].length : -1;

    if (at >= 0) out = out.slice(0, at) + head + out.slice(at);
  }
  if (!has("body-start")) {
    const start = renderPlacement(plan, "body-start", extra);
    const body = /<body\b[^>]*>/i.exec(out);

    if (start && body) out = out.slice(0, body.index + body[0].length) + start + out.slice(body.index + body[0].length);
  }
  if (!has("body-end")) {
    // A layout that renders <ConsentBanner /> itself keeps its own.
    const end = renderPlacement(plan, "body-end", /data-galley-consent[\s>]/.test(out) ? { base: extra.base } : extra);
    const close = out.toLowerCase().lastIndexOf("</body>");

    if (end) out = close >= 0 ? out.slice(0, close) + end + out.slice(close) : out + end;
  }
  return out;
}

/**
 * What the build log says: which scripts load on the site and under which
 * consent, one line each.
 *
 * @param {ScriptsConfig} config
 * @returns {string[]}
 */
export function summarize(config) {
  const consent = config.consent ?? { mode: "none" };
  const resolved = resolveEntries(config);
  const mode = consent.mode === "banner" ? "the built-in consent banner" : consent.mode === "external" ? "another consent tool (galleyConsent.set / Consent Mode / Cookiebot)" : "no consent step";
  const lines = [`scripts: ${resolved.length} of ${config.scripts.length} enabled · ${mode}${consent.googleConsentMode ? " · Google Consent Mode v2" : ""}`];

  for (const item of resolved) {
    const id = Object.values(item.entry.settings).find((value) => typeof value === "string" && /^[A-Za-z0-9-]{4,}$/.test(value));
    const when = item.consent === "necessary" || consent.mode === "none" ? "always" : `after ${item.consent} consent`;
    const where = item.entry.include?.length ? `only ${item.entry.include.join(", ")}` : "every page";
    const except = item.entry.exclude?.length ? ` except ${item.entry.exclude.join(", ")}` : "";

    lines.push(`  ✓ ${item.entry.id} · ${item.name}${id ? ` ${id}` : ""} · ${item.placement}, ${item.load} · ${when} · ${where}${except}`);
  }
  for (const entry of config.scripts.filter((item) => !item.enabled)) lines.push(`  – ${entry.id} · off`);
  return lines;
}

/**
 * The dev-only manifest: what a given page would load in production.
 *
 * @param {ScriptsConfig | null} config
 * @param {string} path
 * @param {string} file  The scripts file, relative to the site.
 */
export function manifest(config, path, file) {
  if (!config) return { file, exists: false, path, consent: { mode: "none" }, scripts: [] };
  const resolved = resolveEntries(config);

  return {
    file,
    exists: true,
    path,
    consent: config.consent ?? { mode: "none" },
    scripts: config.scripts.map((entry) => {
      const item = resolved.find((candidate) => candidate.entry === entry);
      const onPage = Boolean(item) && inScope(path, entry);

      return {
        id: entry.id,
        kind: entry.kind,
        label: item?.name ?? entry.label ?? entry.kind,
        enabled: entry.enabled,
        consent: item?.consent ?? entry.consent ?? null,
        placement: item?.placement ?? entry.placement ?? null,
        load: item?.load ?? entry.load ?? "eager",
        inPreview: entry.inPreview === true,
        loadsOnPage: onPage,
        reason: !entry.enabled ? "turned off" : onPage ? (item?.consent === "necessary" || (config.consent?.mode ?? "none") === "none" ? "loads" : `loads after ${item?.consent} consent`) : "not on this page (include/exclude)",
        inDev: onPage && entry.inPreview === true,
      };
    }),
  };
}
