---
title: "HTTP API"
description: "Every route the Galley server answers — what it does, what it takes and returns, who may call it — with authentication, the error shape and the live event stream. Generated from ApiRoutes."
group: "reference"
order: 3
---

<!-- Generated from packages/core/src/api.ts (ApiRoutes) by apps/site/scripts/reference-api.mjs. Edit those, not this page. -->

This page is for developers integrating with Galley — scripts, CI jobs, other tools. The web app uses exactly this API and nothing else: its client is typed from the `ApiRoutes` map in [`packages/core/src/api.ts`]({repository}/blob/main/packages/core/src/api.ts), where every request and response type named below is defined. **This page is generated from that file** (`apps/site/scripts/reference-api.mjs`), so it lists every route there is. The API is at version 0.1 and may change before 1.0.

## Conventions

- **JSON in, JSON out.** File and entry paths travel in the query string or the body, never as an address segment, relative to the site's folder with `/` separators: `?path=src/content/journal/why-we-make-forty.md`.
- **Who may call.** A few routes answer anyone (*No sign-in* below): `GET /api/meta`, sign-in, sign-out, and on a hosted install the three one-time-link routes, where the link's code is the proof. Every other route needs a session: the browser's session cookie, or `Authorization: Bearer <token>`. On your own computer the token is the one in the link Galley prints (set your own with `GALLEY_TOKEN`, 16 characters or more); in hosted mode set `GALLEY_TOKEN` on the server to allow Bearer access at all.
- **Roles, on a hosted install.** Each person who signs in is an owner, an editor or a contributor, and the *Who* column is the level each route needs there, read from the one table the server enforces ([`packages/core/src/install/route-access.ts`]({repository}/blob/main/packages/core/src/install/route-access.ts)): *Any signed-in person*, *Editors and owners*, or *Owners*. Someone signed in below a route's level gets `403`. *First run* routes take the one-time setup code as the Bearer token until the first owner exists, and need an owner after that. The operator's `GALLEY_TOKEN` reaches every route except those that need a person: your own account, people (it may sign one person out), backups, restores and opening the preview. **The levels apply only on a hosted install:** the app on your own computer has one person, who may call every route.
- **State-changing requests** (`POST`, `PUT`, `PATCH`, `DELETE`) also need the Bearer token, or a same-origin `Origin` header. Request bodies are limited to 40 MB.
- **Site routes** (`/api/sites/:siteId/…`) run with that site's own keys and author when it has them ([Look after many sites](/docs/editing/many-sites/)).
- **Addresses under `/api/x/`** are not Galley's and are not on this page: they belong to whoever built the edition of the editor you are talking to ([Embedding the editor](/docs/running/embedding/)).
- **Errors** are `{ "error": { "code", "message", "detail"? } }` with a matching status. `message` is written for a person; `detail` carries the technical cause when it is safe to show.

| `code` | Status | Means |
| --- | --- | --- |
| `invalid` | 400 | Bad input, named: *“url” isn't right: it must be an https or ssh address.* |
| `unconfigured` | 400 | Something needs setting up first — a key, an image provider. A host refusing a key is also `unconfigured`, never 401. |
| `unauthorized` | 401 | No session, or a Bearer token that isn't valid. |
| `forbidden` | 403 | Not writable in this mode, outside the site, a failed Host or Origin check, or (on a hosted install) a role below the route's level. |
| `not-found` | 404 | No such site, entry, file, job, conversation or route. |
| `conflict` | 409 | The file changed since it was read (`baseHash`), or a name is taken. |
| `busy` | 409, or 429 for too many tries | Something is already running — a reply, a publish — or too many tries at signing in, a setup code or a one-time link. |
| `git`, `preview`, `internal` | 500 | A git command, the preview, or something unexpected failed. |
| `ai` | 502 | The model or image provider failed. |

```sh
curl -s -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/sites
```

In the tables, *Takes* is the query (`?…`) and body; *Returns* is the response type, both named as in `api.ts`. A response of *a file* or *a stream* isn't JSON.

Addresses outside `/api` have their own rules: `/mcp` (the [MCP endpoint](/docs/integrations/mcp/), Bearer only), `/f/:siteId` (form submissions from the site's own pages — [Forms for developers](/docs/forms/)), and on a hosted install `/healthz` and `/readyz`, which answer anyone and say nothing about the install ([Run a hosted install](/docs/running/hosted/#health-logs-and-stopping)).

## Meta and sign-in

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/meta` | Version, brand, mode (`local` or `hosted`), whether the caller is signed in, whether the desktop app is the host; for a signed-in caller with managed AI on (`GALLEY_AI_MANAGED`), `ai` (`AiMetaInfo`: managed, what a credit is worth, whether AI is switched off, the manage address). Answers without a session, with less detail. | — | `MetaInfo` | No sign-in |
| `POST /api/auth/login` | Hosted install: sign in with an e-mail and password (the password alone for an owner from before accounts, who has no e-mail yet); sets the session cookie. Rate-limited. | `{ password, email? }` | `Ok` | No sign-in |
| `POST /api/auth/logout` | Clear and revoke the session. | — | `Ok` | No sign-in |
| `GET /api/events` | The live event stream ([below](#events)). | — | a stream | Any signed-in person |

## Settings

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/settings` | Model and effort, image and video choices, author, theme, previews, and each key's status (never its value). | — | `Settings` | Any signed-in person |
| `PATCH /api/settings` | Change any of those. | `SettingsPatch` | `Settings` | Owners |
| `PUT /api/secrets/:name` | Save a shared key — `anthropic`, `openai`, `google`, `cloudflare` or `vercel`; `null` removes it. Returns its status only. | `{ value }` | `SecretStatus` | Owners |
| `GET /api/usage` | What the assistant and image generation cost at list prices: today, 7 and 30 days, all time, per model. | — | `UsageSummary` | Owners |
| `GET /api/ai/credits` | Managed AI credit balance and status for this install when managed credits mode is on. | — | `AiCreditsInfo` | Any signed-in person |

## Themes for the app (docs/themes.md)

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/themes` | The themes saved for everyone here, the ones plugins add, and the install's default. | — | `ThemesInfo` | Any signed-in person |
| `PUT /api/themes/:themeId` | Save a theme for everyone here (adding or replacing). | `{ theme }` | `SavedTheme` | Owners |
| `DELETE /api/themes/:themeId` | Delete a theme saved for everyone here. | — | `Ok` | Owners |

## Sites

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites` | The sites in this app's list, with their group, note and what each is waiting on. | — | `SiteSummary[]` | Any signed-in person |
| `POST /api/sites/open` | Add and open a folder (an absolute path). A hosted install refuses it (403): it looks after one site. | `OpenSiteRequest` | `SiteDetail` | Owners |
| `POST /api/sites/clone` | Clone a repository into the sites folder, as a job. Refused on a hosted install. | `CloneSiteRequest` | `Job` | Owners |
| `POST /api/sites/create` | Create a site from a starter, as a job. Refused on a hosted install. | `CreateSiteRequest` | `Job` | Owners |
| `GET /api/starters` | The starters and their looks. | — | `StarterInfo[]` | Any signed-in person |
| `GET /api/starters/:starterId/preview` | A starter's preview image, or one of its looks' (`look`) — only images its starter.json declares. | `?look?` | a file | Any signed-in person |
| `GET /api/jobs/:jobId` | A job's state, progress and result. | — | `Job` | Any signed-in person |
| `GET /api/open` | A deep link from the site's own dev toolbar (`/open?root=&url=`): the site whose folder is `root`, and the entry behind `url`. | `?root&url?` | `{ state, siteId, entry } or { state, name, root }` | Owners |
| `GET /api/fs/list` | Folders on this computer's disk, for the folder picker; marks the ones that look like sites. Refused on a hosted install. | `?path?` | `{ path, parent, entries }` | Owners |
| `GET /api/sites/:siteId` | The site, with its full model (detection merged with the config file). | — | `SiteDetail` | Any signed-in person |
| `DELETE /api/sites/:siteId` | Forget the site, its own keys and author. Its files stay on disk. Refused on a hosted install. | — | `Ok` | Owners |
| `POST /api/sites/:siteId/refresh` | Run detection again. | — | `SiteModel` | Any signed-in person |
| `GET /api/sites/:siteId/config` | The site's `galley.config.json` (or `null`) and the model detection found before it. | — | `{ config, detected, hash }` | Any signed-in person |
| `PUT /api/sites/:siteId/config` | Replace `galley.config.json`. Validated; refused when invalid. | `{ config, baseHash? }` | `SiteModel` | Owners |

## Content

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/entries` | One collection's entries: `collection` plus `search`, `status`, `sort`, `order`, `offset`, `limit`. | `?collection } & EntryQuery options` | `EntryList` | Any signed-in person |
| `GET /api/sites/:siteId/entry` | One entry: parsed data, body, raw text, `hash`, fields and validation issues. | `?path` | `Entry` | Any signed-in person |
| `PATCH /api/sites/:siteId/entry` | Edit an entry with [surgical operations](/docs/concepts/surgical-edits/#the-operations); `baseHash` refuses a stale edit. | `?path` `{ ops, baseHash? }` | `EditResult` | Any signed-in person |
| `POST /api/sites/:siteId/entries` | Create an entry (optionally from a template). | `CreateEntryInput` | `Entry` | Any signed-in person |
| `DELETE /api/sites/:siteId/entry` | Delete an entry. | `?path` | `Ok` | Any signed-in person |
| `GET /api/sites/:siteId/search` | Search every editable string. | `?q&collection?&limit?` | `SearchHit[]` | Any signed-in person |
| `POST /api/sites/:siteId/resolve` | Click to edit: which field holds this text on this page — `unique`, `ambiguous` or `none` ([Never guess](/docs/concepts/never-guess/)). | `ResolveRequest` | `ResolveResult` | Any signed-in person |
| `GET /api/sites/:siteId/route` | The entry behind a page address. | `?url` | `{ entry }` | Any signed-in person |
| `POST /api/sites/:siteId/validate` | Validate these files, or everything pending. | `{ paths? }` | `{ issues }` | Any signed-in person |

## Forms

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `POST /api/sites/:siteId/forms/introspect` | Read the field list of an existing form on a provider's side (HubSpot, Marketo — those whose catalogue entry says `canImportFields`), so the form builder can add matching fields and their mapping in one go. | `FormIntrospectRequest` | `FormIntrospectResult` | Any signed-in person |
| `GET /api/sites/:siteId/forms` | Every form of the site with what the forms list shows: definition, status, the pages that use it. | — | `{ forms }` | Any signed-in person |
| `GET /api/sites/:siteId/kit` | What the site has of the site kit, and what "Set it up for me" would do. | — | `SiteKitStatus` | Any signed-in person |
| `POST /api/sites/:siteId/kit/setup` | "Set it up for me": starts a job (kind "kit-setup") that adds the kit and wires what is unambiguous, as pending changes. | — | `Job` | Any signed-in person |
| `POST /api/sites/:siteId/kit/visibility` | Only the step that publishes the version AI assistants can read: the kit's build step in astro.config and src/data/visibility.json (updating the kit's files when they predate it). | — | `Job` | Any signed-in person |
| `POST /api/sites/:siteId/kit/endpoint` | Points the live site's forms at this app's inbox: writes the capture address into the kit's settings as a pending change. | — | `SiteKitStatus` | Any signed-in person |

## Form inbox

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/inbox` | Forms with their counts; `unread` is the total for the sidebar badge. | — | `{ forms, unread }` | Editors and owners |
| `GET /api/sites/:siteId/inbox/:formId` | One form's submissions, newest first. | `?filter?&q?&offset?&limit?` | `SubmissionList` | Editors and owners |
| `GET /api/sites/:siteId/inbox/:formId/export` | The submissions as a CSV file (UTF-8 with BOM, the form's field order, labels as headers). | `?filter?` | a file | Editors and owners |
| `GET /api/sites/:siteId/inbox/:formId/:submissionId` | One submission in full. | — | `FormSubmission` | Editors and owners |
| `PATCH /api/sites/:siteId/inbox/:formId` | Mark read/unread and spam/not spam. | `{ ids, read?, spam? }` | `{ items }` | Editors and owners |
| `POST /api/sites/:siteId/inbox/:formId/delete` | Delete for good; the removed submissions come back so Undo can restore them. | `{ ids }` | `{ deleted }` | Editors and owners |
| `POST /api/sites/:siteId/inbox/:formId/restore` | Undo a delete. | `{ submissions }` | `{ restored }` | Editors and owners |
| `POST /api/sites/:siteId/inbox/:formId/:submissionId/retry` | Send again to one server-side destination (its index), or the e-mail notification. | `{ destination }` | `FormSubmission` | Editors and owners |
| `GET /api/sites/:siteId/capture` | The site's capture settings: e-mail alerts, forwarding, spam rules, whether a capture key is set. | — | `CaptureSettings` | Editors and owners |
| `PATCH /api/sites/:siteId/capture` | Change the capture settings. | `CaptureSettingsPatch` | `CaptureSettings` | Owners |
| `POST /api/sites/:siteId/capture/key` | Make a new capture key (shown once, in `key`) or remove it. | `{ action }` | `{ settings, key }` | Owners |

## Files (the source view)

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/files` | Files matching a glob (ignored folders left out). | `?glob?&limit?` | `{ files }` | Any signed-in person |
| `GET /api/sites/:siteId/file` | One file's text and `hash`. | `?path` | `{ path, content, hash, binary }` | Any signed-in person |
| `PUT /api/sites/:siteId/file` | Write one file; `mode` defaults to `content` ([Modes](/docs/concepts/modes/)). | `?path` `{ content, baseHash?, mode? }` | `Ok` | Any signed-in person |

## Media

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/media` | The media library. | — | `MediaLibraryAnswer` | Any signed-in person |
| `POST /api/sites/:siteId/media` | Upload a file as a `data:` URL, 25 MB at most. | `{ filename, directory?, data }` | `MediaItem` | Any signed-in person |
| `DELETE /api/sites/:siteId/media` | Delete a media file. | `?path` | `Ok` | Any signed-in person |

## Media storage: a bucket, and pictures in Cloudflare Images

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/media-storage/connectors` | The kinds of bucket a site can keep its media in, with the steps on the provider's side. | — | `{ connectors }` | Any signed-in person |
| `GET /api/sites/:siteId/media/storage` | Where the site keeps new media, whether its keys are set (never the keys), and how many files are where. | — | `MediaStorageStatus` | Any signed-in person |
| `POST /api/sites/:siteId/media/storage/check` | Run the check — on the body's settings (nothing is saved), or on the saved ones. | `Partial<MediaConnectRequest>` | `MediaCheckResult` | Owners |
| `PUT /api/sites/:siteId/media/storage` | Check, and only when that passes save the settings (galley.config.json `media.storage`) and any pasted keys. | `MediaConnectRequest` | `MediaConnectResult` | Owners |
| `DELETE /api/sites/:siteId/media/storage` | Stop putting new media in the bucket. | `?forgetKeys?` | `MediaStorageStatus` | Owners |
| `POST /api/sites/:siteId/media/images/check` | Run the Cloudflare Images check — on the body's settings (nothing is saved), or on the saved ones. | `Partial<MediaImagesConnectRequest>` | `MediaCheckResult` | Owners |
| `PUT /api/sites/:siteId/media/images` | Check, and only when that passes keep pictures in Cloudflare Images (galley.config.json `media.images`). | `MediaImagesConnectRequest` | `MediaImagesConnectResult` | Owners |
| `DELETE /api/sites/:siteId/media/images` | Pictures go where other files go again. | `?forgetKeys?` | `MediaStorageStatus` | Owners |
| `POST /api/sites/:siteId/media/storage/make-bucket` | "Make the bucket for me": an R2 bucket and its r2.dev address, with the site's Cloudflare key (it needs Workers R2 Storage › Edit). | `{ account, name }` | `{ created, config }` | Owners |
| `DELETE /api/sites/:siteId/media/storage/made-bucket` | Remove the bucket Galley made — only that one, once the site no longer uses it and it is empty. | — | `MediaStorageStatus` | Owners |
| `GET /api/sites/:siteId/media/usage` | Where an address is used: pages of the working copy (with titles) and files of the published version. | `?url` | `MediaUsage` | Any signed-in person |
| `POST /api/sites/:siteId/media/storage/delete` | Delete files from the bucket or Cloudflare Images, for good (it can't be discarded). | `{ paths }` | `MediaStoreDeleteResult` | Editors and owners |
| `POST /api/sites/:siteId/media/storage/move/plan` | What moving files (to the bucket and back) or changing the bucket's address would do. | `MediaMoveRequest` | `MediaMovePlan` | Owners |
| `POST /api/sites/:siteId/media/storage/move` | Do it, as a `Job` (kind "media"): copy, rewrite the pages, remove what nothing reaches. | `MediaMoveRequest` | `Job` | Owners |
| `GET /api/sites/:siteId/raw` | A file's bytes from the working tree, or from the last version with `rev=base`, for thumbnails and before/after pictures. | `?path&rev?` | a file | Any signed-in person |

## Image generation

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/images/providers` | The image generators and whether each is ready. | — | `{ providers }` | Any signed-in person |
| `POST /api/sites/:siteId/images/generate` | Make candidate images from a description. | `ImageGenRequest` | `{ candidates }` | Any signed-in person |
| `GET /api/images/candidates/:candidateId` | A candidate image's bytes. | — | a file | Any signed-in person |
| `POST /api/sites/:siteId/images/save` | Save a candidate into the site's media. | `ImageSaveRequest` | `MediaItem` | Any signed-in person |
| `DELETE /api/images/candidates/:candidateId` | Throw a candidate image away. | — | `Ok` | Any signed-in person |

## Video generation

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/videos/providers` | The video generators, their models, prices and whether each is ready. | — | `{ providers }` | Any signed-in person |
| `POST /api/sites/:siteId/videos/generate` | Start making a video; progress arrives as `job` events. | `VideoGenRequest` | `Job` | Any signed-in person |
| `GET /api/videos/jobs/:jobId` | A video generation's state and its candidates. | — | `VideoJobStatus` | Any signed-in person |
| `GET /api/videos/candidates/:candidateId` | A candidate video's bytes. | — | a file | Any signed-in person |
| `POST /api/sites/:siteId/videos/save` | Save a candidate video into the site's media. | `VideoSaveRequest` | `MediaItem` | Any signed-in person |
| `DELETE /api/videos/candidates/:candidateId` | Throw a candidate video away. | — | `Ok` | Any signed-in person |

## Plugins

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/plugins` | Built-in and installed plugins, with what each adds, its problems and its settings (secrets as status only). | — | `PluginList` | Any signed-in person |
| `GET /api/sites/:siteId/plugins` | The same, plus the plugins this site's configuration names. | — | `PluginList` | Any signed-in person |
| `POST /api/plugins/enabled` | Turn a plugin on or off (kept across restarts). | `{ name, enabled, siteId? }` | `PluginInfo` | Owners |
| `PUT /api/plugins/settings` | Save some of a plugin's settings; `null` removes a value. | `{ name, values, siteId? }` | `PluginInfo` | Owners |
| `GET /api/catalog` | Every catalogue, merged from the enabled plugins. | — | `PluginCatalog` | Any signed-in person |
| `GET /api/sites/:siteId/catalog` | The same, with this site's own plugins included. | — | `PluginCatalog` | Any signed-in person |
| `GET /api/sites/:siteId/data-sources/:sourceId` | A plugin's data source, for a field's picker: search it (`q`, up to `limit` — default 12, at most 50) or look up the value a file holds (`value`). | `?q?&value?&limit?` | `DataSourceAnswer` | Any signed-in person |

## Proof and publish

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/changes` | Everything pending, per file, with field-level changes ([example](/docs/concepts/working-tree/#what-a-change-looks-like)). | — | `ChangeSet` | Any signed-in person |
| `GET /api/sites/:siteId/diff` | One file's before and after, with hunks. | `?path` | `FileDiff` | Any signed-in person |
| `POST /api/sites/:siteId/discard` | Discard these files' changes, or everything pending. | `{ paths? }` | `ChangeSet` | Any signed-in person |
| `POST /api/sites/:siteId/publish` | Publish: commit (and push), or a branch and pull request ([Publishing](/docs/configuration/publishing/)). | `PublishRequest` | `PublishResult` | Editors and owners |
| `GET /api/sites/:siteId/history` | Published versions, newest first. | `?limit?` | `{ items }` | Any signed-in person |
| `POST /api/sites/:siteId/revert` | Undo a publish with a new version that reverses it. | `{ commit }` | `PublishResult` | Editors and owners |
| `POST /api/sites/:siteId/send` | Send versions published on this computer that have not reached the remote yet. | — | `PublishResult` | Editors and owners |
| `GET /api/sites/:siteId/git` | Branch, remote, ahead and behind, as of the last look at the code host (`checkedAt`). | — | `GitStatus` | Any signed-in person |
| `POST /api/sites/:siteId/git/check` | Ask the code host what is new (a fetch), changing no file: the status as of now, or why it couldn't look (`checkProblem`). | — | `GitStatus` | Any signed-in person |
| `POST /api/sites/:siteId/pull` | Bring the site up to date: fetch, then `git merge --ff-only`. A running preview is stopped first and started again on the new files. | — | `GitStatus` | Editors and owners |
| `POST /api/sites/:siteId/publish/message` | Suggest a one-line note for Version history. Uses the assistant (one request) when a key is set. | `{ paths? }` | `{ message }` | Editors and owners |
| `POST /api/sites/:siteId/publish/check` | What the plugins' publish checks say about publishing these changes (all pending when `paths` is absent): warnings to show first, and whether one would stop the publish. | `{ paths? }` | `PublishCheck` | Any signed-in person |

## Preview and build

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/preview` | The preview's state, addresses and log. | — | `PreviewStatus` | Any signed-in person |
| `POST /api/sites/:siteId/preview/start` | Start the preview ([The preview](/docs/astro/preview/)). | — | `PreviewStatus` | Any signed-in person |
| `POST /api/sites/:siteId/preview/stop` | Stop it. | — | `PreviewStatus` | Any signed-in person |
| `POST /api/sites/:siteId/preview/restart` | Restart it. | — | `PreviewStatus` | Any signed-in person |
| `POST /api/sites/:siteId/build` | Run the site's build and return the end of its output. | — | `BuildResult` | Any signed-in person |

## Putting the site online

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/deploy/targets` | The hosts a site can be put online with, what setting each up needs, and whether its access key is present. | — | `{ targets }` | Any signed-in person |
| `POST /api/deploy/targets/:targetId/connect` | Check an access key works; the accounts (Cloudflare) or teams (Vercel) it can use. | `{ key? }` | `{ accounts }` | Owners |
| `POST /api/sites/:siteId/deploy/check` | Whether a project name can be used in that account. | `{ target, account, project }` | `DeployProjectCheck` | Editors and owners |
| `GET /api/sites/:siteId/deploy` | The site's deploy settings, latest deployments, the running (or last) deploy job, and how far behind the live site is. | — | `DeployStatus` | Any signed-in person |
| `PUT /api/sites/:siteId/deploy` | Change the site's deploy settings (galley.config.json `deploy`). | `Partial<DeployConfig>` | `DeployStatus` | Owners |
| `POST /api/sites/:siteId/deploy/live-address` | Use the live address as the site's `urls.production` (what Proof compares against). | — | `DeployStatus` | Owners |
| `POST /api/sites/:siteId/deploy` | Start a deploy: "production" puts the published version live; "preview" puts the working tree, pending changes included, at an address of its own. | `{ kind, label? }` | `Job` | Editors and owners |
| `GET /api/sites/:siteId/deployments` | Deployments made from this computer, newest first. | `?limit?` | `{ items }` | Any signed-in person |
| `POST /api/sites/:siteId/deploy/domain/plan` | What using this address as the site's own would do. | `{ hostname }` | `DomainPlan` | Owners |
| `POST /api/sites/:siteId/deploy/domain` | Use the address (after the person said yes to the plan): attach it and wait until it answers over HTTPS. | `{ hostname }` | `Job` | Owners |
| `POST /api/sites/:siteId/deploy/domain/check` | Look again at an address that isn't answering yet. | — | `Job` | Owners |
| `DELETE /api/sites/:siteId/deploy/domain` | Stop using the site's own address: detached only if Galley attached it; the host's address becomes the live one again. | — | `DeployStatus` | Owners |

## Redirects

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/redirects` | The list, its checks, where it takes effect (the host and its file), what can be imported, and the Cloudflare state. | — | `RedirectsOverview` | Any signed-in person |
| `PUT /api/sites/:siteId/redirects` | Replace the list (inline edits, add one, delete, Undo). | `{ redirects, baseHash? }` | `RedirectsOverview` | Any signed-in person |
| `POST /api/sites/:siteId/redirects/review` | "Add many": what a pasted list (or a file in the site, `path`) would do. | `RedirectImportBody` | `ImportReview` | Any signed-in person |
| `POST /api/sites/:siteId/redirects/import` | Add what `review` showed, as one pending change. | `RedirectImportBody & { baseHash? }` | `{ overview, review }` | Any signed-in person |
| `POST /api/sites/:siteId/redirects/try` | "Try an address": where a visitor ends up, through which rules. | `{ address }` | `RedirectTrace` | Any signed-in person |
| `PUT /api/sites/:siteId/redirects/settings` | Choose the host (when the deploy settings don't say), the Cloudflare account and the site's own domains. | `{ host?, cloudflare? }` | `RedirectsOverview` | Owners |
| `POST /api/sites/:siteId/redirects/derived/replace` | Replace a host file that was edited by hand (or was the site's own) with one written from the list. | — | `RedirectsOverview` | Any signed-in person |
| `POST /api/sites/:siteId/redirects/leftover/remove` | Remove a redirect file this app wrote for a host the site no longer uses. | `{ path }` | `RedirectsOverview` | Any signed-in person |
| `GET /api/sites/:siteId/redirects/export` | The list in a host's format, as a download. | `?format&hostname?` | a file | Any signed-in person |
| `GET /api/sites/:siteId/redirects/health` | Redirects that lead nowhere now, and old addresses the site's own pages still link to. | — | `RedirectHealth` | Any signed-in person |
| `POST /api/sites/:siteId/redirects/cloudflare/plan` | What setting them on Cloudflare would add, change and remove. | — | `CloudflarePlan` | Editors and owners |
| `POST /api/sites/:siteId/redirects/cloudflare/apply` | Apply a plan (refused when anything moved since). | `{ planId }` | `Job` | Editors and owners |
| `POST /api/sites/:siteId/redirects/cloudflare/check` | Check Cloudflare's copy matches the list. | — | `CloudflareCheck` | Editors and owners |
| `POST /api/sites/:siteId/redirects/cloudflare/remove` | Take this app's list and rule off Cloudflare (nothing else there is touched). | — | `RedirectsOverview` | Editors and owners |

## Assistant

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/threads` | The site's assistant conversations. | — | `{ threads }` | Any signed-in person |
| `POST /api/sites/:siteId/threads` | Start a conversation. | `{ title?, mode? }` | `ChatThread` | Any signed-in person |
| `GET /api/sites/:siteId/threads/:threadId` | One conversation, with its messages. | — | `ChatThread` | Any signed-in person |
| `PATCH /api/sites/:siteId/threads/:threadId` | Rename a conversation. | `{ title }` | `ChatThreadSummary` | Any signed-in person |
| `DELETE /api/sites/:siteId/threads/:threadId` | Delete a conversation. | — | `Ok` | Any signed-in person |
| `POST /api/sites/:siteId/threads/:threadId/messages` | Send a message (text, pictures, mode, page context). The reply streams over `/api/events`. | `SendMessageRequest` | `{ turnId }` | Any signed-in person |
| `POST /api/sites/:siteId/threads/:threadId/cancel` | Stop the reply in progress. | — | `Ok` | Any signed-in person |
| `POST /api/sites/:siteId/threads/:threadId/undo` | Undo one assistant turn: the files it changed are put back, except those changed again since, which are left as they are and listed in `left`. | `{ turnId }` | `UndoResult` | Any signed-in person |

## Multi-site

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/groups` | Groups (clients) in the order the person arranged them. | — | `SiteGroup[]` | Any signed-in person |
| `POST /api/groups` | Make a group. | `SiteGroupInput` | `SiteGroup` | Owners |
| `PATCH /api/groups/:groupId` | Rename, recolour or fold a group. | `SiteGroupInput` | `SiteGroup` | Owners |
| `DELETE /api/groups/:groupId` | Remove a group. Its sites stay in the list, ungrouped. | — | `Ok` | Owners |
| `PUT /api/groups/order` | Put the groups in a new order (every group's id). | `{ ids }` | `SiteGroup[]` | Owners |
| `PATCH /api/sites/:siteId/listing` | File a site: group, pin, note. | `SitePatch` | `SiteSummary` | Owners |
| `POST /api/sites/scan` | Look for sites inside a folder (one or two levels down). | `ScanSitesRequest` | `ScanSitesResult` | Owners |
| `POST /api/sites/scan/cancel` | Stop a scan started with that `id`. | `{ id }` | `Ok` | Owners |
| `POST /api/sites/add` | Add several folders at once, each checked as POST /api/sites/open checks one. | `AddSitesRequest` | `AddSitesResult` | Owners |
| `GET /api/sites/:siteId/thumbnail` | The site's own share image, for the list. | `?v?` | a file | Any signed-in person |
| `POST /api/sites/:siteId/presence` | An editor is open on the site: its preview isn't stopped as unused. | — | `Ok` | Any signed-in person |
| `GET /api/sites/:siteId/connections` | Which key and author each connection uses for this site. | — | `SiteConnections` | Owners |
| `PUT /api/sites/:siteId/secrets/:name` | This site's own key; `value: null` removes it (the shared key is used again). | `{ value }` | `SiteConnections` | Owners |
| `PUT /api/sites/:siteId/author` | This site's own publishing author; `null` removes it. | `{ author }` | `SiteConnections` | Owners |
| `GET /api/sites/:siteId/usage` | This site's assistant use. | — | `UsageSummary` | Owners |
| `GET /api/usage/sites` | Every site's assistant use: the last 30 days and in all. | — | `{ sites }` | Owners |

## Search and AI checks

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/visibility` | Run the Search and AI checks. `render=off` checks the content files only; by default a running preview or an existing build is used, never started. | `?render?` | `SiteAudit` | Any signed-in person |
| `GET /api/sites/:siteId/visibility/entry` | One entry: its result preview (an approximation) and findings, judged against the whole site. | `?path&render?` | `EntryAudit` | Any signed-in person |
| `POST /api/sites/:siteId/visibility/fix` | Apply the deterministic fixes of these findings (ids from the last audit) as ordinary edits. | `{ ids }` | `FixResult` | Any signed-in person |
| `POST /api/sites/:siteId/visibility/undo` | Put back every file one batch of fixes changed, except those changed again since, which are left as they are and listed in `left`. | `{ undoId }` | `UndoResult` | Any signed-in person |
| `GET /api/sites/:siteId/visibility/crawlers` | Each documented AI crawler and whether the site allows it. | — | `CrawlerReport` | Any signed-in person |
| `PUT /api/sites/:siteId/visibility/crawlers` | Allow or block documented AI crawlers by robots.txt token; only a marked block of robots.txt changes. | `{ choices }` | `CrawlerReport` | Any signed-in person |
| `GET /api/sites/:siteId/visibility/agent-view` | What an AI agent receives for one page: its markdown version, else its text with scripts off. | `?url` | `AgentView` | Any signed-in person |
| `POST /api/sites/:siteId/visibility/write/plan` | What an assistant-written batch would do: the pages, and one model request per page. | `{ kind, paths? }` | `WritePlan` | Any signed-in person |
| `POST /api/sites/:siteId/visibility/write` | Start the batch as a job; results land in Proof. | `{ kind, paths?, limit? }` | `WriteBatchStatus` | Any signed-in person |
| `GET /api/sites/:siteId/visibility/write/:jobId` | An assistant-written batch's progress. | — | `WriteBatchStatus` | Any signed-in person |
| `POST /api/sites/:siteId/visibility/write/:jobId/cancel` | Stop the batch; what is written stays in Proof. | — | `Ok` | Any signed-in person |
| `POST /api/sites/:siteId/visibility/external-links` | Check links to other sites — only when asked: a few at a time, capped. | `{ limit? }` | `{ checked, total, findings }` | Any signed-in person |
| `POST /api/sites/:siteId/import/upload` | Upload an export file, one chunk at a time (base64, at most 8 MB each, 200 MB in all). | `{ uploadId?, name, total, offset, chunk }` | `{ uploadId, received, upload }` | Any signed-in person |
| `POST /api/sites/:siteId/import/inspect` | The quick look: is it WordPress, can its content be read, how much is there. | `{ source }` | `ImportInspection` | Any signed-in person |
| `POST /api/sites/:siteId/import/plan` | What would come across and what wouldn't, with the questions that need a person (answered with their defaults until answered). | `{ source, answers? }` | `ImportPlanView` | Any signed-in person |
| `POST /api/sites/:siteId/import/run` | Start bringing it over: a `Job` (kind "import"). | `{ source, answers? }` | `ImportRunStatus` | Any signed-in person |
| `GET /api/sites/:siteId/import/runs/:runId` | An import's progress. | — | `ImportRunStatus` | Any signed-in person |
| `POST /api/sites/:siteId/import/runs/:runId/cancel` | Stop part-way: what already arrived is kept as pending changes. | — | `ImportRunStatus` | Any signed-in person |
| `GET /api/sites/:siteId/import/report` | The last import's report for this site, or null. | — | `{ report }` | Any signed-in person |
| `POST /api/sites/:siteId/import/rebuild` | Open the assistant (build mode) on one page-builder page, with its prepared rebuild brief. | `{ path }` | `{ threadId, turnId }` | Any signed-in person |
| `GET /api/sites/:siteId/import/rebuild-all` | What "Rebuild all" would do, and its estimated cost. | — | `ImportRebuildPlan` | Any signed-in person |
| `POST /api/sites/:siteId/import/rebuild-all` | Rebuild the pages one after another, each its own conversation; a `Job` (kind "import"). | `{ paths? }` | `ImportRebuildStatus` | Any signed-in person |
| `GET /api/sites/:siteId/import/rebuild-all/:jobId` | A Rebuild all run's progress. | — | `ImportRebuildStatus` | Any signed-in person |
| `POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel` | Stop Rebuild all after the page in hand. | — | `ImportRebuildStatus` | Any signed-in person |

## The site's brand

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/brand` | The saved brand, the material, the proposal under review, the analysis in progress, and what the assistant receives. | — | `SiteBrandState` | Any signed-in person |
| `POST /api/sites/:siteId/brand/analyse` | Read the brand: from the site (`measurements` are the overlay's `measure` answers for a few pages) or from the added material. | `{ from, measurements?, sources? }` | `Job` | Any signed-in person |
| `POST /api/sites/:siteId/brand/cancel` | Stop reading the brand. | — | `Ok` | Any signed-in person |
| `POST /api/sites/:siteId/brand/sources` | Add material, one chunk at a time (base64, at most 8 MB each). | `{ uploadId?, name, note?, total, offset, chunk, preview? }` | `{ uploadId, received, source }` | Any signed-in person |
| `POST /api/sites/:siteId/brand/website` | Read a website's address as material (public https addresses only). | `{ url }` | `BrandSource` | Any signed-in person |
| `PATCH /api/sites/:siteId/brand/sources/:sourceId` | Change a piece of material's note, or leave it out of the reading. | `{ note?, ignored? }` | `BrandSource` | Any signed-in person |
| `DELETE /api/sites/:siteId/brand/sources/:sourceId` | Remove a piece of material. | — | `Ok` | Any signed-in person |
| `GET /api/sites/:siteId/brand/sources/:sourceId/file` | The file (`kind=original`) or the picture the model saw (`kind=picture`). | `?kind?` | a file | Any signed-in person |
| `PUT /api/sites/:siteId/brand/proposal` | Change the proposal (an edited brand) and answer its questions (question id → option value). | `{ brand?, answers? }` | `BrandProposal` | Any signed-in person |
| `DELETE /api/sites/:siteId/brand/proposal` | Throw the proposal away. | — | `Ok` | Any signed-in person |
| `POST /api/sites/:siteId/brand/ask` | Change the proposal in words; contrast is measured again afterwards. | `{ text }` | `{ proposal, reply }` | Any signed-in person |
| `POST /api/sites/:siteId/brand/save` | Save the proposal as the brand's files: pending changes, shown in Proof. | — | `{ paths }` | Any signed-in person |
| `GET /api/sites/:siteId/brand/apply` | What "Apply to the site" would change in the tokens file. | — | `ApplyPlan` | Any signed-in person |
| `POST /api/sites/:siteId/brand/apply` | Write the brand's values into the site's tokens file, as pending changes. | — | `{ plan, paths }` | Any signed-in person |
| `POST /api/sites/:siteId/brand/check` | The pending changes against the brand: suggestions, never a block. | `{ paths? }` | `{ items }` | Any signed-in person |
| `POST /api/sites/:siteId/brand/drift` | The site re-measured against the brand. | `{ measurements }` | `DriftReport` | Any signed-in person |
| `GET /api/sites/:siteId/brand/export` | Download: `format=brand` (the bundle) or `format=tokens` (W3C design tokens). | `?format?` | a file | Any signed-in person |
| `POST /api/sites/:siteId/brand/import` | A bundle exported from another site, as a proposal to review. | `{ bundle }` | `BrandProposal` | Any signed-in person |
| `GET /api/sites/:siteId/brand/fonts/:fontId` | One of the site's own web fonts, for the specimen. | — | a file | Any signed-in person |
| `POST /api/sites/:siteId/preview/entry` | The addresses to load the two preview frames from, right now. | — | `{ preview, baseline }` | Any signed-in person |

## The hosted install: first run

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/setup` | Where first run is: the owner's account, site, details or done, with the site's state and what the operator fixed. Takes the setup code until an owner exists. | — | `SetupStatus` | First run |
| `POST /api/setup/password` | Create the owner: their name, e-mail and password. | `{ password, name?, email? }` | `SetupStatus` | First run |
| `POST /api/setup/deploy-key` | The install's own deploy key: made on first use, replaced with `rotate`. | `{ rotate? }` | `DeployKeyInfo` | First run |
| `POST /api/setup/site/check` | Whether the repository can be reached and written to. | `SiteConnectRequest` | `SiteAccessCheck` | First run |
| `POST /api/setup/site` | Connect the install's one site: copy the repository, or send a starter to an empty one. | `SiteConnectRequest` | `Job` | First run |
| `PUT /api/setup/details` | Save the publishing name and e-mail and the live address during first run. | `{ author?, liveUrl? }` | `SetupStatus` | First run |
| `POST /api/setup/handover` | Everything at once, from the app that created the install (the unattended half of first run). | `SetupHandover` | `SetupStatus` | First run |
| `POST /api/setup/finish` | End first run once the owner's account exists and the site is connected. The setup link stops working. | — | `SetupStatus` | First run |

## The hosted install: the Install page

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/install` | The Install page: address, version, the site's repository and how it is reached, the publishing name, what is stored where. | — | `InstallInfo` | Owners |
| `POST /api/install/password` | The older name for `POST /api/account/password`: change your own password. | `{ current, next }` | `Ok` | Any signed-in person |
| `POST /api/auth/logout-all` | Sign yourself out everywhere, this browser included. | — | `Ok` | Any signed-in person |
| `POST /api/install/backup` | Download a backup of the install's state, sealed with the passphrase (application/octet-stream). | `{ passphrase }` | a file | Owners |
| `POST /api/install/restore/upload` | Upload a backup file as the raw request body (application/octet-stream). | — | `RestoreUpload` | First run |
| `POST /api/install/restore` | Put an uploaded backup back in place of the install's current state. | `{ upload, passphrase }` | `Job` | First run |

## The hosted install: people

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/account` | The signed-in person. | — | `AccountSession` | Any signed-in person |
| `PATCH /api/account` | Change your own name or e-mail. | `{ name?, email?, password? }` | `AccountSession` | Any signed-in person |
| `POST /api/account/password` | Change your own password. | `{ current, next }` | `Ok` | Any signed-in person |
| `POST /api/account/identity/remove` | From a recovery session (the link `serve --reset-password` makes) on an account that signs in through the identity provider, with passwords on: stop signing in through it, and sign in with this password instead. | `{ password }` | `Ok` | Any signed-in person |
| `POST /api/auth/oidc/link` | Where an identity provider is set up and passwords are on: start linking your own account to it, with your current password. | `{ password }` | `{ url }` | Any signed-in person |
| `GET /api/auth/oidc/link/pending` | Who the provider signed in for the link you started, to confirm: their e-mail (only when the provider confirmed it), else their name and subject. | — | `PendingLinkView` | Any signed-in person |
| `POST /api/auth/oidc/link/confirm` | Connect (or cancel) the link waiting. | `{ connect }` | `Ok` | Any signed-in person |
| `GET /api/people` | Everyone with an account (role, switched off or not, when they last signed in), the open invitations, and whether this server e-mails links (it needs outgoing e-mail and its public address both set). With the server's access token, where an identity provider is set up: `OperatorPeople` (ids, roles, switched off, subjects; no names or e-mails). | — | `People` | Owners |
| `GET /api/people/by-identity` | The server's access token only, where an identity provider is set up: the account with this subject at the provider (id, role, switched off), or 404. | `?subject` | `Pick<OperatorAccount, "id" \| "role" \| "disabled">` | The server's access token |
| `POST /api/people/invitations` | Invite someone. | `{ email, role }` | `{ invitation, link }` | Owners |
| `DELETE /api/people/tombstones/:removedId` | Let a removed person back: their subject is taken off the list of removed accounts, so they may sign in through the identity provider again (as a new account) or be linked. | — | `Ok` | Owners |
| `DELETE /api/people/invitations/:invitationId` | Take an invitation back: its link stops working. | — | `Ok` | Owners |
| `PATCH /api/people/:accountId` | Change someone's role or e-mail, or switch their account off or on. | `{ role?, disabled?, email? }` | `Account` | Owners |
| `DELETE /api/people/:accountId` | Remove an account. | — | `Ok` | Owners |
| `POST /api/people/:accountId/password-link` | A link for someone to choose a new password (they forgot it). | — | `OneTimeLink` | Owners |
| `POST /api/people/:accountId/sign-out` | Sign one person out of every browser. | — | `Ok` | Owners |
| `POST /api/people/sign-out` | Sign everyone out, this browser included. | — | `Ok` | Owners |
| `POST /api/auth/link/check` | What a one-time link is for. | `{ code }` | `LinkPreview` | No sign-in |
| `POST /api/auth/link` | Use a one-time link: an invitation creates the account (`name` required), a new-password link sets the password and signs that person's other browsers out, and a sign-in link (`serve --reset-password`, for someone who signs in through the identity provider or with passwords off) takes the code alone and changes nothing else. | `{ code, password?, name? }` | `Ok` | No sign-in |
| `POST /api/auth/forgot` | "I forgot my password." When the server e-mails links (outgoing e-mail and its public address both set) and the address has an account, a new-password link is e-mailed. | `{ email }` | `{ ok, emailAvailable }` | No sign-in |
| `GET /api/auth/oidc/start` | Where an identity provider is set up: start signing in through it. | `?return?` | a file | No sign-in |
| `GET /api/auth/oidc/callback` | Where an identity provider is set up: where the provider sends the browser back (the redirect address registered there). | `?code?&state?&iss?&error?` | a file | No sign-in |
| `POST /api/auth/oidc/backchannel-logout` | Where an identity provider is set up: its back-channel logout (OpenID Connect Back-Channel Logout 1.0), server to server. | `{ logout_token }` | a file | No sign-in |

## Host the editor online

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/editor-hosts` | The places the editor can be hosted, each key's status (never its value), and the hosts that can't run it with the reason. | — | `{ hosts, absent }` | Owners |
| `POST /api/editor-hosts/:hostId/connect` | With `key`: check it with the host and store it only when accepted. | `{ key?, secret? }` | `EditorHostAccount` | Owners |
| `GET /api/sites/:siteId/editor` | The site's editor online: what its settings say, what this computer created, whether it answers, its version. | — | `HostedEditorStatus` | Owners |
| `POST /api/sites/:siteId/editor/plan` | Everything that would be created, what it costs and what the install is handed. | `HostedEditorRequest` | `HostedEditorPlan` | Owners |
| `POST /api/sites/:siteId/editor` | Create the install a plan described. | `{ plan, confirm }` | `Job` | Owners |
| `POST /api/sites/:siteId/editor/setup-link` | The first-run link of an install whose setup isn't finished. | — | `{ url }` | Owners |
| `POST /api/sites/:siteId/editor/check` | own-server: the person says the files are running; check the address, hand the site over. | — | `HostedEditorStatus` | Owners |
| `POST /api/sites/:siteId/editor/upgrade` | Move the hosted editor to this version's image, keeping its disk, as a job. | — | `Job` | Owners |
| `POST /api/sites/:siteId/editor/backup` | Copy the hosted editor's disk on the host, or say where its backups are downloaded. | — | `HostedEditorBackup` | Owners |
| `GET /api/sites/:siteId/editor/removal` | What removing would delete. | — | `HostedEditorRemoval` | Owners |
| `DELETE /api/sites/:siteId/editor` | Delete exactly what was created for the hosted editor, as a job. `confirm` must be true. | `{ confirm }` | `Job` | Owners |

## Events

`GET /api/events` is a Server-Sent Events stream: a `hello` event first, then every event as `data: <json>`, and a `: heartbeat` comment every 20 seconds. Event `type`s: `hello`, `chat.delta`, `chat.tool`, `chat.message`, `chat.done`, `chat.error`, `changes.updated`, `preview.status`, `site.updated`, `repository.checked`, `sites.updated`, `job`, `plugins.updated`, `themes.updated`, `stream.limit`, `extension`, `forms.submission`. Their shapes are `ServerEvent` in [`packages/core/src/types.ts`]({repository}/blob/main/packages/core/src/types.ts). `extension` is an event of a program that [embeds the editor](/docs/running/embedding/): none is sent by Galley as it ships. `changes.updated` carries its origin: `user`, `agent`, `external`, `publish`, `discard` or `undo`. On a hosted install one account (or the operator's token) may hold 16 streams open. One more is answered with a stream that carries a single `stream.limit` event (its `message` says so in words) and ends; at most once in 10 minutes it is let in instead and the account's other streams are ended, so ones nobody reads any more give up their place. A stream whose reader stops reading is ended once 1 MB is waiting for it: connect again and read what you need afresh.

```sh
curl -sN -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/events
```

## Next

- [Security](/docs/running/security/) — what a session can do, and what a hosted install adds.
- [Environment variables](/docs/reference/environment/) — `GALLEY_TOKEN` and the rest.
