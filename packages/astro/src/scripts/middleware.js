// @ts-check
// The integration's middleware: puts the managed scripts (and the consent
// banner) into every HTML page as it is rendered — prerendered pages at build
// time, on-demand pages per request, every page in `astro dev` — so a site
// needs no template change. Placements a layout already renders with
// <Scripts /> are left as they are.
import { HAS_MAILTO, mailtoTag } from "../mailto/config.js";
import { mailto, scripts, utm } from "../runtime/site-config.js";
import { injectPlan, planPage, resolveEntries } from "./plan.js";

const resolved = scripts ? resolveEntries(scripts) : [];
const mailtoHtml = mailto ? mailtoTag(mailto) : "";
const site = import.meta.env.SITE ? new URL(import.meta.env.SITE).hostname : "";
const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

/** @type {import("astro").MiddlewareHandler} */
export const onRequest = async (context, next) => {
  const response = await next();

  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
  const path = base && context.url.pathname.startsWith(base) ? context.url.pathname.slice(base.length) || "/" : context.url.pathname;
  const plan = planPage(scripts, { path, dev: import.meta.env.DEV, host: site, utm, resolved });

  if (!plan.runtime && !mailtoHtml) return response;
  const original = await response.text();
  let html = injectPlan(original, plan, { consent: scripts?.consent, base });

  // The email-link dialog: only on pages with an email link, once.
  if (mailtoHtml && HAS_MAILTO.test(html) && !html.includes("data-galley-mailto-script")) {
    const close = html.toLowerCase().lastIndexOf("</body>");

    html = close >= 0 ? html.slice(0, close) + mailtoHtml + html.slice(close) : html + mailtoHtml;
  }
  if (html === original) return new Response(original, response);
  const headers = new Headers(response.headers);

  headers.delete("content-length");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
