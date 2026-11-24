---
title: Deploying, for developers
navTitle: Deploying
description: How Galley puts a site online on Cloudflare or Vercel — what is built, the upload protocols, redirects and headers, settings and keys, the CLI, and adding a host.
group: running
order: 5
---

This page is for developers. Editors use **Put this site online** ([Put the site online](/docs/editing/online/)); `galley deploy` does the same from a terminal ([Command line](/docs/reference/cli/#galley-deploy-path)). *Status: Cloudflare built and verified against the real service by its builders (preview, second preview and live deploy, redirects file included); Vercel built, not yet verified against the real service.* The docs did not contact either host: this page is from the code ([`packages/core/src/deploy/`]({repository}/tree/main/packages/core/src/deploy)) and [`docs/deploy.md`]({repository}/blob/main/docs/deploy.md).

## What is built

- **Live (production) builds what is published.** The publish branch's tip is checked out with `git worktree add --detach` into a temporary folder, the site's installed `node_modules` linked in (or dependencies installed), the site's own build command run there, and the worktree removed afterwards. Files that aren't in version history — a `.env`, say — aren't in that build.
- **A preview builds the working tree**, pending changes included, at an address of its own. The live site doesn't change.

Then the output folder (`build.outDir`) is walked and hashed — never `.git`, `node_modules`, `.env*` or symlinks — checked against the host's limits before anything is uploaded, uploaded, and recorded in `<GALLEY_HOME>/state/<siteId>/deployments.jsonl`. After the first live deploy the address is written to `galley.config.json` as `deploy.productionUrl`, and the app offers to make it `urls.production`, which Proof compares against.

## The hosts

| | Cloudflare | Vercel |
| --- | --- | --- |
| How | Workers static assets, Direct Upload over the REST API (no Wrangler) | REST: upload each file, then create a deployment |
| Live address | `https://<project>.<subdomain>.workers.dev` | `https://<project>.vercel.app` |
| Preview | A Worker version that isn't deployed; anyone with the link can open it | A preview deployment; Deployment Protection asks visitors to sign in unless turned off |
| Key | An API token with **Account › Workers Scripts › Edit** (and optionally **Account Settings › Read**) | An access token scoped to the team; it can't be limited further |
| Limits checked | 25 MiB a file; refused above 100,000 files | Refused above 15,000 files or 1 GB |

The exact calls, in order: [`docs/deploy.md`]({repository}/blob/main/docs/deploy.md#the-upload-protocols-as-implemented).

## Redirects and headers

The site's redirect file travels with the deploy as each host wants it. On Cloudflare, `_redirects` and `_headers` at the root of the build output are sent as rules in the Worker's metadata (as Wrangler does), not as files; Galley refuses the deploy first when they are over Cloudflare's limits (2,000 exact and 100 dynamic redirects). On Vercel, the site's `vercel.json` is added to the upload with only the members that say how files are served. See [Move a page without breaking links](/docs/editing/redirects/).

## Settings and keys

```json galley.config.json
{
  "deploy": {
    "target": "cloudflare",
    "account": "<account id>",
    "project": "caddow",
    "productionUrl": "https://caddow.example.workers.dev",
    "autoDeploy": true
  }
}
```

Ids only ([Config reference](/docs/reference/config/#deploy)). Keys are secrets named `cloudflare` and `vercel`, looked for as: the site's own key, then `CLOUDFLARE_API_TOKEN` / `VERCEL_TOKEN`, then the shared key in App settings. A pasted key is checked with the host before it is stored; every error, log line and record is scrubbed of it. A refused key comes back as `400 unconfigured`, never 401.

**Auto-deploy** (`autoDeploy`) runs after a publish or an undo records a version, outside the publish's result: a failure to go online never undoes or blocks the publish. Sites in pull-request mode don't auto-deploy.

## From a terminal

```sh
galley deploy ./site --preview
galley deploy ./site --target vercel --project my-site --yes
```

It asks only what it can't find, only on a terminal (the key is read without echo and stored), saves the choices, prints the address, and exits 1 on failure.

## Your own domain

Once a site is online it can answer at an address of yours, such as `www.example.com`: **Online › Use your own domain…** in the app, or `galley domain www.example.com` ([Command line](/docs/reference/cli/#galley-domain)). Galley shows what will change, attaches the address when you say yes, waits until it answers over HTTPS, then makes it the site's live address. It never replaces a DNS record, and `galley domain --remove` detaches only an address Galley attached. On Cloudflare the domain has to be in the same account; on Vercel you're shown the one DNS record to add where your DNS is. *Status: new in 0.1.1. On Cloudflare, taking over an address that already pointed at the site has been run on the real service; attaching a fresh address, and everything on Vercel, is tested against stand-ins only.* Details: [`docs/deploy.md`]({repository}/blob/main/docs/deploy.md#using-your-own-domain).

## Or let the host build it

If the site lives in a git host and a team works through pull requests, connect the repository to Cloudflare or Vercel and let them build on every push. Don't use both for one project: two sources of truth for what's live is how sites go back in time.

## Host the editor online

Beside **Put this site online**, the Online screen offers **Host the editor online**: the editor itself, as a hosted install for this one site, on the person's own Fly.io account, behind a Cloudflare Tunnel on a computer of theirs, or on any server with Docker. It plans everything and shows the monthly cost before creating anything, and `galley host` does the same from a terminal. Vercel and Cloudflare's containers can't run it: their disks don't keep files. [Host the editor online](/docs/editing/editor-online/); the whole design, with sources and prices: [`docs/cloud-install.md`]({repository}/blob/main/docs/cloud-install.md#host-the-editor-online). Hosts are added the same way as here, as a plugin's `editorHosts`.

## Adding a host

Implement `DeployTarget` ([`packages/core/src/deploy/types.ts`]({repository}/blob/main/packages/core/src/deploy/types.ts)) and register it — as a plugin's `deployTargets` ([Plugins](/docs/plugins/)). Throw `DeployError` with a sentence that says what happened and what to do, and write a fake of the host's protocol to test against.
