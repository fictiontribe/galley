# Putting a site online

Galley can put any site it can build at a real address on **Cloudflare** or
**Vercel** — including a site you made from a starter two minutes ago that
exists only on your computer. No git hosting, no CI, no command line needed:
press **Put this site online**, follow four short steps, and the address
appears. After that, publishing can put changes live by itself, and any set of
unpublished changes can be shared as a **preview link** first.

> **Status of live verification.** Everything below was built from the hosts'
> current documentation and rehearsed end to end against strict fake hosts
> (see "How it was tested"). **Cloudflare** has since been verified against the
> real service (preview, second preview and live deploy, 2026-11-23);
> **Vercel** has not been run against the real service yet. Details and the
> one command per host are in [Verifying with a real account](#verifying-with-a-real-account).

> **Host the editor online** sits beside **Put this site online** on the
> Online screen: it puts the *editor* online too — a hosted install for this
> one site, on the person's own Fly.io account, behind a Cloudflare Tunnel, or
> on any server with Docker — planned and priced before anything is created.
> It is built the same way as this module (`packages/core/src/hosting/`) and
> described in [`docs/cloud-install.md`](cloud-install.md#host-the-editor-online).

---

## For site owners

### What "online" means here

- **Live** — what visitors see at the site's address. *What's live is what
  you've published*: Galley builds the last published version, never the
  changes still waiting in Proof.
- **Preview link** — the site exactly as it is on your computer, unpublished
  changes included, at an address of its own. Send it to a colleague before
  you publish. The live site doesn't change.
- **Put live** — puts the newest published version online now. The status bar
  says when published versions aren't live yet ("2 published versions not
  live yet · Put live").
- **Put changes live every time I publish** — a switch. On: every publish
  puts the new version online by itself. A failure to go online never undoes
  or blocks the publish; it is reported on its own.

Where to find it: **Site home** (the Online card), the **status bar**,
**Online** in the sidebar (every deployment made from this computer),
**Site settings › Online**, **Version history** (Put live beside the newest
version), **Proof** (Share a preview link) and the **Publish** dialog's result.

### Choosing a host

| | Cloudflare (recommended) | Vercel |
| --- | --- | --- |
| Suits | Most sites. The access key can be limited to just this job. | Teams that already use Vercel. |
| Live address | `https://<project>.<your-subdomain>.workers.dev` | `https://<project>.vercel.app` (Vercel may add a suffix if the name is taken) |
| Preview links | Anyone with the link can open them. | Vercel asks visitors to sign in with access to your team, unless you turn Deployment Protection off for the project. |
| Costs | Static sites fit Cloudflare's free Workers plan; see [Cloudflare's pricing](https://developers.cloudflare.com/workers/platform/pricing/). | Vercel's free plan is for personal, non-commercial sites; see [Vercel's pricing](https://vercel.com/pricing). |

### Making the access key

Galley calls it an *access key*; the hosts call it an *API token* (Cloudflare)
or *access token* (Vercel). A pasted key is checked with the host first and
saved only if the host accepts it, so a mistyped key never replaces one that
works. It is stored on your computer only (in the app's
`secrets.json`, readable by you alone) or read from the environment; after you
paste it, Galley only ever shows its last four characters.

**Cloudflare** — Galley's **Open Cloudflare's page** button opens Cloudflare's
**Create Token** form already filled in (name "Website publishing",
**Account › Workers Scripts › Edit** and **Account › Account Settings ›
Read**), using Cloudflare's documented
[API token template URLs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/):

1. Open the pre-filled page.
2. Under **Account Resources**, choose the account the site should live in
   (the template starts as all of your accounts, because the account isn't
   known until a key exists).
3. **Continue to summary**, then **Create Token**.
4. Copy the key — Cloudflare shows it once — and paste it into Galley.

The link is:

```
https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=%2A&zoneId=all&name=Website%20publishing
```

(`zoneId` is required by the template for user tokens; with no zone
permission in the list it grants nothing.) **Do it by hand** in the setup
shows the long way, from the [API Tokens page](https://dash.cloudflare.com/profile/api-tokens):
Create Token › Create Custom Token › Get started; Permissions **Account ›
Workers Scripts › Edit** (and optionally **Account › Account Settings ›
Read**, so the account can be picked from a list — without it you type the
account ID from the Workers & Pages overview); Account Resources › Include ›
the account; Continue to summary › Create Token.

What it allows: creating and updating Workers in the chosen account (and
reading the account's name). Not your domains, DNS, e-mail or billing.
Your account also needs a workers.dev subdomain: if it has none, open
**Workers & Pages** in the dashboard once and choose one.

**Vercel** — [Account Tokens page](https://vercel.com/account/tokens).
Vercel documents no way to pre-fill this page, so Galley links to it as it is.

1. Open the Account Tokens page.
2. Name it after the site.
3. Under **Scope**, choose the team the site should live in. Don't limit it to
   a single project: Galley creates the site's project.
4. Choose when it expires, then **Create**. Copy the key — Vercel shows it once.

What it allows: Vercel keys can't be limited to particular actions, so this
one can do anything in the team you chose. Galley only uses it to create the
project, upload files and read deployments. Delete it on Vercel if you stop
using Galley.

### Using your own domain

Once the site is online it can answer at an address of yours, like
`www.example.com`, instead of the host's own (`….workers.dev`,
`….vercel.app`). Open **Online › Use your own domain…** (also on the last
step of the setup), or run `galley domain www.example.com` /
`galley deploy --domain www.example.com`.

1. **Type the address.** Galley checks it with the host — without changing
   anything — and tells you in a sentence what will happen, for example:
   *"Cloudflare will answer galley.example.com with this site and set up its
   certificate. Nothing else on example.com changes."*
2. **Say yes.** The host attaches the address. On Cloudflare it creates the
   DNS record and the certificate itself. On Vercel you are shown the one DNS
   record to create where your domain's DNS is managed, with Copy; then
   **Check again**.
3. **Wait a moment.** Galley waits until the address answers over HTTPS
   (certificates can take a few minutes; you can close the window). If it
   takes longer than ten minutes, it says so and you can **Check again**
   later — the site's address stays as it was meanwhile.
4. **It becomes the site's live address**: the status bar, the Online page
   and the deployment list show it, and Galley offers to make it what Proof
   compares your changes against. Putting new versions live never changes it
   back.

When it can't be done, it says why and changes nothing:

- **The address already shows something else** (another Worker or another
  Vercel project): choose another address, or free it on the host first.
- **There's already a DNS record for that address** (Cloudflare): Galley never
  replaces DNS records. Remove or rename the record on Cloudflare
  (DNS › Records), then check again.
- **The domain isn't in your Cloudflare account**: Cloudflare can only answer
  an address on a domain whose DNS it runs, so there's no record to add
  elsewhere. [Add the domain to Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)
  first (it moves the domain's DNS to Cloudflare), or use an address on a
  domain already there. Vercel works with DNS anywhere.

**Stop using this address** (on the Online page, or `galley domain --remove`)
puts the host's own address back as the live one. It detaches the address
only if Galley attached it; an address that was set up some other way stays
as it is on the host. The domain and its other records are never touched.
On Cloudflare, the certificate made for the address isn't deleted by
detaching (Cloudflare's docs say so); remove it under SSL/TLS › Edge
Certificates if you want it gone.

The access key you already gave works: on Cloudflare, Account › Workers
Scripts › Edit is the permission the Workers domains API asks for.

### Limits

Checked before anything is uploaded; Galley refuses with the numbers.

- Cloudflare: 25 MiB per file; 20,000 files per version on the free plan,
  100,000 on paid plans ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
  Galley refuses above 100,000; between the two, Cloudflare's own answer decides.
- Vercel: 15,000 files per upload; 100 MB of files on the free plan, 1 GB on
  Pro; a daily cap on deployments and uploads ([limits](https://vercel.com/docs/limits)).
  Galley refuses above 15,000 files or 1 GB. Galley uploads every file of
  each deployment, so very large sites can reach the free plan's daily upload
  cap sooner than you'd expect.

### Troubleshooting

| You see | What to do |
| --- | --- |
| *Cloudflare/Vercel didn't accept the access key* | The key was deleted, expired or mistyped. Make a new one and paste it in the setup's key step. |
| *…didn't let the access key …* | The key lacks a permission. Cloudflare: add Account › Workers Scripts › Edit and include the account. Vercel: make a key scoped to the team, not a project. |
| *This Cloudflare account doesn't have a workers.dev address yet* | Open Workers & Pages in the dashboard once and choose a subdomain. |
| *The site's own build stopped with a problem* | The site's build failed; the last lines it printed are under **Technical details**. The live site is unchanged. This usually needs whoever looks after the site's code. |
| *Nothing has been published yet* | Publish first; production puts the published version online. A preview link works before the first publish. |
| *…takes at most … files* / *…takes files up to …* | The built site is over the host's limits; the message names the file or count. |
| *This computer can't reach …* | Check the internet connection and try again; nothing changed on the live site. |
| Preview link asks the visitor to sign in (Vercel) | That is Vercel's Deployment Protection. Turn it off in the project's settings on Vercel, or invite the visitor to the team. |

---

## For developers

### How it works

```
packages/core/src/deploy/
  service.ts     createDeployService: the flow as a Job, per-site serialisation, settings, records, auto-deploy
  source.ts      what is built: production = publish branch tip in a temporary git worktree; preview = working tree
  files.ts       walk + hash + limits (never .git, node_modules, .env*, or symlinks)
  cloudflare.ts  Workers static assets, Direct Upload (plain fetch)
  vercel.ts      Vercel REST (plain fetch)
  info.ts        setup copy, limits, name rules — data only (also loaded by the web mock)
  history.ts     <home>/state/<siteId>/deployments.jsonl
  errors.ts      DeployError (reason + plain sentence) and secret scrubbing
  registry.ts    built-in targets + registerDeployTarget
```

**The flow** (`deploy.start(site, { kind })` → `Job` of kind `"deploy"`):
a read-only look at the host (so a refused key, a missing permission or a
name in use is reported in seconds, not after a long build) → build → walk
and check the output folder (`model.build.outDir`) → create or find the
project on the host — only now, so a site that doesn't build leaves nothing
behind on either host → upload with the host's protocol → record the
deployment → after a production deploy, write the live address into
`galley.config.json` (`deploy.productionUrl`) with the engine's surgical
config edit. The UI offers to make that address `urls.production`, which is
what Proof's side-by-side compares against.

**Production builds what is published.** The publish branch's tip (else HEAD)
is checked out with `git worktree add --detach` into a temporary folder —
the whole repository, so a site in a monorepo sub-folder builds from its own
folder and sees the *published* versions of everything it reaches by
relative path (shared code, brand files). Every `node_modules` the working
tree has (the site's, the repository root's, each workspace package's) is
made available at the same place in the checkout, because Node looks for
packages in every ancestor folder: linked whole when nothing in it points
back into the repository; otherwise rebuilt entry by entry, with links to
workspace packages (pnpm/npm workspace links) pointing at the checkout's
published copy and everything else at the installed package
(`packages/core/src/deploy/modules.ts`). Dependencies are installed only
when the working tree has none. The site's own build command runs there with the
cleaned environment the engine uses for every site command, and the worktree
is removed afterwards (`git worktree remove --force` + `prune`). Files that
aren't in version history (for example a `.env`) aren't in that build.
**Preview builds the working tree** with `site.build()`.

**Settings** live in `galley.config.json`:

```json
{
  "deploy": {
    "target": "cloudflare",
    "account": "<account or team id>",
    "project": "my-site",
    "productionUrl": "https://my-site.example.workers.dev",
    "autoDeploy": true,
    "previewOnShare": true
  }
}
```

Ids only. Access keys are secrets named `cloudflare` and `vercel` in the
settings service; `CLOUDFLARE_API_TOKEN` / `VERCEL_TOKEN` take precedence (as
the hosts' own CLIs read them), and `CLOUDFLARE_ACCOUNT_ID` / `VERCEL_TEAM_ID`
are offered as the account. Only `SecretStatus` crosses HTTP. Every error
message, detail, job event and record is scrubbed of the key, including when
a host echoes the Authorization header back.

**Auto-deploy** hooks in at `SiteDeps.onPublished` (and the registry's
`onPublished`), called after a publish or an undo of one recorded a version;
it runs outside the publish's result and anything it throws is swallowed.
Pull-request mode doesn't auto-deploy (nothing is published until the request
is merged).

**HTTP** (all behind the session and Origin guards; see `ApiRoutes`):

| Route | |
| --- | --- |
| `GET /api/deploy/targets` | hosts, setup copy, secret status |
| `POST /api/deploy/targets/:targetId/connect` | `{ key? }`: check a pasted key with the host, store it only if accepted (else check the stored key); accounts/teams |
| `POST /api/sites/:siteId/deploy/check` | is a project name usable (creates nothing) |
| `GET /api/sites/:siteId/deploy` | settings, latest production/preview, running job, `behind` |
| `PUT /api/sites/:siteId/deploy` | change settings |
| `POST /api/sites/:siteId/deploy/live-address` | set `urls.production` to the live address |
| `POST /api/sites/:siteId/deploy` | `{ kind, label? }` → `Job` |
| `GET /api/sites/:siteId/deployments` | records, newest first |

A host refusing the key is sent as 400 `unconfigured`, never 401 (which the UI
reads as "your app session ended").

**CLI**: `galley deploy [path] [--preview] [--target cloudflare|vercel]
[--project name] [--account id] [--yes] [--json]`. It asks only what it can't
find, only on a terminal (the key is read without echo and stored), saves the
choices, prints the address, and exits 1 on failure (2 on a usage problem).

### The upload protocols (as implemented)

**Cloudflare — Workers static assets, Direct Upload.** Cloudflare's Pages
docs now say "Start new projects with Workers"; Pages Direct Upload is only
documented through wrangler and drag-and-drop. The Workers static-assets
Direct Upload *is* documented over the REST API, so Galley uses it with plain
`fetch` — **wrangler is not involved**.

1. `GET /accounts/:a/workers/workers/:name` (and `…/versions?per_page=1`)
   looks the Worker up through the same Workers API it is created with — the
   scripts list leaves out a Worker with no version yet. An existing Worker
   is used only when it is empty or is the one this site's settings name; a
   Worker with content that this site doesn't name is "that name is in use —
   choose another". Nothing is ever deleted. After the site has built,
   `POST /accounts/:a/workers/workers` `{ name, subdomain: { enabled: true, previews_enabled: true } }`
   creates it when it doesn't exist, so a preview can be the first thing shared.
2. `POST /accounts/:a/workers/scripts/:name/assets-upload-session`
   `{ manifest: { "/path": { hash, size } } }` → `{ jwt, buckets }`. Every
   path, unchanged ones included. `hash` = first 32 hex of
   SHA-256(base64(bytes) + extension without the dot), as the guide's sample.
3. Per bucket: `POST /accounts/:a/workers/assets/upload?base64=true` with
   `Authorization: Bearer <session jwt>`, multipart, one part per hash holding
   the base64 bytes with the type the file is served with. The last answer
   (201) carries the completion jwt; with no buckets the session jwt is it.
4. Production: `PUT /accounts/:a/workers/scripts/:name`; preview:
   `POST …/scripts/:name/versions` (not deployed; address
   `<first 8 of version id>-<name>.<subdomain>.workers.dev`). Multipart with
   `metadata` = `{ main_module, compatibility_date, bindings: [{type:"assets", name:"ASSETS"}],
   assets: { jwt, config: { html_handling: "auto-trailing-slash", not_found_handling: "404-page" } }, annotations }`
   plus a two-line module that hands requests to `env.ASSETS` (`main_module`
   is required by the upload API).
5. Addresses: `GET /accounts/:a/workers/subdomain`. Accounts: `GET /accounts`.

**Vercel — REST.** `POST /v2/files` (bytes, `x-vercel-digest: <sha1>`,
size) for each distinct file → `POST /v13/deployments?skipAutoDetectionConfirmation=1`
`{ name, project, target?: "production", files: [{ file, sha, size }],
projectSettings: { framework: null, buildCommand: null, … } }` (a
`missing_files` answer is honoured by sending those and asking again once) →
poll `GET /v13/deployments/:id` until `READY`. Projects:
`GET /v9/projects/:name`, `POST /v11/projects`. Accounts: `GET /v2/teams`,
`GET /v2/user`. `teamId` on every call.

### Redirects and headers

The Redirects screen (`docs/redirects.md`) keeps the site's redirects in the
file its host reads. Galley's deploy passes them on the way each host wants:

- **Cloudflare.** `_redirects` and `_headers` at the root of the build output
  are *rules*, not pages: Cloudflare doesn't serve them as files but reads
  them from the upload. Galley leaves them out of the asset manifest and sends
  their text in the Worker metadata as `assets.config._redirects` and
  `assets.config._headers`, beside the `html_handling` / `not_found_handling`
  it already sets — for live deploys and previews alike. This is what Wrangler
  does: `packages/workers-utils/src/config/assets.ts` reads the two files from
  the assets folder, `packages/deploy-helpers/src/deploy/helpers/create-worker-upload-form.ts`
  puts them in the assets config, and `createAssetsIgnoreFunction` in
  `packages/workers-shared/utils/helpers.ts` keeps `/_redirects`, `/_headers`
  and `/.assetsignore` out of the manifest (cloudflare/workers-sdk at commit
  `1edd2f45a69c`, 2026-11-23; the upload-form file last changed 2026-11-19).
  The script-upload API reference lists `assets.config._redirects` /
  `_headers` as strings ("contents of a _redirects file"). Only the files at
  the root count; a `_redirects` in a subfolder is an ordinary file.
- **Limits (Cloudflare).** 2,000 exact + 100 dynamic redirects (a source with
  `*` or `:name`, and every rule after the first such one), 1,000 characters
  per redirect; 100 header rules, 2,000 characters per line. Beyond them
  Cloudflare skips rules without saying so, so Galley refuses the deploy
  first, names the limit and points at the Redirects screen (and its
  **Also set them on Cloudflare** for Bulk Redirects). Wrangler's parser uses
  2,000 characters per line for both files; Galley follows the documented
  1,000 for redirects. Rules in `_redirects`/`_headers` don't apply to
  responses Worker code makes; Galley's Worker only hands requests to the
  assets, so they apply to the whole site.
- **Vercel.** Redirects live in `vercel.json`, which Vercel reads from the
  project's root — for an upload, from the root of the deployment's files.
  The site keeps it at its own root (not in the build output), so Galley adds
  it to the upload as `vercel.json`. Only the members that say how files are
  served travel (`redirects`, `rewrites`, `headers`, `cleanUrls`,
  `trailingSlash`, `routes`, `$schema`); build settings such as
  `outputDirectory` or `buildCommand` are left out of the uploaded copy,
  because the upload is already built and `outputDirectory: "dist"` would
  send Vercel looking for a folder that isn't there. The file on disk isn't
  changed. A live deploy takes the *published* `vercel.json`, a preview the
  one in the working tree. A `vercel.json` that isn't valid JSON stops the
  deploy with a plain message.
- **Verified live on Cloudflare** (2026-11-23), on a preview and on the live
  address: exact rules answer 301 and 302 as written, a wildcard rule
  redirects, and `_redirects` itself isn't served. Vercel's redirects are not
  verified live yet.

**Markdown copies of pages.** Sites built with the kit publish a markdown
copy of every page (`/about.md`) and `/llms.txt`. Served as
`application/octet-stream`, browsers download them and agents may not read
them as text, so when the build output has `.md` files Galley adds
`Content-Type: text/markdown; charset=utf-8`:

- Cloudflare: a `/*.md` rule appended to the `_headers` text it already
  passes in `assets.config._headers` (and `.md` parts are uploaded with that
  type too). It is skipped when the site's own `_headers` already sets
  Content-Type for a path that could match `.md` (one naming `.md`, or with a
  wildcard or placeholder), or already has Cloudflare's 100 rules.
- Vercel: a `{ "source": "/(.*).md", "headers": [{ "key": "Content-Type", … }] }`
  entry appended to `headers` in the uploaded routing-only `vercel.json`
  (made for the upload when the site has none), under the same rule: never
  over a Content-Type header the site set itself, and not past 2,048 routes.

Sources (read 2026-11-23): Cloudflare
[Redirects](https://developers.cloudflare.com/workers/static-assets/redirects/),
[Headers](https://developers.cloudflare.com/workers/static-assets/headers/),
[script upload metadata](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/);
Wrangler source:
[create-worker-upload-form.ts](https://github.com/cloudflare/workers-sdk/blob/1edd2f45a69c442dbc084a44ae5372d04775be2a/packages/deploy-helpers/src/deploy/helpers/create-worker-upload-form.ts),
[config/assets.ts](https://github.com/cloudflare/workers-sdk/blob/1edd2f45a69c442dbc084a44ae5372d04775be2a/packages/workers-utils/src/config/assets.ts),
[helpers.ts](https://github.com/cloudflare/workers-sdk/blob/1edd2f45a69c442dbc084a44ae5372d04775be2a/packages/workers-shared/utils/helpers.ts),
[parseRedirects.ts](https://github.com/cloudflare/workers-sdk/blob/1edd2f45a69c442dbc084a44ae5372d04775be2a/packages/workers-shared/utils/configuration/parseRedirects.ts);
Vercel [vercel.json](https://vercel.com/docs/project-configuration/vercel-json).

### Sources (read 2026-11-23)

- Cloudflare — Workers static assets Direct Upload: https://developers.cloudflare.com/workers/static-assets/direct-upload/
- Cloudflare — Static assets (routing, not-found handling): https://developers.cloudflare.com/workers/static-assets/
- Cloudflare — Pages overview ("Start new projects with Workers"): https://developers.cloudflare.com/pages/
- Cloudflare — Pages Direct Upload (wrangler / drag and drop only): https://developers.cloudflare.com/pages/get-started/direct-upload/
- Cloudflare — Multipart upload metadata (`main_module` required): https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
- Cloudflare — Script upload API: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
- Cloudflare — Versions upload API: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/
- Cloudflare — Workers API, create Worker: https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/create/
- Cloudflare — Script workers.dev subdomain: https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/create/
- Cloudflare — Account subdomain: https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/
- Cloudflare — Preview URLs: https://developers.cloudflare.com/workers/configuration/previews/
- Cloudflare — Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare — Create an API token: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- Cloudflare — API token template URLs: https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/
- Cloudflare — Deploy to Cloudflare buttons: https://developers.cloudflare.com/workers/platform/deploy-buttons/
- Cloudflare — Astro on Workers (static assets, no `main`): https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/
- Cloudflare — List accounts: https://developers.cloudflare.com/api/resources/accounts/methods/list/
- Vercel — Create a new deployment: https://vercel.com/docs/rest-api/deployments/create-a-new-deployment
- Vercel — Upload deployment files: https://vercel.com/docs/rest-api/deployments/upload-deployment-files
- Vercel — Create a new project: https://vercel.com/docs/rest-api/projects/create-a-new-project
- Vercel — REST API index (teams, user, projects): https://vercel.com/docs/rest-api
- Vercel — Access tokens: https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token and https://vercel.com/docs/accounts/access-tokens
- Vercel — Deploy Button: https://vercel.com/docs/deploy-button and its parameters https://vercel.com/docs/deploy-button/source
- Vercel — Deployment Protection: https://vercel.com/docs/deployment-protection
- Vercel — Limits: https://vercel.com/docs/limits

### CI alternatives

The starters already ship git-based deploy configuration (for example the
Astro starter's `netlify.toml`), and both hosts can build from a connected
git repository on every push. Use that when the site lives in a git host and
a team works on it through pull requests; use Galley's one-click deploy when
the site lives on one computer, or when you want preview links of unpublished
changes. Don't use both for the same project: two sources of truth for what's
live is how sites go back in time.

### Own domains: how it works

The saved addresses (`galley.config.json` › `deploy`):

- `productionUrl` — the site's **live address**, the person's choice: the
  host's own until a domain is in use, then `https://<domain>`. A production
  deploy never replaces a custom one; `hasCustomAddress()` decides.
- `defaultUrl` — the host's own address, recorded on every production deploy.
- `domain: { hostname, attached, pending? }` — the domain in use; `attached`
  is true only when Galley attached it, so stopping detaches nothing else;
  `pending` while it isn't answering yet.

The flow is a `Job` of kind `"domain"`: plan → attach → wait (host side
ready, then `https://<domain>/` answers) → `productionUrl` = the domain.
Routes: `POST …/deploy/domain/plan` (read-only), `POST …/deploy/domain`,
`POST …/deploy/domain/check`, `DELETE …/deploy/domain`.

**Cloudflare** (Workers Custom Domains):

- Look up: `GET /accounts/:a/workers/domains?hostname=` — another Worker's
  domain is refused, this Worker's is used (and recorded as not attached by
  Galley).
- Plan: `POST /accounts/:a/workers/scripts/:name/domains/changeset?replace_state=true`
  with `[{ hostname }]` — Cloudflare's read-only preview, the call Wrangler
  makes before it asks anything. It resolves the zone in the account (an
  error naming the zone: not in this account) and lists DNS records in the
  way (`conflicting`) — which the deploy key couldn't read otherwise, having
  no DNS permission. This endpoint isn't in the public API reference; it is
  taken from Wrangler's source.
- Attach: `PUT /accounts/:a/workers/domains` `{ hostname, service, zone_id }`
  (documented; `environment` is deprecated there and not sent). Galley never
  sends Wrangler's `override_existing_dns_record` / `override_existing_origin`
  (those belong to a different, script-scoped endpoint).
- Detach: `DELETE /accounts/:a/workers/domains/:id`, only for the domain on
  this Worker that Galley attached.
- Permissions: Workers Scripts Write (the deploy key's Account › Workers
  Scripts › Edit) for attach and detach; any Workers read permission for the
  list. A key without it gets "…didn't let the access key … Account › Workers
  Scripts › Edit".

**Vercel** (project domains): plan with `GET /v9/projects/:p/domains/:d`
(already this project's) and `GET /v6/domains/:d/config?projectIdOrName=:p`
(`misconfigured`, `recommendedCNAME` / `recommendedIPv4`, rank 1 → the record
to show: an A record at the apex, a CNAME below it); attach with
`POST /v10/projects/:p/domains` `{ name }` (409: another project has it;
`verified: false` adds the TXT `verification` record); check with
`POST /v9/projects/:p/domains/:d/verify` and the config again; remove with
`DELETE /v9/projects/:p/domains/:d`.

Sources (read 2026-11-24): Cloudflare
[Attach Worker Domain](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/),
[List Domains](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/),
[Detach Domain](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/delete/),
[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
(an active zone you own; DNS records and certificate made for you; no Custom
Domain on a hostname with an existing CNAME; the certificate isn't deleted
with the domain); Wrangler
[publish-routes.ts](https://github.com/cloudflare/workers-sdk/blob/fa50abac64e5d9a3e5daa7258c8cf816a90c5349/packages/deploy-helpers/src/triggers/publish-routes.ts)
(the changeset call; last changed 2026-11-19); Vercel
[Add a domain to a project](https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project),
[Get a domain's configuration](https://vercel.com/docs/rest-api/domains/get-a-domain-s-configuration),
[REST API index](https://vercel.com/docs/rest-api) (verify, remove).

### The hosts' own one-click buttons (public repositories)

For a site whose code is in a **public** GitHub repository (GitLab works for
both; Bitbucket for Vercel), each host offers a button that copies the
repository into the visitor's own account, connects it, and builds it on
every push — no Galley involved. Verified URL forms (2026-11-23):

- **Deploy to Cloudflare**: `https://deploy.workers.cloudflare.com/?url=<public repository URL>`
  ([docs](https://developers.cloudflare.com/workers/platform/deploy-buttons/)).
  Workers applications only (not Pages); public github.com or gitlab.com
  repositories only; a subdirectory URL works when the app is fully
  self-contained in it.
- **Deploy with Vercel**: `https://vercel.com/new/clone?repository-url=<URL-encoded repository URL>`
  ([docs](https://vercel.com/docs/deploy-button/source)); optional
  `project-name=` and `repository-name=`.

The markdown a starter's README should carry (replace `OWNER/REPO`):

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/REPO)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO)
```

These buttons make a *copy* that lives on the visitor's git host; Galley's own
Put this site online publishes the site you have open, from your computer.

### Adding a deploy target

Implement `DeployTarget` (`packages/core/src/deploy/types.ts`): `credentials`
and `info` (setup copy, limits), `connect`, `checkProject`, `ensureProject`,
`deploy` (receives the walked, hashed `DeployFile[]` and reports progress in
plain words), optionally `list`. Throw `DeployError` with a reason and a
sentence that says what happened and what to do. Register it with
`registerDeployTarget(target)` before the deploy service is created, or pass
`targets` to `createDeployService`. A new host also needs a `SecretName` for
its key. Write a fake that implements its protocol strictly (see
`packages/core/test/deploy/fakes/`).

### How it was tested

- `packages/core/test/deploy/`: file walking/hashing/limits; each host's
  protocol against an in-process fake that refuses a wrong step (no manifest,
  a part whose bytes don't match its hash, the account key used where the
  upload jwt belongs, a wrong SHA-1 digest, files never uploaded); the flow on
  real temporary git repositories (production from the published version
  while unpublished edits sit in the working tree, preview from the working
  tree, the Astro starter built in a worktree, auto-deploy, a failed host not
  failing the publish, keys scrubbed from everything).
- `packages/server/test/deploy.test.ts`, `packages/cli/test/deploy.test.ts`,
  `packages/web/test/deploy/logic.test.ts`.
- **Rehearsing without a real host**: run the fakes as servers
  (`npx tsx packages/core/test/deploy/fakes/serve.ts /tmp/evidence.json 4531 4532`)
  and start the app with `GALLEY_DEPLOY_CLOUDFLARE_API=http://127.0.0.1:4531/client/v4`
  and `GALLEY_DEPLOY_VERCEL_API=http://127.0.0.1:4532`. These variables exist
  for tests and rehearsals only; the fakes' keys are printed on start.

### Verifying with a real account

**Cloudflare: verified on the real service on 2026-11-23**, from the CLI, with
a throwaway project on a copy of the B2B starter:

- a preview of the working tree — 87 files, every page, asset and the 404
  page served correctly, no failed requests in a browser;
- a second preview after an unpublished edit — it showed the edit, and the
  first preview's address still showed the earlier state;
- a live deploy — the live address showed the **published** heading while the
  unpublished edit sat in the working tree, and all 87 files were
  byte-identical to an independent build of the published version;
- the project was then deleted through Cloudflare's API;
- **redirects** (a second throwaway project, same day): with a `_redirects`
  file in the site's public folder, the preview and the live address answered
  `301` and `302` for exact rules and carried the rest of the address through
  a wildcard rule (`/news/* /blog/:splat`), and `/_redirects` itself answered
  404 (it is applied as rules, not served as a file). The live address took
  about ten seconds after the deploy before every rule answered.

Not exercised in that run: the app's setup dialog against the real service
(the CLI shares the engine path), auto-deploy after a publish, and an account
without a workers.dev address. **Vercel has not been run against the real
service yet.**

To repeat it with a real key, on a throwaway copy of a starter:

```sh
# From the root of this repository (pnpm install done). G runs the CLI from source.
G="node $PWD/packages/cli/bin/galley.js"
cd /tmp

# Cloudflare: key with Account › Workers Scripts › Edit (+ Account Settings › Read)
$G new verify-cloudflare --no-start && cd verify-cloudflare
CLOUDFLARE_API_TOKEN=… $G deploy --preview --yes

# Vercel: key scoped to a team
cd /tmp && $G new verify-vercel --no-start && cd verify-vercel
VERCEL_TOKEN=… $G deploy --preview --target vercel --yes
```

Success looks like: progress lines (`Connecting to Cloudflare…`, `Building
the site with your changes…`, `Sending 57 files (985 KB) to Cloudflare…`, `Cloudflare is
preparing the preview…`), then `✓ Preview at https://…` and exit code 0;
opening the address shows the starter. Then run `$G deploy --yes` (no
`--preview`) for the live address — `✓ Live at https://verify-cloudflare.<subdomain>.workers.dev`
(Cloudflare) or `https://verify-vercel.vercel.app` (Vercel) —, and delete the Worker / project on the host
afterwards. If the account has several accounts/teams, add
`--account <id>`.

### What a starter must ship for the buttons to work

For an Astro static site (no server adapter). Galley's own deploy needs none
of this; it is only for the hosts' buttons and their git-based builds.

1. A public repository with the site at its root (or a fully self-contained
   subdirectory), including the lockfile, so the host's build installs the
   same packages.
2. `package.json` scripts: `"build": "astro build"` (both hosts run it), and
   for Cloudflare optionally `"deploy": "wrangler deploy"` — without a
   `deploy` script Cloudflare's button preconfigures `npx wrangler deploy`.
3. **Cloudflare:** a Wrangler configuration at the root (`wrangler.jsonc`)
   that serves the build output as static assets, with no `main` (no Worker
   code):

   ```jsonc
   {
     "name": "my-site",
     "compatibility_date": "2025-09-01",
     "assets": { "directory": "./dist", "not_found_handling": "404-page" }
   }
   ```

   Cloudflare's button reads this file to decide what to create. The
   `directory` must match Astro's `outDir` (`dist` by default).
4. **Vercel:** nothing extra — Vercel detects Astro and serves `dist`. Don't
   commit a `vercel.json` that changes the output directory.
5. The deploy-button markdown above in the README, with the real repository
   URL.
6. Nothing secret in the repository: the buttons copy everything in it into
   other people's accounts.
