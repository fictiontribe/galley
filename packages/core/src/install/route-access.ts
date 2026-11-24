/**
 * Who may call what on a hosted install: one level for every route.
 *
 * `Record<ApiRouteKey, …>` on purpose: a route added to the API without a
 * level here doesn't compile, so nothing is ever reachable by accident.
 * The server enforces this table (it is the only place the decision is
 * made); the web app reads the same table to hide what a person can't use.
 *
 * Local mode and the desktop app have no accounts and ignore it: one person,
 * one computer, everything allowed.
 *
 * The rule behind the levels (accounts.ts `AccessLevel`):
 *   edit    — reading, and anything that only changes the draft;
 *   publish — what changes the live site or the repository, and the inbox;
 *   manage  — the install: people, keys, settings, backups, where the site is hosted.
 */
import type { ApiRouteKey } from "../api";
import type { SiteService } from "../types";
import { roleMay, type AccessLevel, type AccountRole } from "./accounts";

/**
 * "public":  no sign-in (the answer never says anything about the install).
 * "setup":   first run — the one-time setup code until an owner exists, an owner after that.
 * "restore": putting a backup back — an owner's signed-in browser, or the setup code while there is no owner yet.
 */
export type RouteAccess = "public" | "setup" | "restore" | AccessLevel;

/**
 * What someone signed in, but without the level a route needs, is told: the
 * real server's 403, and the web app's mock's, so a screen tested against the
 * mock reads the refusal the server will really send.
 */
export const ROLE_REFUSAL = "Your account can't do that. Ask an owner of this editor.";

export const ROUTE_ACCESS: Record<ApiRouteKey, RouteAccess> = {
  // ── meta & auth ────────────────────────────────────────────────────────
  "GET /api/meta": "public",
  "POST /api/auth/login": "public",
  "POST /api/auth/logout": "public",
  "POST /api/auth/link/check": "public",
  "POST /api/auth/link": "public",
  "POST /api/auth/forgot": "public",
  "POST /api/auth/logout-all": "edit",
  "GET /api/events": "edit",

  // ── the signed-in person ───────────────────────────────────────────────
  "GET /api/account": "edit",
  "PATCH /api/account": "edit",
  "POST /api/account/password": "edit",
  /** The older name for changing your own password. */
  "POST /api/install/password": "edit",

  // ── people ─────────────────────────────────────────────────────────────
  "GET /api/people": "manage",
  "POST /api/people/invitations": "manage",
  "DELETE /api/people/invitations/:invitationId": "manage",
  "PATCH /api/people/:accountId": "manage",
  "DELETE /api/people/:accountId": "manage",
  "POST /api/people/:accountId/password-link": "manage",
  "POST /api/people/:accountId/sign-out": "manage",
  "POST /api/people/sign-out": "manage",

  // ── app-wide settings and keys ─────────────────────────────────────────
  "GET /api/settings": "edit",
  "PATCH /api/settings": "manage",
  "PUT /api/secrets/:name": "manage",
  "GET /api/usage": "manage",
  "GET /api/usage/sites": "manage",

  // ── themes for the app: everyone chooses their own (in their browser); saving one for everyone, and the default, is the install's ──
  "GET /api/themes": "edit",
  "PUT /api/themes/:themeId": "manage",
  "DELETE /api/themes/:themeId": "manage",

  // ── sites (adding, removing and filing them is refused on a hosted install anyway) ──
  "GET /api/sites": "edit",
  "POST /api/sites/open": "manage",
  "POST /api/sites/clone": "manage",
  "POST /api/sites/create": "manage",
  "POST /api/sites/scan": "manage",
  "POST /api/sites/scan/cancel": "manage",
  "POST /api/sites/add": "manage",
  "DELETE /api/sites/:siteId": "manage",
  "GET /api/groups": "edit",
  "POST /api/groups": "manage",
  "PATCH /api/groups/:groupId": "manage",
  "DELETE /api/groups/:groupId": "manage",
  "PUT /api/groups/order": "manage",
  "PATCH /api/sites/:siteId/listing": "manage",
  "GET /api/open": "manage",
  "GET /api/fs/list": "manage",
  "GET /api/starters": "edit",
  "GET /api/starters/:starterId/preview": "edit",
  "GET /api/jobs/:jobId": "edit",

  // ── the site: reading it, and its settings ─────────────────────────────
  "GET /api/sites/:siteId": "edit",
  "POST /api/sites/:siteId/refresh": "edit",
  "GET /api/sites/:siteId/config": "edit",
  // The settings change how the editor behaves for everyone at once, before any Publish.
  "PUT /api/sites/:siteId/config": "manage",
  "GET /api/sites/:siteId/thumbnail": "edit",
  "POST /api/sites/:siteId/presence": "edit",
  "GET /api/sites/:siteId/connections": "manage",
  "PUT /api/sites/:siteId/secrets/:name": "manage",
  "PUT /api/sites/:siteId/author": "manage",
  "GET /api/sites/:siteId/usage": "manage",

  // ── content, files and media: the draft ────────────────────────────────
  "GET /api/sites/:siteId/entries": "edit",
  "GET /api/sites/:siteId/entry": "edit",
  "PATCH /api/sites/:siteId/entry": "edit",
  "POST /api/sites/:siteId/entries": "edit",
  "DELETE /api/sites/:siteId/entry": "edit",
  "GET /api/sites/:siteId/search": "edit",
  "POST /api/sites/:siteId/resolve": "edit",
  "GET /api/sites/:siteId/route": "edit",
  "POST /api/sites/:siteId/validate": "edit",
  "GET /api/sites/:siteId/files": "edit",
  "GET /api/sites/:siteId/file": "edit",
  "PUT /api/sites/:siteId/file": "edit",
  "GET /api/sites/:siteId/media": "edit",
  "POST /api/sites/:siteId/media": "edit",
  "DELETE /api/sites/:siteId/media": "edit",
  // Where media is kept is the install's business: its keys, and files public at once.
  "GET /api/media-storage/connectors": "edit",
  "GET /api/sites/:siteId/media/storage": "edit",
  "POST /api/sites/:siteId/media/storage/check": "manage",
  "PUT /api/sites/:siteId/media/storage": "manage",
  "DELETE /api/sites/:siteId/media/storage": "manage",
  "POST /api/sites/:siteId/media/images/check": "manage",
  "PUT /api/sites/:siteId/media/images": "manage",
  "DELETE /api/sites/:siteId/media/images": "manage",
  "POST /api/sites/:siteId/media/storage/make-bucket": "manage",
  "DELETE /api/sites/:siteId/media/storage/made-bucket": "manage",
  "GET /api/sites/:siteId/media/usage": "edit",
  // Gone for good and possibly live: the level that changes the live site.
  "POST /api/sites/:siteId/media/storage/delete": "publish",
  "POST /api/sites/:siteId/media/storage/move/plan": "manage",
  "POST /api/sites/:siteId/media/storage/move": "manage",
  "GET /api/sites/:siteId/raw": "edit",
  "GET /api/images/providers": "edit",
  "POST /api/sites/:siteId/images/generate": "edit",
  "GET /api/images/candidates/:candidateId": "edit",
  "POST /api/sites/:siteId/images/save": "edit",
  "DELETE /api/images/candidates/:candidateId": "edit",
  "GET /api/videos/providers": "edit",
  "POST /api/sites/:siteId/videos/generate": "edit",
  "GET /api/videos/jobs/:jobId": "edit",
  "GET /api/videos/candidates/:candidateId": "edit",
  "POST /api/sites/:siteId/videos/save": "edit",
  "DELETE /api/videos/candidates/:candidateId": "edit",
  "GET /api/catalog": "edit",
  "GET /api/sites/:siteId/catalog": "edit",
  "GET /api/sites/:siteId/data-sources/:sourceId": "edit",

  // ── forms in the site (draft), and what visitors sent (the inbox) ───────
  "POST /api/sites/:siteId/forms/introspect": "edit",
  "GET /api/sites/:siteId/forms": "edit",
  "GET /api/sites/:siteId/kit": "edit",
  "POST /api/sites/:siteId/kit/setup": "edit",
  "POST /api/sites/:siteId/kit/visibility": "edit",
  "POST /api/sites/:siteId/kit/endpoint": "edit",
  "GET /api/sites/:siteId/inbox": "publish",
  "GET /api/sites/:siteId/inbox/:formId": "publish",
  "GET /api/sites/:siteId/inbox/:formId/export": "publish",
  "GET /api/sites/:siteId/inbox/:formId/:submissionId": "publish",
  "PATCH /api/sites/:siteId/inbox/:formId": "publish",
  "POST /api/sites/:siteId/inbox/:formId/delete": "publish",
  "POST /api/sites/:siteId/inbox/:formId/restore": "publish",
  "POST /api/sites/:siteId/inbox/:formId/:submissionId/retry": "publish",
  "GET /api/sites/:siteId/capture": "publish",
  // Who is told about a submission, the limits, and the keys behind them.
  "PATCH /api/sites/:siteId/capture": "manage",
  "POST /api/sites/:siteId/capture/key": "manage",

  // ── plugins ────────────────────────────────────────────────────────────
  "GET /api/plugins": "edit",
  "GET /api/sites/:siteId/plugins": "edit",
  "POST /api/plugins/enabled": "manage",
  "PUT /api/plugins/settings": "manage",

  // ── Proof and Publish ──────────────────────────────────────────────────
  "GET /api/sites/:siteId/changes": "edit",
  "GET /api/sites/:siteId/diff": "edit",
  "POST /api/sites/:siteId/discard": "edit",
  "GET /api/sites/:siteId/history": "edit",
  "GET /api/sites/:siteId/git": "edit",
  // Looking changes no file and nothing live: anyone signed in may ask what is new. Bringing it in is "pull", below.
  "POST /api/sites/:siteId/git/check": "edit",
  "POST /api/sites/:siteId/publish/check": "edit",
  "POST /api/sites/:siteId/publish/message": "publish",
  "POST /api/sites/:siteId/publish": "publish",
  "POST /api/sites/:siteId/revert": "publish",
  "POST /api/sites/:siteId/send": "publish",
  "POST /api/sites/:siteId/pull": "publish",

  // ── preview ────────────────────────────────────────────────────────────
  "GET /api/sites/:siteId/preview": "edit",
  "POST /api/sites/:siteId/preview/start": "edit",
  "POST /api/sites/:siteId/preview/stop": "edit",
  "POST /api/sites/:siteId/preview/restart": "edit",
  "POST /api/sites/:siteId/preview/entry": "edit",
  "POST /api/sites/:siteId/build": "edit",

  // ── putting the site online ────────────────────────────────────────────
  "GET /api/deploy/targets": "edit",
  "POST /api/deploy/targets/:targetId/connect": "manage",
  "GET /api/sites/:siteId/deploy": "edit",
  "PUT /api/sites/:siteId/deploy": "manage",
  "POST /api/sites/:siteId/deploy/live-address": "manage",
  "POST /api/sites/:siteId/deploy/check": "publish",
  "POST /api/sites/:siteId/deploy": "publish",
  "GET /api/sites/:siteId/deployments": "edit",
  "POST /api/sites/:siteId/deploy/domain/plan": "manage",
  "POST /api/sites/:siteId/deploy/domain": "manage",
  "POST /api/sites/:siteId/deploy/domain/check": "manage",
  "DELETE /api/sites/:siteId/deploy/domain": "manage",

  // ── redirects: the list is part of the draft; the host's copy is live ──
  "GET /api/sites/:siteId/redirects": "edit",
  "PUT /api/sites/:siteId/redirects": "edit",
  "POST /api/sites/:siteId/redirects/review": "edit",
  "POST /api/sites/:siteId/redirects/import": "edit",
  "POST /api/sites/:siteId/redirects/try": "edit",
  // Where the redirects take effect, and the host's account behind them: part of the site's settings.
  "PUT /api/sites/:siteId/redirects/settings": "manage",
  "POST /api/sites/:siteId/redirects/derived/replace": "edit",
  "POST /api/sites/:siteId/redirects/leftover/remove": "edit",
  "GET /api/sites/:siteId/redirects/export": "edit",
  "GET /api/sites/:siteId/redirects/health": "edit",
  "POST /api/sites/:siteId/redirects/cloudflare/plan": "publish",
  "POST /api/sites/:siteId/redirects/cloudflare/apply": "publish",
  "POST /api/sites/:siteId/redirects/cloudflare/check": "publish",
  "POST /api/sites/:siteId/redirects/cloudflare/remove": "publish",

  // ── the assistant ──────────────────────────────────────────────────────
  "GET /api/sites/:siteId/threads": "edit",
  "POST /api/sites/:siteId/threads": "edit",
  "GET /api/sites/:siteId/threads/:threadId": "edit",
  "PATCH /api/sites/:siteId/threads/:threadId": "edit",
  "DELETE /api/sites/:siteId/threads/:threadId": "edit",
  "POST /api/sites/:siteId/threads/:threadId/messages": "edit",
  "POST /api/sites/:siteId/threads/:threadId/cancel": "edit",
  "POST /api/sites/:siteId/threads/:threadId/undo": "edit",

  // ── being found (draft changes) ────────────────────────────────────────
  "GET /api/sites/:siteId/visibility": "edit",
  "GET /api/sites/:siteId/visibility/entry": "edit",
  "POST /api/sites/:siteId/visibility/fix": "edit",
  "POST /api/sites/:siteId/visibility/undo": "edit",
  "GET /api/sites/:siteId/visibility/crawlers": "edit",
  "PUT /api/sites/:siteId/visibility/crawlers": "edit",
  "GET /api/sites/:siteId/visibility/agent-view": "edit",
  "POST /api/sites/:siteId/visibility/write/plan": "edit",
  "POST /api/sites/:siteId/visibility/write": "edit",
  "GET /api/sites/:siteId/visibility/write/:jobId": "edit",
  "POST /api/sites/:siteId/visibility/write/:jobId/cancel": "edit",
  "POST /api/sites/:siteId/visibility/external-links": "edit",

  // ── bringing a site in (draft changes) ─────────────────────────────────
  "POST /api/sites/:siteId/import/upload": "edit",
  "POST /api/sites/:siteId/import/inspect": "edit",
  "POST /api/sites/:siteId/import/plan": "edit",
  "POST /api/sites/:siteId/import/run": "edit",
  "GET /api/sites/:siteId/import/runs/:runId": "edit",
  "POST /api/sites/:siteId/import/runs/:runId/cancel": "edit",
  "GET /api/sites/:siteId/import/report": "edit",
  "POST /api/sites/:siteId/import/rebuild": "edit",
  "GET /api/sites/:siteId/import/rebuild-all": "edit",
  "POST /api/sites/:siteId/import/rebuild-all": "edit",
  "GET /api/sites/:siteId/import/rebuild-all/:jobId": "edit",
  "POST /api/sites/:siteId/import/rebuild-all/:jobId/cancel": "edit",

  // ── the site's look (draft changes) ────────────────────────────────────
  "GET /api/sites/:siteId/brand": "edit",
  "POST /api/sites/:siteId/brand/analyse": "edit",
  "POST /api/sites/:siteId/brand/cancel": "edit",
  "POST /api/sites/:siteId/brand/sources": "edit",
  "POST /api/sites/:siteId/brand/website": "edit",
  "PATCH /api/sites/:siteId/brand/sources/:sourceId": "edit",
  "DELETE /api/sites/:siteId/brand/sources/:sourceId": "edit",
  "GET /api/sites/:siteId/brand/sources/:sourceId/file": "edit",
  "PUT /api/sites/:siteId/brand/proposal": "edit",
  "DELETE /api/sites/:siteId/brand/proposal": "edit",
  "POST /api/sites/:siteId/brand/ask": "edit",
  "POST /api/sites/:siteId/brand/save": "edit",
  "GET /api/sites/:siteId/brand/apply": "edit",
  "POST /api/sites/:siteId/brand/apply": "edit",
  "POST /api/sites/:siteId/brand/check": "edit",
  "POST /api/sites/:siteId/brand/drift": "edit",
  "GET /api/sites/:siteId/brand/export": "edit",
  "POST /api/sites/:siteId/brand/import": "edit",
  "GET /api/sites/:siteId/brand/fonts/:fontId": "edit",

  // ── first run ──────────────────────────────────────────────────────────
  "GET /api/setup": "setup",
  "POST /api/setup/password": "setup",
  "POST /api/setup/deploy-key": "setup",
  "POST /api/setup/site/check": "setup",
  "POST /api/setup/site": "setup",
  "PUT /api/setup/details": "setup",
  "POST /api/setup/handover": "setup",
  "POST /api/setup/finish": "setup",

  // ── the Install page ───────────────────────────────────────────────────
  "GET /api/install": "manage",
  "POST /api/install/backup": "manage",
  "POST /api/install/restore/upload": "restore",
  "POST /api/install/restore": "restore",

  // ── "Host the editor online" (not there at all on a hosted install) ────
  "GET /api/editor-hosts": "manage",
  "POST /api/editor-hosts/:hostId/connect": "manage",
  "GET /api/sites/:siteId/editor": "manage",
  "POST /api/sites/:siteId/editor/plan": "manage",
  "POST /api/sites/:siteId/editor": "manage",
  "POST /api/sites/:siteId/editor/setup-link": "manage",
  "POST /api/sites/:siteId/editor/check": "manage",
  "POST /api/sites/:siteId/editor/upgrade": "manage",
  "POST /api/sites/:siteId/editor/backup": "manage",
  "GET /api/sites/:siteId/editor/removal": "manage",
  "DELETE /api/sites/:siteId/editor": "manage",
};

/**
 * Two things a route's level can't express, because they depend on what a
 * request asks for and not on which route it is. The engine holds every way
 * in to them — a route, the assistant's tools, a plugin's tools — and the
 * app reads them to decide what to offer:
 *  - writing outside the site's content ("build" mode: templates, code, the
 *    files the site is built from) needs BUILD_MODE_LEVEL;
 *  - the site's settings file needs SITE_SETTINGS_LEVEL, whichever way it is
 *    written. It holds the commands this server runs and where the site goes.
 */
export const BUILD_MODE_LEVEL: AccessLevel = "publish";
export const SITE_SETTINGS_LEVEL: AccessLevel = "manage";

/**
 * Said when someone below BUILD_MODE_LEVEL would undo a reply made in build
 * mode: by the engine on refusing it, and by the app in the Undo button's
 * place, so nobody is offered an undo that would be refused.
 */
export const UNDO_BUILD_REFUSAL = "Your account can't undo this reply: it changed the site's code and templates (build mode). Ask an owner or an editor of this editor.";

/**
 * The site's own methods (SiteService) that need more than "edit", each by
 * the route that reaches it, so a method and its route can't disagree. The
 * engine checks these itself, whoever calls — a route, the assistant's
 * tools, an MCP tool, a plugin — against the person whose request it is
 * (install/caller.ts). Writing the settings file and build mode are checked
 * where the write happens, at the two levels above.
 */
export const SITE_METHOD_ACCESS = {
  publish: "POST /api/sites/:siteId/publish",
  revert: "POST /api/sites/:siteId/revert",
  send: "POST /api/sites/:siteId/send",
  pull: "POST /api/sites/:siteId/pull",
  // A hosted editor's own round brings versions in as Get latest does, so it needs what Get latest needs: the engine's mark (install/caller.ts asEngine).
  catchUp: "POST /api/sites/:siteId/pull",
} as const satisfies Partial<Record<keyof SiteService, ApiRouteKey>>;

export type GuardedSiteMethod = keyof typeof SITE_METHOD_ACCESS;

/**
 * The settings file's bookkeeping the engine itself does inside actions
 * below SITE_SETTINGS_LEVEL, each at the level of the route whose action it
 * is: giving the redirects list its default place (saving the list), where
 * the redirects apply (the redirects screen), and the address a production
 * deploy reports back. Each writes only its own keys, through the engine's
 * internal path (site/settings-records.ts) — never what a caller sends for
 * the rest of the file. Every other change to the file needs SITE_SETTINGS_LEVEL.
 */
export const SITE_SETTINGS_RECORDS = {
  "redirects-list": "PUT /api/sites/:siteId/redirects",
  "redirects-host": "PUT /api/sites/:siteId/redirects/settings",
  "deploy-address": "POST /api/sites/:siteId/deploy",
} as const satisfies Record<string, ApiRouteKey>;

/** The level one of the site's guarded methods needs. */
export function siteMethodLevel(method: GuardedSiteMethod): AccessLevel {
  return levelFor(SITE_METHOD_ACCESS[method]) ?? "edit";
}

/** The level a signed-in person needs for a route: "setup" and "restore" are an owner's once an owner exists. */
export function levelFor(route: ApiRouteKey): AccessLevel | null {
  const access = ROUTE_ACCESS[route];

  if (access === "public") return null;
  return access === "setup" || access === "restore" ? "manage" : access;
}

/** Whether a person with this role may call a route. */
export function roleMayCall(role: AccountRole, route: ApiRouteKey): boolean {
  const level = levelFor(route);

  return level === null || roleMay(role, level);
}
