# Redirects

When a page moves, a redirect sends visitors and search engines from its old
address to the new one, so old links, bookmarks and search results keep
working. A site that moves from WordPress can carry a thousand old
addresses; Galley loads them in one go, checks them, and keeps them working
on the site's host.

Open a site and choose **Redirects** in the sidebar.

---

## For site owners

### The list

The redirects are one list, kept in the site like any other content
(`src/data/redirects.json` by default) and published like any other change.
Each redirect has:

- an **old address** — a path on this site, like `/2019/05/survey-notes/`, or
  a whole folder: “everything under /news/” (written `/news/*`);
- a **new address** — a page on this site, like `/blog/measured-survey/`, or a
  full address elsewhere (`https://shop.example.org/`). For a folder, the new
  address can carry the rest of the old one (written `/blog/:splat`);
- **permanent** (301, or 308 which also keeps the visitor's form submission
  method) or **temporary** (302, 307). Use permanent for moved pages: search
  engines then pass the old page's standing to the new one;
- an optional **note**, and where it **came from** (added here, a pasted list,
  the WordPress import).

Edit a row in place (Enter saves, Escape cancels), add one, or delete one
(with Undo). Every change is a pending change: check it in **Proof**, then
**Publish**.

The order is kept for you: exact addresses first, then folders, the most
specific first (`/blog/2020/*` before `/blog/*`). Every host needs that order,
so there is nothing to drag.

### Adding many at once

**Add many** takes a pasted list or a file and shows straight away what it
understood. Nothing is added until you confirm; then the whole list lands as
one change. It reads, line by line (a paste may mix them):

| You have | Looks like |
| --- | --- |
| Two columns — comma, tab, semicolon or spaces; a header row is fine; a third column may be the status | `/old-page/,/new-page/,301` |
| Full addresses of this site (shortened to their path) | `https://www.example.com/team/  /about/` |
| A Netlify or Cloudflare `_redirects` file | `/news/*  /blog/:splat  301` |
| Apache `.htaccess` | `Redirect 301 /old.html /new/` · `RedirectMatch 301 ^/news/(.*)$ /blog/$1` · `RewriteRule ^old/?$ /new/ [R=301,L]` |
| nginx | `rewrite ^/old/?$ /new/ permanent;` · `location = /old { return 301 /new/; }` |
| A Cloudflare Bulk Redirects list (CSV) | `example.com/docs,https://example.com/help/,301` |
| JSON: this list's own format, a plain list of `{ from, to }`, or Vercel's `redirects` | `{ "redirects": [ { "from": "/a/", "to": "/b/" } ] }` |
| The WordPress import's list | offered as a button when the site has one |

Nothing is guessed. A line that isn't plainly one redirect comes back with its
line number and why:

- **Not understood** — no two addresses on the line.
- **Needs a person** — a real rule, but more than one-to-one: a pattern that
  rearranges the address, a rule under a condition (`RewriteCond`, `if`), a
  redirect only for some countries or cookies, a status that isn't a redirect
  (200, 404, 410).
- **On another domain** — an old address on a domain that isn't this site's.
  If it is (the site's address isn't set yet), say so and they're read as
  this site's.

Old addresses are kept exactly as they were (a trailing slash too: hosts that
tell `/a` from `/a/` would otherwise never match). New addresses on this site
follow its own style (`/about/`). Fragments (`#top`) are dropped from old
addresses — browsers never send them.

Then the problems, grouped, each with one choice:

| Problem | What it means | Choices |
| --- | --- | --- |
| Didn't say permanent or temporary | Hosts disagree: Cloudflare reads a missing status as temporary, Netlify as permanent, Apache as temporary | Permanent · Temporary |
| Duplicates | The same redirect twice | Keep one |
| Sent to two places | One old address, two new ones; visitors only ever reach the first | Keep the first (the list's own wins) · Use the last |
| Points at itself | Left out | — |
| Would hide a live page | The old address is a page the site still has: it would never be seen again | Leave them out · Redirect anyway |
| Loop (a → b → a) | Visitors never arrive anywhere. **Refused** until left out | Leave them out |
| Chain (a → b → c) | Each extra step is slower and loses search standing | Point straight to the final address · Keep the steps |
| New address not found | Nothing is at that address on this site | Keep them · Use the page that matches · Leave them out |
| Old address with a query string | Hosts differ (below) | — |

### The checks on the list

The same checks run on the list itself; filter the list by problem to find
them. **Health** adds two more: redirects whose new address has gone (a page
was deleted or renamed since) — with “Point at …” when a page clearly
matches — and old addresses the site's own pages still link to (fix the link;
it opens the page in the editor).

**Try an address**: type an old address and see every step a visitor takes
and where they end up — a page (with its title), a file, another site, or a
missing page. When nothing matches but a redirect exists for the same address
with or without the trailing slash, it says so.

### Where they take effect

Galley writes the file the site's host reads, from the list, and keeps it in
step whenever the list changes in the app. The host comes from the site's
**Online** settings when it is put online from Galley; otherwise you choose it
once (Galley suggests one when the site has a `netlify.toml`, `vercel.json` or
Wrangler file).

| Host | File | Limits | Query strings | Trailing slash |
| --- | --- | --- | --- | --- |
| Cloudflare | `public/_redirects` | 2,000 exact + 100 wildcard redirects (2,100), 1,000 characters each | Can't match an old address by query; the new address may have one | `/page` and `/page/` are different |
| Netlify | `public/_redirects` | No number; deploys can fail when redirects are too large; wildcards suggested past 10,000 | Passes the visitor's query on; can match `key=value` | Matches both |
| Vercel | `vercel.json` → `redirects` | 2,048 redirects, 4,096 characters each | Passes the visitor's query on; matched with `has` | Different unless the site's `trailingSlash` joins them |
| Another host | — | — | — | — |

The panel shows how full the file is against those limits, and **View it**
opens the file. For another host, download the redirects in its format
(spreadsheet, `_redirects`, Vercel, Cloudflare list, nginx, Apache) and add
them where its documentation says.

If someone edits the host's file by hand — or the site already had one —
Galley never overwrites it silently: the panel says so, shows the file next to
what the list would make it, and offers **Replace it with the list** or
**Bring its redirects into the list**.

When you change host, a file Galley wrote for the old host is pointed out
with **Remove it**.

### Setting them on Cloudflare

On Cloudflare the file covers up to 2,100 redirects. Beyond that — or to have
Cloudflare answer the old addresses at your domain itself — **Also set them
on Cloudflare** pushes the list to Cloudflare as **Bulk Redirects**:

- It applies once the site is on **its own domain in that Cloudflare
  account**, with its traffic going through Cloudflare (the orange cloud). It
  does not apply on a `workers.dev` address.
- It needs the Cloudflare access key from the site's Online settings, with two
  more permissions: **Account › Account Filter Lists › Edit** and **Account ›
  Bulk URL Redirects › Edit**. To add them: Cloudflare dashboard › My Profile ›
  API Tokens › Edit the key › Permissions › Add more (each) › Account Resources
  includes the account › Continue to summary › Update token. The key stays the
  same. If it lacks either, Galley says which.
- Galley makes **one redirect list** (`galley_redirects_<site>`) and **one
  rule** that turns it on, both named for the site. It changes nothing else in
  the account and refuses to touch a list with that name it didn't make.
- You see the plan first — “add 412, change 3, remove 9 on Cloudflare”,
  examples, and anything Cloudflare can't take (old addresses with a query
  string) — then progress while Cloudflare works through the list, then the
  result. **Check Cloudflare matches** compares again at any time; the panel
  says when the list has changed since it was last set.
- Cloudflare's own limits (per account, by its highest plan): Free 10,000
  redirects across lists, Pro 25,000, Business 50,000, Enterprise 1,000,000;
  5 lists and 15 Bulk Redirect rules (25 and 50 on Enterprise).
- Where both have a redirect for an address, Cloudflare's comes first.
- **To remove it:** *Take them off Cloudflare* in the same dialog deletes the
  rule and then the list. By hand: Rules › Redirect Rules › Bulk Redirects,
  delete the rule, then Manage Lists and delete the list.

For a handful of redirects, Cloudflare's Single Redirects (per zone: 10 on
Free) are an alternative; Galley uses Bulk Redirects because one list and one
rule cover any number.

### Moving from WordPress

Import the content first (the WordPress importer). Its list of old addresses
appears on the Redirects screen as **Bring in the WordPress import's
redirects**: one click opens Add many with that list, already checked against
the pages that now exist. Keep the WordPress site running until the new one
is live and the redirects are published.

---

## For developers

### Configuration

`galley.config.json` (all optional):

```json
{
  "redirects": {
    "file": "src/data/redirects.json",
    "host": "netlify",
    "cloudflare": { "account": "0123…", "hostnames": ["example.com", "www.example.com"] }
  }
}
```

- `file` — the list. Default: beside the site's other JSON data files, else
  `src/data/redirects.json`.
- `host` — `cloudflare` · `netlify` · `vercel` · `other`. `deploy.target` wins
  when set (it's where the site actually goes).
- `cloudflare` — for Bulk Redirects: the account (when `deploy` doesn't give
  one) and the site's own domains.

The config merge makes the list file and the host's file writable in content
mode (they are content and derived content) and hides the list's generic data
collection from the content navigation — the Redirects screen is its editor.
A site without `galley.config.json` gets a `redirects.file` block written on
its first save.

### The list file

```json
{
  "redirects": [
    {"from":"/2019/05/survey-notes/","to":"/blog/measured-survey/","status":301,"source":"import:wordpress"},
    {"from":"/news/*","to":"/blog/:splat","status":301,"note":"Old news section"}
  ]
}
```

One redirect per line, canonical order (exact by code point, then wildcards
longest-prefix first), keys always `from, to, status, note, source`: a bulk
import is a readable diff. `from` starts with `/`, may end in `/*`, may carry a
query string; `to` is a path or an `http(s)://` URL, may end in `:splat`;
`status` is 301, 302, 307 or 308. A file that doesn't read is reported and
never rewritten until fixed.

### The derived files

- **Cloudflare** — `<public>/_redirects`, Workers static assets syntax
  (`from to status`, explicit status always — the default would be 302),
  static before dynamic, rules with a query in `from` left out.
- **Netlify** — `<public>/_redirects`, query conditions as `key=value`
  between the addresses, `!` on old addresses that are live pages (Netlify
  serves an existing file before a redirect otherwise), 307/308 written as
  302/301 (Netlify's docs list 301 and 302).
- **Vercel** — the `redirects` member of `vercel.json`, set with the engine's
  format-preserving JSON edit: every other byte stays. 301/302 as
  `statusCode`, 307/308 as `permanent`, wildcards as `:path*`, query
  conditions as `has`, path-to-regexp characters escaped.

A `_redirects` file Galley writes starts with two comment lines and
`# galley-redirects-checksum: <16 hex>` — a SHA-256 of the body below. A body
that no longer matches was edited by hand. `vercel.json` can't carry a
comment, so the hash of the array last written is kept in
`<GALLEY_HOME>/state/<siteId>/redirects.json` (with the Cloudflare record).

When the file is rewritten: on every save through the Redirects screen and
API, and after the list is changed elsewhere in the app (the assistant's
`update_entry`, the form editor, Undo, Discard) — but never in reaction to an
edit made outside the app (an editor, `git pull`): the panel shows the file as
behind and offers the update, so a checkout never leaves changes nobody asked
for.

> **Deploying to Cloudflare from Galley.** Wrangler reads `_redirects` from
> the assets folder and sends its text in the Worker's upload metadata
> (`assets.config._redirects`, per the Workers script upload API). Galley's
> one-click deploy uploads through the REST API, so it must do the same — read
> `_redirects` from the built folder into `assets.config._redirects` (and
> `_headers` likewise) — or Workers serves the file as a plain file instead of
> applying it. The file itself does reach the build output (`astro build`
> copies `public/_redirects` to `dist/_redirects`; tested).

### API

All under the session and Origin guards; see `packages/core/src/api.ts`.

| Route | |
| --- | --- |
| `GET /api/sites/:siteId/redirects` | The list, its issues, the host and its file's state, usage against limits, leftovers, importable lists, the Cloudflare summary |
| `PUT /api/sites/:siteId/redirects` | `{ redirects, baseHash }` — replace the list (409 when it changed underneath) |
| `POST /api/sites/:siteId/redirects/review` | `{ text \| path, filename?, mode: "add" \| "replace", resolutions?, siteHosts? }` → what would happen; writes nothing |
| `POST /api/sites/:siteId/redirects/import` | the same body (+ `baseHash`) → writes exactly what review showed; 400 while a loop blocks |
| `POST /api/sites/:siteId/redirects/try` | `{ address }` → the hops and where a visitor ends up |
| `PUT /api/sites/:siteId/redirects/settings` | `{ host?, cloudflare?: { account?, hostnames? } }` |
| `POST /api/sites/:siteId/redirects/derived/replace` | Replace a hand-edited or foreign host file with the list |
| `POST /api/sites/:siteId/redirects/leftover/remove` | `{ path }` — remove a file Galley wrote for a former host |
| `GET /api/sites/:siteId/redirects/export?format=` | `csv` · `redirects-file` · `vercel-json` · `cloudflare-csv` (needs a hostname) · `nginx` · `apache` · `json` |
| `GET /api/sites/:siteId/redirects/health` | Broken new addresses; old addresses linked from content |
| `POST /api/sites/:siteId/redirects/cloudflare/plan` | The plan; changes nothing |
| `POST /api/sites/:siteId/redirects/cloudflare/apply` | `{ planId }` → a `Job` (kind `redirects`); refuses a stale plan |
| `POST /api/sites/:siteId/redirects/cloudflare/check` | Does Cloudflare match? |
| `POST /api/sites/:siteId/redirects/cloudflare/remove` | Delete Galley's rule and list |

A key Cloudflare refuses comes back as 400 (`unconfigured`), a missing
permission as 403 (`forbidden`) naming it — never 401, which the app reads as
its own session ending. The key is read from the settings service (secret
`cloudflare`; `CLOUDFLARE_API_TOKEN` wins) at the moment of a call and
scrubbed from every message and job.

The assistant and MCP get one read-only tool, `check_redirects` (checks and
traces addresses). Changing the list uses the ordinary entry tools on the
list file; the host's file follows.

### The Cloudflare calls, in order

1. `GET /accounts/:a/rules/lists` and `GET /accounts/:a/rulesets/phases/http_request_redirect/entrypoint` — find ours; a 403 on either names the missing permission.
2. `GET /accounts/:a/rules/lists/:id/items?per_page=500&cursor=…` — what Cloudflare has now; the plan is the difference.
3. `POST /accounts/:a/rules/lists` `{ name, kind: "redirect", description }` — only when ours doesn't exist.
4. `PUT /accounts/:a/rules/lists/:id/items` `[ { redirect: { source_url, target_url, status_code, preserve_query_string, include_subdomains, subpath_matching, preserve_path_suffix } } ]` → `operation_id` — only when anything differs.
5. `GET /accounts/:a/rules/lists/bulk_operations/:operation_id` — polled until `completed` (or `failed`, which stops before the rule).
6. `POST /accounts/:a/rulesets` `{ kind: "root", phase: "http_request_redirect", rules: [ours] }` when the account has no entry point yet; else `POST /accounts/:a/rulesets/:r/rules` (ours missing) or `PATCH /accounts/:a/rulesets/:r/rules/:rule` (ours changed or switched off). The rule: `expression: "http.request.full_uri in $<list>"`, `action: "redirect"`, `action_parameters.from_list: { name: <list>, key: "http.request.full_uri" }`, `ref: <list>`.
7. Remove: `DELETE /accounts/:a/rulesets/:r/rules/:rule`, then `DELETE /accounts/:a/rules/lists/:id`.

Each redirect becomes one item per hostname: `source_url` without a scheme
(both http and https), a relative new address made absolute on that
hostname, `preserve_query_string: true` unless the new address has its own
query (Cloudflare allows one or the other), wildcards as `subpath_matching`
with `preserve_path_suffix` when the new address ends in `:splat`.

**Verified against a strict fake only** (`packages/core/test/redirects/fake-cloudflare.ts`):
no Cloudflare key was available where this was built. To check it for real,
with a key holding the two permissions and a throwaway domain on its account:

```sh
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… GALLEY_LIVE_HOSTNAME=redirects-test.example.com \
  pnpm --filter @galley/core exec tsx test/redirects/live-cloudflare.mts
```

It plans, applies, checks, re-applies (expecting no changing request), asks
the domain for one redirect, and removes everything it made.

### Sources

Read on 2026-11-23:

- Cloudflare — Workers static assets, Redirects: https://developers.cloudflare.com/workers/static-assets/redirects/
- Cloudflare — Pages, Redirects: https://developers.cloudflare.com/pages/configuration/redirects/
- Cloudflare — Workers script upload (`assets.config._redirects`): https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
- Cloudflare — Create Bulk Redirects via API: https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/create-api/
- Cloudflare — Bulk Redirects parameters: https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/parameters/
- Cloudflare — URL components: https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/url-components/
- Cloudflare — Bulk Redirects CSV format: https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/csv-file-format/
- Cloudflare — How Bulk Redirects work (precedence): https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/how-it-works/
- Cloudflare — Availability (plan limits, Single Redirects): https://developers.cloudflare.com/rules/url-forwarding/#availability
- Cloudflare — Lists API endpoints: https://developers.cloudflare.com/waf/tools/lists/lists-api/endpoints/
- Cloudflare — List items (pagination): https://developers.cloudflare.com/api/resources/rules/subresources/lists/subresources/items/methods/list/
- Cloudflare — Bulk operation status: https://developers.cloudflare.com/api/resources/rules/subresources/lists/subresources/bulk_operations/methods/get/
- Cloudflare — Rulesets: view, add a rule, update a rule, delete a rule: https://developers.cloudflare.com/ruleset-engine/rulesets-api/view/ · https://developers.cloudflare.com/ruleset-engine/rulesets-api/add-rule/ · https://developers.cloudflare.com/ruleset-engine/rulesets-api/update-rule/ · https://developers.cloudflare.com/api/resources/rulesets/subresources/rules/methods/delete/
- Cloudflare — API token permissions: https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- Netlify — Redirects overview: https://docs.netlify.com/manage/routing/redirects/overview/
- Netlify — Redirect options: https://docs.netlify.com/manage/routing/redirects/redirect-options/
- Vercel — vercel.json `redirects`: https://vercel.com/docs/project-configuration/vercel-json#redirects
- Vercel — Configuration redirects and limits: https://vercel.com/docs/routing/redirects/configuration-redirects
