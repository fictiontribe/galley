// Vendored from @galley/astro 0.4.9 by scripts/vendor.mjs. Don't edit: run the script again to update.
// @ts-check
// One snippet builder per known integration, each written from the vendor's
// current install code with only the ids from `settings` substituted (the
// README lists the page each was checked against). A builder returns the
// snippet as parts — scripts to load, inline code to run, <noscript>
// fallbacks — and the runtime decides when each part may run (consent,
// load strategy, preview). Ids are checked against the catalogue's patterns
// first, so a wrong id is a build error with a plain message, never a broken
// tag in the page.

import { SCRIPT_INTEGRATIONS } from "../catalog-data.js";

/** @typedef {import("../kit").ScriptEntry} ScriptEntry */
/**
 * @typedef {object} ScriptPart
 * @property {"script" | "noscript"} type
 * @property {string} [src]  An external script.
 * @property {Record<string, string | true>} [attrs]  Attributes for the <script> (async, defer, id, data-…).
 * @property {string} [code]  Inline code, run as written.
 * @property {string} [html]  For "noscript": the fallback's inner HTML.
 * @property {"head" | "body-start" | "body-end"} [placement]  When the part must sit somewhere else than its entry (GTM's frame).
 */

export class ScriptSettingsError extends Error {}

/** @param {ScriptEntry} entry @param {string} key */
function setting(entry, key) {
  const value = entry.settings[key];

  return value === undefined || value === null ? "" : String(value);
}

/**
 * Checks the entry's settings against its integration's patterns.
 *
 * @param {ScriptEntry} entry
 * @throws {ScriptSettingsError}
 */
export function checkSettings(entry) {
  const info = SCRIPT_INTEGRATIONS.find((item) => item.kind === entry.kind);

  // A kind this kit has no builder for (one a plugin adds to the app's
  // catalogue) is written like "custom": from settings.src / settings.inline,
  // under the same consent and placement rules.
  if (!info) {
    if (!setting(entry, "src") && !setting(entry, "inline")) {
      throw new ScriptSettingsError(`“${entry.id}” is a “${entry.kind}” script, which this version of the kit can't write by itself. Give it settings.src (the script's address) or settings.inline (its code).`);
    }
    return;
  }
  for (const field of info.settings) {
    const value = setting(entry, field.key);

    if (!value) {
      if (field.required) throw new ScriptSettingsError(`“${entry.id}” (${info.name}) needs its ${field.label} in settings.${field.key}${field.placeholder ? `, like ${field.placeholder}` : ""}.`);
      continue;
    }
    if (field.pattern && !new RegExp(field.pattern).test(value)) {
      throw new ScriptSettingsError(`“${entry.id}”: “${value}” doesn't look like a ${info.name} ${field.label}${field.placeholder ? ` (it looks like ${field.placeholder})` : ""}.`);
    }
  }
}

/** @type {Record<string, (entry: ScriptEntry) => ScriptPart[]>} */
export const BUILDERS = {
  // support.google.com/tagmanager/answer/14847097 — the current one-part
  // snippet, plus (on request) the previous version's <noscript> frame.
  gtm(entry) {
    const id = setting(entry, "containerId");
    /** @type {ScriptPart[]} */
    const parts = [
      { type: "script", src: `https://www.googletagmanager.com/gtm.js?id=${id}`, attrs: { async: true } },
      { type: "script", code: "window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());" },
    ];

    if (setting(entry, "noscript") === "true") {
      parts.push({
        type: "noscript",
        placement: "body-start",
        html: `<iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`,
      });
    }
    return parts;
  },

  // developers.google.com/tag-platform/gtagjs/install (+ /configure for the config command).
  ga4(entry) {
    const id = setting(entry, "measurementId");

    return [
      { type: "script", src: `https://www.googletagmanager.com/gtm.js?id=${id}`, attrs: { async: true } },
      { type: "script", code: `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', '${id}');` },
    ];
  },

  // developers.facebook.com/docs/meta-pixel/get-started — the base code.
  "meta-pixel"(entry) {
    const id = setting(entry, "pixelId");

    return [
      {
        type: "script",
        code: `!function(f,b,e,v,n,t,s)\n{if(f.fbq)return;n=f.fbq=function(){n.callMethod?\nn.callMethod.apply(n,arguments):n.queue.push(arguments)};\nif(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';\nn.queue=[];t=b.createElement(e);t.async=!0;\nt.src=v;s=b.getElementsByTagName(e)[0];\ns.parentNode.insertBefore(t,s)}(window, document,'script',\n'https://connect.facebook.net/en_US/fbevents.js');\nfbq('init', '${id}');\nfbq('track', 'PageView');`,
      },
      { type: "noscript", html: `<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${id}&amp;ev=PageView&amp;noscript=1" alt="">` },
    ];
  },

  // The Insight Tag as Campaign Manager issues it (Signals manager › Insight Tag).
  "linkedin-insight"(entry) {
    const id = setting(entry, "partnerId");

    return [
      { type: "script", code: `_linkedin_partner_id = "${id}";\nwindow._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];\nwindow._linkedin_data_partner_ids.push(_linkedin_partner_id);` },
      {
        type: "script",
        code: `(function(l) {\nif (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};\nwindow.lintrk.q=[]}\nvar s = document.getElementsByTagName("script")[0];\nvar b = document.createElement("script");\nb.type = "text/javascript";b.async = true;\nb.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";\ns.parentNode.insertBefore(b, s);})(window.lintrk);`,
      },
      { type: "noscript", html: `<img height="1" width="1" style="display:none;" alt="" src="https://px.ads.linkedin.com/collect/?pid=${id}&amp;fmt=gif">` },
    ];
  },

  // The HubSpot embed code (Settings › Tracking code), before </body>.
  hubspot(entry) {
    const id = setting(entry, "portalId");
    const region = setting(entry, "region");
    const host = region && region !== "na1" ? `js-${region}.hs-scripts.com` : "js.hs-scripts.com";

    return [{ type: "script", src: `//${host}/${id}.js`, attrs: { type: "text/javascript", id: "hs-script-loader", async: true, defer: true } }];
  },

  // experienceleague.adobe.com … /javascriptapi/leadtracking/lead-tracking — the asynchronous embed.
  "marketo-munchkin"(entry) {
    const id = setting(entry, "munchkinId");

    return [
      {
        type: "script",
        code: `(function() {\n  var didInit = false;\n  function initMunchkin() {\n    if(didInit === false) {\n      didInit = true;\n      Munchkin.init('${id}');\n    }\n  }\n  var s = document.createElement('script');\n  s.type = 'text/javascript';\n  s.async = true;\n  s.src = '//munchkin.marketo.net/munchkin.js';\n  s.onreadystatechange = function() {\n    if (this.readyState == 'complete' || this.readyState == 'loaded') {\n      initMunchkin();\n    }\n  };\n  s.onload = initMunchkin;\n  document.getElementsByTagName('head')[0].appendChild(s);\n})();`,
      },
    ];
  },

  // plausible.io/docs/plausible-script — the per-site script (Oct 2025 on);
  // the older data-domain script for sites that give a domain instead.
  plausible(entry) {
    const host = (setting(entry, "host") || "https://plausible.io").replace(/\/+$/, "");
    const scriptId = setting(entry, "scriptId");

    if (scriptId) {
      return [
        { type: "script", src: `${host}/js/${scriptId}.js`, attrs: { async: true } },
        { type: "script", code: "window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};\nplausible.init()" },
      ];
    }
    return [{ type: "script", src: `${host}/js/script.js`, attrs: { defer: true, "data-domain": setting(entry, "domain") } }];
  },

  // twilio.com/docs/segment/connections/sources/catalog/libraries/website/javascript/quickstart — "Minified", snippet 5.2.1.
  segment(entry) {
    const key = setting(entry, "writeKey");

    return [
      {
        type: "script",
        code: `!function(){var i="analytics",analytics=window[i]=window[i]||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","pageview","identify","reset","group","track","ready","alias","debug","page","screen","once","off","on","addSourceMiddleware","addIntegrationMiddleware","setAnonymousId","addDestinationMiddleware","register"];analytics.factory=function(e){return function(){if(window[i].initialized)return window[i][e].apply(window[i],arguments);var n=Array.prototype.slice.call(arguments);if(["track","screen","alias","group","page","identify"].indexOf(e)>-1){var c=document.querySelector("link[rel='canonical']");n.push({__t:"bpc",c:c&&c.getAttribute("href")||void 0,p:location.pathname,u:location.href,s:location.search,t:document.title,r:document.referrer})}n.unshift(e);analytics.push(n);return analytics}};for(var n=0;n<analytics.methods.length;n++){var key=analytics.methods[n];analytics[key]=analytics.factory(key)}analytics.load=function(key,n){var t=document.createElement("script");t.type="text/javascript";t.async=!0;t.setAttribute("data-global-segment-analytics-key",i);t.src="https://cdn.segment.com/analytics.js/v1/" + key + "/analytics.min.js";var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r);analytics._loadOptions=n};analytics._writeKey="${key}";;analytics.SNIPPET_VERSION="5.2.1";\nanalytics.load("${key}");\nanalytics.page();\n}}();`,
      },
    ];
  },

  // The Hotjar Tracking Code (Sites & Organizations › Tracking).
  hotjar(entry) {
    const id = setting(entry, "siteId");

    return [
      {
        type: "script",
        code: `(function(h,o,t,j,a,r){\n  h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};\n  h._hjSettings={hjid:${id},hjsv:6};\n  a=o.getElementsByTagName('head')[0];\n  r=o.createElement('script');r.async=1;\n  r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;\n  a.appendChild(r);\n})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');`,
      },
    ];
  },

  // The Clarity tracking code (Settings › Setup › Install manually).
  clarity(entry) {
    const id = setting(entry, "projectId");

    return [
      {
        type: "script",
        attrs: { type: "text/javascript" },
        code: `(function(c,l,a,r,i,t,y){\n  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};\n  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;\n  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);\n})(window, document, "clarity", "script", "${id}");`,
      },
    ];
  },

  // developers.intercom.com/installing-intercom/web/installation — for
  // visitors who aren't signed in (no user_id/email), with the regional API base.
  intercom(entry) {
    const id = setting(entry, "appId");
    const region = setting(entry, "region");
    const base = region === "eu" ? "https://api-iam.eu.intercom.io" : region === "au" ? "https://api-iam.au.intercom.io" : "https://api-iam.intercom.io";

    return [
      { type: "script", code: `window.intercomSettings = {\n  api_base: "${base}",\n  app_id: "${id}",\n};` },
      {
        type: "script",
        code: `(function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic('update',w.intercomSettings);}else{var d=document;var i=function(){i.c(arguments);};i.q=[];i.c=function(args){i.q.push(args);};w.Intercom=i;var l=function(){var s=d.createElement('script');s.type='text/javascript';s.async=true;s.src='https://widget.intercom.io/widget/' + "${id}";var x=d.getElementsByTagName('script')[0];x.parentNode.insertBefore(s, x);};if(document.readyState==='complete'){l();}else if(w.attachEvent){w.attachEvent('onload',l);}else{w.addEventListener('load',l,false);}}})();`,
      },
    ];
  },

  custom(entry) {
    const src = setting(entry, "src");
    const code = setting(entry, "inline");
    const raw = entry.settings.attributes;
    /** @type {Record<string, string | true>} */
    const attrs = {};

    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [name, value] of Object.entries(raw)) if (value !== false && value !== null) attrs[name.toLowerCase()] = value === true ? true : String(value);
    }
    /** @type {ScriptPart[]} */
    const parts = [];

    if (src) parts.push({ type: "script", src, attrs });
    if (code) parts.push({ type: "script", code, ...(src ? {} : { attrs }) });
    return parts;
  },
};

/**
 * The snippet for one entry, after checking its settings.
 *
 * @param {ScriptEntry} entry
 * @returns {ScriptPart[]}
 */
export function buildSnippet(entry) {
  checkSettings(entry);
  const known = SCRIPT_INTEGRATIONS.some((item) => item.kind === entry.kind);
  const build = known ? BUILDERS[entry.kind] : BUILDERS.custom;

  if (!build) throw new ScriptSettingsError(`No snippet builder for “${entry.kind}”.`);
  return build(entry);
}
