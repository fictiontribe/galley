/**
 * What each host's own documentation says about redirects today: the file it
 * reads, its syntax limits, and how it treats query strings, trailing
 * slashes and capitals. Every number here was read from the page cited next
 * to it (docs/redirects.md has the full notes).
 *
 * Data and type-only imports, so the web app's fixture backend can load this
 * file on its own (`@galley/core/redirects-info`).
 */
import type { RedirectHostId, RedirectHostInfo, RedirectStatus } from "./types";

export type * from "./types";

export const REDIRECT_STATUSES: readonly RedirectStatus[] = [301, 302, 307, 308];

/** The date the host pages below were read. */
export const HOST_DOCS_READ = "2026-11-23";

export const CLOUDFLARE_REDIRECTS_DOCS = "https://developers.cloudflare.com/workers/static-assets/redirects/";
export const CLOUDFLARE_PAGES_REDIRECTS_DOCS = "https://developers.cloudflare.com/pages/configuration/redirects/";
export const CLOUDFLARE_BULK_DOCS = "https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/create-api/";
export const CLOUDFLARE_BULK_PARAMETERS_DOCS = "https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/parameters/";
export const CLOUDFLARE_BULK_LIMITS_DOCS = "https://developers.cloudflare.com/rules/url-forwarding/#availability";
export const NETLIFY_REDIRECTS_DOCS = "https://docs.netlify.com/manage/routing/redirects/overview/";
export const NETLIFY_REDIRECT_OPTIONS_DOCS = "https://docs.netlify.com/manage/routing/redirects/redirect-options/";
export const VERCEL_REDIRECTS_DOCS = "https://vercel.com/docs/project-configuration/vercel-json#redirects";
export const VERCEL_REDIRECT_LIMITS_DOCS = "https://vercel.com/docs/routing/redirects/configuration-redirects";

/**
 * Bulk Redirects per account, by the highest plan on the account
 * (developers.cloudflare.com/rules/url-forwarding/#availability).
 */
export const CLOUDFLARE_BULK_LIMITS = [
  { plan: "Free", rules: 15, lists: 5, redirects: 10_000 },
  { plan: "Pro", rules: 15, lists: 5, redirects: 25_000 },
  { plan: "Business", rules: 15, lists: 5, redirects: 50_000 },
  { plan: "Enterprise", rules: 50, lists: 25, redirects: 1_000_000 },
] as const;

/** The token permissions Bulk Redirects need, as Cloudflare's token screen names them. */
export const CLOUDFLARE_BULK_PERMISSIONS = ["Account › Account Filter Lists › Edit", "Account › Bulk URL Redirects › Edit"];

/** Adding the Bulk Redirects permissions to the key made for putting the site online, step by step (the deploy setup's style). */
export const CLOUDFLARE_BULK_KEY_STEPS = [
  "Open Cloudflare's API Tokens page (My Profile › API Tokens).",
  "Find the key you made for this site and select Edit (the three dots beside it).",
  "Under “Permissions”, select “Add more” and choose Account › Account Filter Lists › Edit.",
  "Select “Add more” again and choose Account › Bulk URL Redirects › Edit.",
  "Check that “Account Resources” includes the account the site's domain is in.",
  "Select “Continue to summary”, then “Update token”. The key stays the same, so nothing needs pasting again.",
];

export const CLOUDFLARE_KEY_URL = "https://dash.cloudflare.com/profile/api-tokens";

const docs = (title: string, url: string) => ({ title, url, read: HOST_DOCS_READ });

export const HOST_INFO: Record<RedirectHostId, RedirectHostInfo> = {
  cloudflare: {
    id: "cloudflare",
    name: "Cloudflare",
    file: "public/_redirects",
    howItWorks:
      "Cloudflare reads a file called _redirects from the published site and applies it before serving any page. It travels with the site, so no access key is needed.",
    limits: { static: 2000, dynamic: 100, total: 2100, lineLength: 1000 },
    queryStrings: "Cloudflare can't match old addresses by their query string (the part after “?”); a new address may carry one.",
    trailingSlash: "Cloudflare treats /page and /page/ as different addresses, so each needs its own redirect.",
    caseSensitivity: "Cloudflare's docs don't say whether capitals matter; keep old addresses exactly as they were.",
    statuses: [301, 302, 307, 308],
    docs: [docs("Redirects (Workers static assets)", CLOUDFLARE_REDIRECTS_DOCS), docs("Redirects (Pages)", CLOUDFLARE_PAGES_REDIRECTS_DOCS), docs("Bulk Redirects", CLOUDFLARE_BULK_DOCS)],
  },
  netlify: {
    id: "netlify",
    name: "Netlify",
    file: "public/_redirects",
    howItWorks: "Netlify reads a file called _redirects from the published site, top to bottom, and uses the first rule that matches.",
    limits: { static: null, dynamic: null, total: null, lineLength: null },
    queryStrings: "Netlify passes the visitor's query string on to the new address, and can match an old address by its query parameters.",
    trailingSlash: "Netlify matches /page and /page/ alike, so one redirect covers both.",
    caseSensitivity: "Netlify matches paths with capitals exactly as written.",
    statuses: [301, 302],
    docs: [docs("Redirects and rewrites", NETLIFY_REDIRECTS_DOCS), docs("Redirect options", NETLIFY_REDIRECT_OPTIONS_DOCS)],
  },
  vercel: {
    id: "vercel",
    name: "Vercel",
    file: "vercel.json",
    howItWorks: "Vercel reads the redirects list in vercel.json when the site is built and applies it everywhere it serves the site.",
    limits: { static: null, dynamic: null, total: 2048, lineLength: 4096 },
    queryStrings: "Vercel passes the visitor's query string on to the new address; an old address can be matched by a query parameter.",
    trailingSlash: "Vercel treats /page and /page/ as different addresses unless the site's trailing-slash setting joins them.",
    caseSensitivity: "Vercel matches old addresses with capitals exactly as written.",
    statuses: [301, 302, 307, 308],
    docs: [docs("vercel.json redirects", VERCEL_REDIRECTS_DOCS), docs("Configuration redirects and limits", VERCEL_REDIRECT_LIMITS_DOCS)],
  },
  other: {
    id: "other",
    name: "Another host",
    file: null,
    howItWorks: "This app can't write redirects for this host. Download them in the host's format and add them where its documentation says.",
    limits: { static: null, dynamic: null, total: null, lineLength: null },
    queryStrings: "Depends on the host.",
    trailingSlash: "Depends on the host.",
    caseSensitivity: "Depends on the host.",
    statuses: [301, 302, 307, 308],
    docs: [],
  },
};

export const HOST_IDS: RedirectHostId[] = ["cloudflare", "netlify", "vercel", "other"];

/** "Permanent" / "Temporary": the words editors see; the number is shown small. */
export function statusWord(status: RedirectStatus): "Permanent" | "Temporary" {
  return status === 301 || status === 308 ? "Permanent" : "Temporary";
}
