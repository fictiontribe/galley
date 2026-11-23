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
- **Who may call.** Three routes answer anyone: `GET /api/meta`, sign-in and sign-out (*Anyone* below). Every other route needs a session (*Signed in*): the browser's session cookie, or `Authorization: Bearer <token>`. On your own computer the token is the one in the link Galley prints (set your own with `GALLEY_TOKEN`, 16 characters or more); in hosted mode set `GALLEY_TOKEN` on the server to allow Bearer access at all. There are no roles: a session can call every route.
- **State-changing requests** (`POST`, `PUT`, `PATCH`, `DELETE`) also need the Bearer token, or a same-origin `Origin` header. Request bodies are limited to 40 MB.
- **Site routes** (`/api/sites/:siteId/…`) run with that site's own keys and author when it has them ([Look after many sites](/docs/editing/many-sites/)).
- **Errors** are `{ "error": { "code", "message", "detail"? } }` with a matching status. `message` is written for a person; `detail` carries the technical cause when it is safe to show.

| `code` | Status | Means |
| --- | --- | --- |
| `invalid` | 400 | Bad input, named: *“url” isn't right: it must be an https or ssh address.* |
| `unconfigured` | 400 | Something needs setting up first — a key, an image provider. A host refusing a key is also `unconfigured`, never 401. |
| `unauthorized` | 401 | No session, or a Bearer token that isn't valid. |
| `forbidden` | 403 | Not writable in this mode, outside the site, or a failed Host or Origin check. |
| `not-found` | 404 | No such site, entry, file, job, conversation or route. |
| `conflict` | 409 | The file changed since it was read (`baseHash`), or a name is taken. |
| `busy` | 409 (429 for sign-in) | Something is already running — a reply, a publish, too many sign-in attempts. |
| `git`, `preview`, `internal` | 500 | A git command, the preview, or something unexpected failed. |
| `ai` | 502 | The model or image provider failed. |

```sh
curl -s -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/sites
```

In the tables, *Takes* is the query (`?…`) and body; *Returns* is the response type, both named as in `api.ts`. A response of *a file* or *a stream* isn't JSON.

Two addresses outside `/api` have their own rules: `/mcp` (the [MCP endpoint](/docs/integrations/mcp/), Bearer only) and `/f/:siteId` (form submissions from the site's own pages — [Forms for developers](/docs/forms/)).

## Meta and sign-in

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/meta` | Version, brand, mode (`local` or `hosted`), whether the caller is signed in, whether the desktop app is the host. Answers without a session, with less detail. | — | `MetaInfo` | Anyone |
| `POST /api/auth/login` | Hosted mode: sign in with the shared password; sets the session cookie. Rate-limited. | `{ password }` | `Ok` | Anyone |
| `POST /api/auth/logout` | Clear and revoke the session. | — | `Ok` | Anyone |
| `GET /api/events` | The live event stream ([below](#events)). | — | a stream | Signed in |

## Settings

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/settings` | Model and effort, image and video choices, author, theme, previews, and each key's status (never its value). | — | `Settings` | Signed in |
| `PATCH /api/settings` | Change any of those. | `SettingsPatch` | `Settings` | Signed in |
| `PUT /api/secrets/:name` | Save a shared key — `anthropic`, `openai`, `google`, `cloudflare` or `vercel`; `null` removes it. Returns its status only. | `{ value }` | `SecretStatus` | Signed in |
| `GET /api/usage` | What the assistant and image generation cost at list prices: today, 7 and 30 days, all time, per model. | — | `UsageSummary` | Signed in |

## Sites

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites` | The sites in this app's list, with their group, note and what each is waiting on. | — | `SiteSummary[]` | Signed in |
| `POST /api/sites/open` | Add and open a folder (an absolute path). In hosted mode, only inside the sites folder. | `OpenSiteRequest` | `SiteDetail` | Signed in |
| `POST /api/sites/clone` | Clone a repository into the sites folder, as a job. | `CloneSiteRequest` | `Job` | Signed in |
| `POST /api/sites/create` | Create a site from a starter, as a job. | `CreateSiteRequest` | `Job` | Signed in |
| `GET /api/starters` | The starters and their looks. | — | `StarterInfo[]` | Signed in |
| `GET /api/starters/:starterId/preview` | A starter's preview image, or one of its looks' (`look`) — only images its starter.json declares. | `?look?` | a file | Signed in |
| `GET /api/jobs/:jobId` | A job's state, progress and result. | — | `Job` | Signed in |
| `GET /api/open` | A deep link from the site's own dev toolbar (`/open?root=&url=`): the site whose folder is `root`, and the entry behind `url`. | `?root&url?` | `{ state, siteId, entry } or { state, name, root }` | Signed in |
| `GET /api/fs/list` | Folders on the server's disk, for the folder picker; marks the ones that look like sites. Confined to the sites folder in hosted mode. | `?path?` | `{ path, parent, entries }` | Signed in |
| `GET /api/sites/:siteId` | The site, with its full model (detection merged with the config file). | — | `SiteDetail` | Signed in |
| `DELETE /api/sites/:siteId` | Forget the site, its own keys and author. Its files stay on disk. | — | `Ok` | Signed in |
| `POST /api/sites/:siteId/refresh` | Run detection again. | — | `SiteModel` | Signed in |
| `GET /api/sites/:siteId/config` | The site's `galley.config.json` (or `null`) and the model detection found before it. | — | `{ config, detected }` | Signed in |
| `PUT /api/sites/:siteId/config` | Replace `galley.config.json`. Validated; refused when invalid. | `{ config }` | `SiteModel` | Signed in |

## Content

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/entries` | One collection's entries: `collection` plus `search`, `status`, `sort`, `order`, `offset`, `limit`. | `?collection } & EntryQuery options` | `EntryList` | Signed in |
| `GET /api/sites/:siteId/entry` | One entry: parsed data, body, raw text, `hash`, fields and validation issues. | `?path` | `Entry` | Signed in |
| `PATCH /api/sites/:siteId/entry` | Edit an entry with [surgical operations](/docs/concepts/surgical-edits/#the-operations); `baseHash` refuses a stale edit. | `?path` `{ ops, baseHash? }` | `EditResult` | Signed in |
| `POST /api/sites/:siteId/entries` | Create an entry (optionally from a template). | `CreateEntryInput` | `Entry` | Signed in |
| `DELETE /api/sites/:siteId/entry` | Delete an entry. | `?path` | `Ok` | Signed in |
| `GET /api/sites/:siteId/search` | Search every editable string. | `?q&collection?&limit?` | `SearchHit[]` | Signed in |
| `POST /api/sites/:siteId/resolve` | Click to edit: which field holds this text on this page — `unique`, `ambiguous` or `none` ([Never guess](/docs/concepts/never-guess/)). | `ResolveRequest` | `ResolveResult` | Signed in |
| `GET /api/sites/:siteId/route` | The entry behind a page address. | `?url` | `{ entry }` | Signed in |
| `POST /api/sites/:siteId/validate` | Validate these files, or everything pending. | `{ paths? }` | `{ issues }` | Signed in |

## Forms

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `POST /api/sites/:siteId/forms/introspect` | Read the field list of an existing form on a provider's side (HubSpot, Marketo — those whose catalogue entry says `canImportFields`), so the form builder can add matching fields and their mapping in one go. | `FormIntrospectRequest` | `FormIntrospectResult` | Signed in |
| `GET /api/sites/:siteId/forms` | Every form of the site with what the forms list shows: definition, status, the pages that use it. | — | `{ forms }` | Signed in |
| `GET /api/sites/:siteId/kit` | What the site has of the site kit, and what "Set it up for me" would do. | — | `SiteKitStatus` | Signed in |
| `POST /api/sites/:siteId/kit/setup` | "Set it up for me": starts a job (kind "kit-setup") that adds the kit and wires what is unambiguous, as pending changes. | — | `Job` | Signed in |
| `POST /api/sites/:siteId/kit/visibility` | Only the step that publishes the version AI assistants can read: the kit's build step in astro.config and src/data/visibility.json (updating the kit's files when they predate it). | — | `Job` | Signed in |
| `POST /api/sites/:siteId/kit/endpoint` | Points the live site's forms at this app's inbox: writes the capture address into the kit's settings as a pending change. | — | `SiteKitStatus` | Signed in |

## Form inbox

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/inbox` | Forms with their counts; `unread` is the total for the sidebar badge. | — | `{ forms, unread }` | Signed in |
| `GET /api/sites/:siteId/inbox/:formId` | One form's submissions, newest first. | `?filter?&q?&offset?&limit?` | `SubmissionList` | Signed in |
| `GET /api/sites/:siteId/inbox/:formId/export` | The submissions as a CSV file (UTF-8 with BOM, the form's field order, labels as headers). | `?filter?` | a file | Signed in |
| `GET /api/sites/:siteId/inbox/:formId/:submissionId` | One submission in full. | — | `FormSubmission` | Signed in |
| `PATCH /api/sites/:siteId/inbox/:formId` | Mark read/unread and spam/not spam. | `{ ids, read?, spam? }` | `{ items }` | Signed in |
| `POST /api/sites/:siteId/inbox/:formId/delete` | Delete for good; the removed submissions come back so Undo can restore them. | `{ ids }` | `{ deleted }` | Signed in |
| `POST /api/sites/:siteId/inbox/:formId/restore` | Undo a delete. | `{ submissions }` | `{ restored }` | Signed in |
| `POST /api/sites/:siteId/inbox/:formId/:submissionId/retry` | Send again to one server-side destination (its index), or the e-mail notification. | `{ destination }` | `FormSubmission` | Signed in |
| `GET /api/sites/:siteId/capture` | The site's capture settings: e-mail alerts, forwarding, spam rules, whether a capture key is set. | — | `CaptureSettings` | Signed in |
| `PATCH /api/sites/:siteId/capture` | Change the capture settings. | `CaptureSettingsPatch` | `CaptureSettings` | Signed in |
| `POST /api/sites/:siteId/capture/key` | Make a new capture key (shown once, in `key`) or remove it. | `{ action }` | `{ settings, key }` | Signed in |

## Files (the source view)

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/files` | Files matching a glob (ignored folders left out). | `?glob?&limit?` | `{ files }` | Signed in |
| `GET /api/sites/:siteId/file` | One file's text and `hash`. | `?path` | `{ path, content, hash, binary }` | Signed in |
| `PUT /api/sites/:siteId/file` | Write one file; `mode` defaults to `content` ([Modes](/docs/concepts/modes/)). | `?path` `{ content, baseHash?, mode? }` | `Ok` | Signed in |

## Media

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/media` | The media library. | — | `{ items }` | Signed in |
| `POST /api/sites/:siteId/media` | Upload a file as a `data:` URL, 25 MB at most. | `{ filename, directory?, data }` | `MediaItem` | Signed in |
| `DELETE /api/sites/:siteId/media` | Delete a media file. | `?path` | `Ok` | Signed in |
| `GET /api/sites/:siteId/raw` | A file's bytes from the working tree, or from the last version with `rev=base`, for thumbnails and before/after pictures. | `?path&rev?` | a file | Signed in |

## Image generation

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/images/providers` | The image generators and whether each is ready. | — | `{ providers }` | Signed in |
| `POST /api/sites/:siteId/images/generate` | Make candidate images from a description. | `ImageGenRequest` | `{ candidates }` | Signed in |
| `GET /api/images/candidates/:candidateId` | A candidate image's bytes. | — | a file | Signed in |
| `POST /api/sites/:siteId/images/save` | Save a candidate into the site's media. | `ImageSaveRequest` | `MediaItem` | Signed in |
| `DELETE /api/images/candidates/:candidateId` | Throw a candidate image away. | — | `Ok` | Signed in |

## Video generation

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/videos/providers` | The video generators, their models, prices and whether each is ready. | — | `{ providers }` | Signed in |
| `POST /api/sites/:siteId/videos/generate` | Start making a video; progress arrives as `job` events. | `VideoGenRequest` | `Job` | Signed in |
| `GET /api/videos/jobs/:jobId` | A video generation's state and its candidates. | — | `VideoJobStatus` | Signed in |
| `GET /api/videos/candidates/:candidateId` | A candidate video's bytes. | — | a file | Signed in |
| `POST /api/sites/:siteId/videos/save` | Save a candidate video into the site's media. | `VideoSaveRequest` | `MediaItem` | Signed in |
| `DELETE /api/videos/candidates/:candidateId` | Throw a candidate video away. | — | `Ok` | Signed in |

## Plugins

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/plugins` | Built-in and installed plugins, with what each adds, its problems and its settings (secrets as status only). | — | `PluginList` | Signed in |
| `GET /api/sites/:siteId/plugins` | The same, plus the plugins this site's configuration names. | — | `PluginList` | Signed in |
| `POST /api/plugins/enabled` | Turn a plugin on or off (kept across restarts). | `{ name, enabled, siteId? }` | `PluginInfo` | Signed in |
| `PUT /api/plugins/settings` | Save some of a plugin's settings; `null` removes a value. | `{ name, values, siteId? }` | `PluginInfo` | Signed in |
| `GET /api/catalog` | Every catalogue, merged from the enabled plugins. | — | `PluginCatalog` | Signed in |
| `GET /api/sites/:siteId/catalog` | The same, with this site's own plugins included. | — | `PluginCatalog` | Signed in |
| `GET /api/sites/:siteId/data-sources/:sourceId` | A plugin's data source, for a field's picker: search it (`q`, up to `limit` — default 12, at most 50) or look up the value a file holds (`value`). | `?q?&value?&limit?` | `DataSourceAnswer` | Signed in |

## Proof and publish

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/changes` | Everything pending, per file, with field-level changes ([example](/docs/concepts/working-tree/#what-a-change-looks-like)). | — | `ChangeSet` | Signed in |
| `GET /api/sites/:siteId/diff` | One file's before and after, with hunks. | `?path` | `FileDiff` | Signed in |
| `POST /api/sites/:siteId/discard` | Discard these files' changes, or everything pending. | `{ paths? }` | `ChangeSet` | Signed in |
| `POST /api/sites/:siteId/publish` | Publish: commit (and push), or a branch and pull request ([Publishing](/docs/configuration/publishing/)). | `PublishRequest` | `PublishResult` | Signed in |
| `GET /api/sites/:siteId/history` | Published versions, newest first. | `?limit?` | `{ items }` | Signed in |
| `POST /api/sites/:siteId/revert` | Undo a publish with a new version that reverses it. | `{ commit }` | `PublishResult` | Signed in |
| `POST /api/sites/:siteId/send` | Send versions published on this computer that have not reached the remote yet. | — | `PublishResult` | Signed in |
| `GET /api/sites/:siteId/git` | Branch, remote, ahead and behind. | — | `GitStatus` | Signed in |
| `POST /api/sites/:siteId/pull` | Bring the site up to date (`git pull --ff-only`). | — | `GitStatus` | Signed in |
| `POST /api/sites/:siteId/publish/message` | Suggest a one-line note for Version history. Uses the assistant (one request) when a key is set. | `{ paths? }` | `{ message }` | Signed in |
| `POST /api/sites/:siteId/publish/check` | What the plugins' publish checks say about publishing these changes (all pending when `paths` is absent): warnings to show first, and whether one would stop the publish. | `{ paths? }` | `PublishCheck` | Signed in |

## Preview and build

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/preview` | The preview's state, addresses and log. | — | `PreviewStatus` | Signed in |
| `POST /api/sites/:siteId/preview/start` | Start the preview ([The preview](/docs/astro/preview/)). | — | `PreviewStatus` | Signed in |
| `POST /api/sites/:siteId/preview/stop` | Stop it. | — | `PreviewStatus` | Signed in |
| `POST /api/sites/:siteId/preview/restart` | Restart it. | — | `PreviewStatus` | Signed in |
| `POST /api/sites/:siteId/build` | Run the site's build and return the end of its output. | — | `BuildResult` | Signed in |

## Putting the site online

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/deploy/targets` | The hosts a site can be put online with, what setting each up needs, and whether its access key is present. | — | `{ targets }` | Signed in |
| `POST /api/deploy/targets/:targetId/connect` | Check an access key works; the accounts (Cloudflare) or teams (Vercel) it can use. | `{ key? }` | `{ accounts }` | Signed in |
| `POST /api/sites/:siteId/deploy/check` | Whether a project name can be used in that account. | `{ target, account, project }` | `DeployProjectCheck` | Signed in |
| `GET /api/sites/:siteId/deploy` | The site's deploy settings, latest deployments, the running (or last) deploy job, and how far behind the live site is. | — | `DeployStatus` | Signed in |
| `PUT /api/sites/:siteId/deploy` | Change the site's deploy settings (galley.config.json `deploy`). | `Partial<DeployConfig>` | `DeployStatus` | Signed in |
| `POST /api/sites/:siteId/deploy/live-address` | Use the live address as the site's `urls.production` (what Proof compares against). | — | `DeployStatus` | Signed in |
| `POST /api/sites/:siteId/deploy` | Start a deploy: "production" puts the published version live; "preview" puts the working tree, pending changes included, at an address of its own. | `{ kind, label? }` | `Job` | Signed in |
| `GET /api/sites/:siteId/deployments` | Deployments made from this computer, newest first. | `?limit?` | `{ items }` | Signed in |
| `POST /api/sites/:siteId/deploy/domain/plan` | What using this address as the site's own would do. | `{ hostname }` | `DomainPlan` | Signed in |
| `POST /api/sites/:siteId/deploy/domain` | Use the address (after the person said yes to the plan): attach it and wait until it answers over HTTPS. | `{ hostname }` | `Job` | Signed in |
| `POST /api/sites/:siteId/deploy/domain/check` | Look again at an address that isn't answering yet. | — | `Job` | Signed in |
| `DELETE /api/sites/:siteId/deploy/domain` | Stop using the site's own address: detached only if Galley attached it; the host's address becomes the live one again. | — | `DeployStatus` | Signed in |

## Redirects

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/redirects` | The list, its checks, where it takes effect (the host and its file), what can be imported, and the Cloudflare state. | — | `RedirectsOverview` | Signed in |
| `PUT /api/sites/:siteId/redirects` | Replace the list (inline edits, add one, delete, Undo). | `{ redirects, baseHash? }` | `RedirectsOverview` | Signed in |
| `POST /api/sites/:siteId/redirects/review` | "Add many": what a pasted list (or a file in the site, `path`) would do. | `RedirectImportBody` | `ImportReview` | Signed in |
| `POST /api/sites/:siteId/redirects/import` | Add what `review` showed, as one pending change. | `RedirectImportBody & { baseHash? }` | `{ overview, review }` | Signed in |
| `POST /api/sites/:siteId/redirects/try` | "Try an address": where a visitor ends up, through which rules. | `{ address }` | `RedirectTrace` | Signed in |
| `PUT /api/sites/:siteId/redirects/settings` | Choose the host (when the deploy settings don't say), the Cloudflare account and the site's own domains. | `{ host?, cloudflare? }` | `RedirectsOverview` | Signed in |
| `POST /api/sites/:siteId/redirects/derived/replace` | Replace a host file that was edited by hand (or was the site's own) with one written from the list. | — | `RedirectsOverview` | Signed in |
| `POST /api/sites/:siteId/redirects/leftover/remove` | Remove a redirect file this app wrote for a host the site no longer uses. | `{ path }` | `RedirectsOverview` | Signed in |
| `GET /api/sites/:siteId/redirects/export` | The list in a host's format, as a download. | `?format&hostname?` | a file | Signed in |
| `GET /api/sites/:siteId/redirects/health` | Redirects that lead nowhere now, and old addresses the site's own pages still link to. | — | `RedirectHealth` | Signed in |
| `POST /api/sites/:siteId/redirects/cloudflare/plan` | What setting them on Cloudflare would add, change and remove. | — | `CloudflarePlan` | Signed in |
| `POST /api/sites/:siteId/redirects/cloudflare/apply` | Apply a plan (refused when anything moved since). | `{ planId }` | `Job` | Signed in |
| `POST /api/sites/:siteId/redirects/cloudflare/check` | Check Cloudflare's copy matches the list. | — | `CloudflareCheck` | Signed in |
| `POST /api/sites/:siteId/redirects/cloudflare/remove` | Take this app's list and rule off Cloudflare (nothing else there is touched). | — | `RedirectsOverview` | Signed in |

## Assistant

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/threads` | The site's assistant conversations. | — | `{ threads }` | Signed in |
| `POST /api/sites/:siteId/threads` | Start a conversation. | `{ title?, mode? }` | `ChatThread` | Signed in |
| `GET /api/sites/:siteId/threads/:threadId` | One conversation, with its messages. | — | `ChatThread` | Signed in |
| `PATCH /api/sites/:siteId/threads/:threadId` | Rename a conversation. | `{ title }` | `ChatThreadSummary` | Signed in |
| `DELETE /api/sites/:siteId/threads/:threadId` | Delete a conversation. | — | `Ok` | Signed in |
| `POST /api/sites/:siteId/threads/:threadId/messages` | Send a message (text, pictures, mode, page context). The reply streams over `/api/events`. | `SendMessageRequest` | `{ turnId }` | Signed in |
| `POST /api/sites/:siteId/threads/:threadId/cancel` | Stop the reply in progress. | — | `Ok` | Signed in |
| `POST /api/sites/:siteId/threads/:threadId/undo` | Undo one assistant turn: the files it changed are put back. | `{ turnId }` | `{ restored }` | Signed in |

## Multi-site

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/groups` | Groups (clients) in the order the person arranged them. | — | `SiteGroup[]` | Signed in |
| `POST /api/groups` | Make a group. | `SiteGroupInput` | `SiteGroup` | Signed in |
| `PATCH /api/groups/:groupId` | Rename, recolour or fold a group. | `SiteGroupInput` | `SiteGroup` | Signed in |
| `DELETE /api/groups/:groupId` | Remove a group. Its sites stay in the list, ungrouped. | — | `Ok` | Signed in |
| `PUT /api/groups/order` | Put the groups in a new order (every group's id). | `{ ids }` | `SiteGroup[]` | Signed in |
| `PATCH /api/sites/:siteId/listing` | File a site: group, pin, note. | `SitePatch` | `SiteSummary` | Signed in |
| `POST /api/sites/scan` | Look for sites inside a folder (one or two levels down). | `ScanSitesRequest` | `ScanSitesResult` | Signed in |
| `POST /api/sites/scan/cancel` | Stop a scan started with that `id`. | `{ id }` | `Ok` | Signed in |
| `POST /api/sites/add` | Add several folders at once, each checked as POST /api/sites/open checks one. | `AddSitesRequest` | `AddSitesResult` | Signed in |
| `GET /api/sites/:siteId/thumbnail` | The site's own share image, for the list. | `?v?` | a file | Signed in |
| `POST /api/sites/:siteId/presence` | An editor is open on the site: its preview isn't stopped as unused. | — | `Ok` | Signed in |
| `GET /api/sites/:siteId/connections` | Which key and author each connection uses for this site. | — | `SiteConnections` | Signed in |
| `PUT /api/sites/:siteId/secrets/:name` | This site's own key; `value: null` removes it (the shared key is used again). | `{ value }` | `SiteConnections` | Signed in |
| `PUT /api/sites/:siteId/author` | This site's own publishing author; `null` removes it. | `{ author }` | `SiteConnections` | Signed in |
| `GET /api/sites/:siteId/usage` | This site's assistant use. | — | `UsageSummary` | Signed in |
| `GET /api/usage/sites` | Every site's assistant use: the last 30 days and in all. | — | `{ sites }` | Signed in |

## Search and AI checks

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/visibility` | Run the Search and AI checks. `render=off` checks the content files only; by default a running preview or an existing build is used, never started. | `?render?` | `SiteAudit` | Signed in |
| `GET /api/sites/:siteId/visibility/entry` | One entry: its result preview (an approximation) and findings, judged against the whole site. | `?path&render?` | `EntryAudit` | Signed in |
| `POST /api/sites/:siteId/visibility/fix` | Apply the deterministic fixes of these findings (ids from the last audit) as ordinary edits. | `{ ids }` | `FixResult` | Signed in |
| `POST /api/sites/:siteId/visibility/undo` | Put back every file one batch of fixes changed. | `{ undoId }` | `{ restored }` | Signed in |
| `GET /api/sites/:siteId/visibility/crawlers` | Each documented AI crawler and whether the site allows it. | — | `CrawlerReport` | Signed in |
| `PUT /api/sites/:siteId/visibility/crawlers` | Allow or block documented AI crawlers by robots.txt token; only a marked block of robots.txt changes. | `{ choices }` | `CrawlerReport` | Signed in |
| `GET /api/sites/:siteId/visibility/agent-view` | What an AI agent receives for one page: its markdown version, else its text with scripts off. | `?url` | `AgentView` | Signed in |
| `POST /api/sites/:siteId/visibility/write/plan` | What an assistant-written batch would do: the pages, and one model request per page. | `{ kind, paths? }` | `WritePlan` | Signed in |
| `POST /api/sites/:siteId/visibility/write` | Start the batch as a job; results land in Proof. | `{ kind, paths?, limit? }` | `WriteBatchStatus` | Signed in |
| `GET /api/sites/:siteId/visibility/write/:jobId` | An assistant-written batch's progress. | — | `WriteBatchStatus` | Signed in |
| `POST /api/sites/:siteId/visibility/write/:jobId/cancel` | Stop the batch; what is written stays in Proof. | — | `Ok` | Signed in |
| `POST /api/sites/:siteId/visibility/external-links` | Check links to other sites — only when asked: a few at a time, capped. | `{ limit? }` | `{ checked, total, findings }` | Signed in |
| `POST /api/sites/:siteId/import/upload` | Upload an export file, one chunk at a time (base64, at most 8 MB each, 200 MB in all). | `{ uploadId?, name, total, offset, chunk }` | `{ uploadId, received, upload }` | Signed in |
| `POST /api/sites/:siteId/import/inspect` | The quick look: is it WordPress, can its content be read, how much is there. | `{ source }` | `ImportInspection` | Signed in |
| `POST /api/sites/:siteId/import/plan` | What would come across and what wouldn't, with the questions that need a person (answered with their defaults until answered). | `{ source, answers? }` | `ImportPlanView` | Signed in |
| `POST /api/sites/:siteId/import/run` | Start bringing it over: a `Job` (kind "import"). | `{ source, answers? }` | `ImportRunStatus` | Signed in |
| `GET /api/sites/:siteId/import/runs/:runId` | An import's progress. | — | `ImportRunStatus` | Signed in |
| `POST /api/sites/:siteId/import/runs/:runId/cancel` | Stop part-way: what already arrived is kept as pending changes. | — | `ImportRunStatus` | Signed in |
| `GET /api/sites/:siteId/import/report` | The last import's report for this site, or null. | — | `{ report }` | Signed in |
| `POST /api/sites/:siteId/import/rebuild` | Open the assistant (build mode) on one page-builder page, with its prepared rebuild brief. | `{ path }` | `{ threadId, turnId }` | Signed in |
| `GET /api/sites/:siteId/import/rebuild-all` | What "Rebuild all" would do, and its estimated cost. | — | `ImportRebuildPlan` | Signed in |
| `POST /api/sites/:siteId/import/rebuild-all` | Rebuild the pages one after another, each its own conversation; a `Job` (kind "import"). | `{ paths? }` | `ImportRebuildStatus` | Signed in |
| `GET /api/sites/:siteId/import/rebuild-all/:jobId` | A Rebuild all run's progress. | — | `ImportRebuildStatus` | Signed in |
| `POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel` | Stop Rebuild all after the page in hand. | — | `ImportRebuildStatus` | Signed in |

## The site's brand

| Route | Does | Takes | Returns | Who |
| --- | --- | --- | --- | --- |
| `GET /api/sites/:siteId/brand` | The saved brand, the material, the proposal under review, the analysis in progress, and what the assistant receives. | — | `SiteBrandState` | Signed in |
| `POST /api/sites/:siteId/brand/analyse` | Read the brand: from the site (`measurements` are the overlay's `measure` answers for a few pages) or from the added material. | `{ from, measurements?, sources? }` | `Job` | Signed in |
| `POST /api/sites/:siteId/brand/cancel` | Stop reading the brand. | — | `Ok` | Signed in |
| `POST /api/sites/:siteId/brand/sources` | Add material, one chunk at a time (base64, at most 8 MB each). | `{ uploadId?, name, note?, total, offset, chunk, preview? }` | `{ uploadId, received, source }` | Signed in |
| `POST /api/sites/:siteId/brand/website` | Read a website's address as material (public https addresses only). | `{ url }` | `BrandSource` | Signed in |
| `PATCH /api/sites/:siteId/brand/sources/:sourceId` | Change a piece of material's note, or leave it out of the reading. | `{ note?, ignored? }` | `BrandSource` | Signed in |
| `DELETE /api/sites/:siteId/brand/sources/:sourceId` | Remove a piece of material. | — | `Ok` | Signed in |
| `GET /api/sites/:siteId/brand/sources/:sourceId/file` | The file (`kind=original`) or the picture the model saw (`kind=picture`). | `?kind?` | a file | Signed in |
| `PUT /api/sites/:siteId/brand/proposal` | Change the proposal (an edited brand) and answer its questions (question id → option value). | `{ brand?, answers? }` | `BrandProposal` | Signed in |
| `DELETE /api/sites/:siteId/brand/proposal` | Throw the proposal away. | — | `Ok` | Signed in |
| `POST /api/sites/:siteId/brand/ask` | Change the proposal in words; contrast is measured again afterwards. | `{ text }` | `{ proposal, reply }` | Signed in |
| `POST /api/sites/:siteId/brand/save` | Save the proposal as the brand's files: pending changes, shown in Proof. | — | `{ paths }` | Signed in |
| `GET /api/sites/:siteId/brand/apply` | What "Apply to the site" would change in the tokens file. | — | `ApplyPlan` | Signed in |
| `POST /api/sites/:siteId/brand/apply` | Write the brand's values into the site's tokens file, as pending changes. | — | `{ plan, paths }` | Signed in |
| `POST /api/sites/:siteId/brand/check` | The pending changes against the brand: suggestions, never a block. | `{ paths? }` | `{ items }` | Signed in |
| `POST /api/sites/:siteId/brand/drift` | The site re-measured against the brand. | `{ measurements }` | `DriftReport` | Signed in |
| `GET /api/sites/:siteId/brand/export` | Download: `format=brand` (the bundle) or `format=tokens` (W3C design tokens). | `?format?` | a file | Signed in |
| `POST /api/sites/:siteId/brand/import` | A bundle exported from another site, as a proposal to review. | `{ bundle }` | `BrandProposal` | Signed in |
| `GET /api/sites/:siteId/brand/fonts/:fontId` | One of the site's own web fonts, for the specimen. | — | a file | Signed in |

## Events

`GET /api/events` is a Server-Sent Events stream: a `hello` event first, then every event as `data: <json>`, and a `: heartbeat` comment every 20 seconds. Event `type`s: `hello`, `chat.delta`, `chat.tool`, `chat.message`, `chat.done`, `chat.error`, `changes.updated`, `preview.status`, `site.updated`, `sites.updated`, `job`, `plugins.updated`, `forms.submission`. Their shapes are `ServerEvent` in [`packages/core/src/types.ts`]({repository}/blob/main/packages/core/src/types.ts). `changes.updated` carries its origin: `user`, `agent`, `external`, `publish`, `discard` or `undo`.

```sh
curl -sN -H "Authorization: Bearer $GALLEY_TOKEN" http://127.0.0.1:4400/api/events
```

## Next

- [Security](/docs/running/security/) — what a session can do, and what hosted mode adds.
- [Environment variables](/docs/reference/environment/) — `GALLEY_TOKEN` and the rest.
