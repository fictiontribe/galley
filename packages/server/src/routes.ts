/**
 * Every route in `ApiRoutes`, as one map typed by the contract: a missing
 * route, an extra route, or a wrong response shape is a type error.
 */
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { ApiRouteKey, RouteResponse } from "@galley/core/api";
import { GalleyError } from "@galley/core";
import { validateConfig } from "@galley/core/content";
import { readSettings, siteNameAt } from "@galley/core/site";
import { checkPublish } from "@galley/core/plugins";
import type { ChangeSet, FileDiff, MetaInfo, SecretStatus, Settings, SiteService } from "@galley/core/types";
import { isAuthenticated, safeEqual, sessionNonce, signSession, clientAddress, SESSION_MAX_AGE_S, requestProtocol, type LoginLimiter, type SessionCheck } from "./auth";
import { decodeMediaDataUrl } from "./data-url";
import { AuthError, forbidden, invalid, notFound, RateLimitError } from "./errors";
import { eventStream } from "./events";
import { deployRoutes } from "./deploy";
import { redirectsRoutes } from "./redirects";
import { inboxRoutes } from "./forms";
import { siteKitJob, siteKitRoutes } from "./site-kit";
import { pluginRoutes } from "./plugin-routes";
import { dataSourceRoutes } from "./data-sources";
import { multiSiteRoutes } from "./multisite";
import { visibilityRoutes } from "./visibility";
import { importRoutes, importsOf } from "./import";
import { siteBrandRoutes } from "./sitebrand";
import { installRoutes } from "./install-routes";
import { accountsMeta, accountsRoutes, eventAccess, signInWithAccount, signOutThisBrowser, streamLimits } from "./accounts-routes";
import { previewEntry } from "./preview-entry";
import { hostingRoutes } from "./hosting-routes";
import { checkLookPatch, defaultLook, publicLook, themeRoutes } from "./themes-routes";
import { assertInside, listFolders, looksLikeSite, realDirectory } from "./fs-list";
import { extensionOf, isImagePath, rawContentTypeFor, UPLOAD_TYPES } from "./mime";
import type { AppOptions, Services, StreamRegistry } from "./types";
import * as v from "./validate";

/** Served with every file the API streams from a site or a generated image: nothing in it may run. */
export const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export interface RouteContext {
  services: Services;
  options: AppOptions;
  session: SessionCheck;
  limiter: LoginLimiter;
  streams: StreamRegistry;
}

type Handler<K extends ApiRouteKey> = (c: Context, ctx: RouteContext) => Promise<RouteResponse<K> | Response>;
export type RouteTable = { [K in ApiRouteKey]: Handler<K> };

const ok = { ok: true } as const;

async function siteOf(c: Context, ctx: RouteContext): Promise<SiteService> {
  const site = await ctx.services.registry.get(c.req.param("siteId") ?? "");

  if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
  return site;
}

/** Only the status fields ever leave the server — whatever the settings service returns. */
function secretStatus(status: SecretStatus): SecretStatus {
  const out: SecretStatus = { name: status.name, configured: Boolean(status.configured), source: status.source ?? null };

  if (typeof status.hint === "string") out.hint = status.hint.slice(-4);
  return out;
}

/** An error about a secret, with the secret's value cut out of everything that could be shown or logged. */
function redacted(error: unknown, secret: string): unknown {
  const scrub = (text: string | undefined) => text?.split(secret).join("[redacted]");

  if (error instanceof GalleyError) return new GalleyError(error.code, scrub(error.message)!, scrub(error.detail));
  const clean = new Error(scrub(error instanceof Error ? error.message : String(error)));

  clean.stack = scrub(error instanceof Error ? error.stack : undefined) ?? clean.stack;
  return clean;
}

function publicSettings(settings: Settings): Settings {
  return { ...settings, secrets: settings.secrets.map(secretStatus) };
}

function onlyPaths(changes: ChangeSet, paths: string[] | undefined): ChangeSet {
  if (!paths) return changes;
  const wanted = new Set(paths);
  const files = changes.files.filter((file) => wanted.has(file.path));

  return {
    ...changes,
    files,
    totals: {
      files: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
  };
}

export function rawUrl(siteId: string, path: string, base = false): string {
  return `/api/sites/${encodeURIComponent(siteId)}/raw?path=${encodeURIComponent(path)}${base ? "&rev=base" : ""}`;
}

function withMediaUrls(siteId: string, diff: FileDiff): FileDiff {
  if (!isImagePath(diff.path)) return diff;
  const out = { ...diff };

  if (diff.status !== "added") out.beforeMediaUrl = rawUrl(siteId, diff.path, true);
  if (diff.status !== "deleted") out.afterMediaUrl = rawUrl(siteId, diff.path);
  return out;
}

/** Secrets and version-history internals never leave through the file routes. */
function assertReadable(path: string): void {
  const segments = path.toLowerCase().split("/");
  const name = segments[segments.length - 1] ?? "";

  if (segments.includes(".git") || name === ".env" || name.startsWith(".env.")) throw forbidden("That file can't be shown here.");
}

function bytesResponse(data: Uint8Array | ReadableStream<Uint8Array>, type: string, length: number | null, cache: string): Response {
  const headers: Record<string, string> = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "content-security-policy": FILE_CSP,
    "cross-origin-resource-policy": "same-origin",
    "cache-control": cache,
  };

  if (length !== null) headers["content-length"] = String(length);
  return new Response(data as ConstructorParameters<typeof Response>[0], { status: 200, headers });
}

/**
 * Hosted mode keeps every site inside the sites folder. Returns the path to
 * hand the engine: relative paths are taken as relative to that folder.
 */
async function confine(ctx: RouteContext, path: string | undefined): Promise<string | undefined> {
  const root = ctx.options.confineSitesTo;

  if (!root || path === undefined) return path;
  return assertInside(root, isAbsolute(path) ? path : join(root, path), "Sites can only be kept in this server's sites folder.");
}

function setSessionCookie(c: Context, ctx: RouteContext, persistent: boolean): void {
  setCookie(c, ctx.session.cookieName, ctx.session.issue?.() ?? signSession(ctx.session.key), {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    secure: ctx.session.secure === true || requestProtocol(c, Boolean(ctx.options.trustProxy)) === "https",
    ...(persistent ? { maxAge: SESSION_MAX_AGE_S } : {}),
  });
}

export function handOffToken(c: Context, ctx: RouteContext, token: string): boolean {
  if (ctx.options.mode !== "local" || ctx.session.token === null || !safeEqual(token, ctx.session.token)) return false;
  setSessionCookie(c, ctx, false);
  return true;
}

export const routes: RouteTable = {
  // ── forms: introspection and the inbox (forms.ts) ─────────────────────
  ...inboxRoutes,

  // ── the site kit: "Set it up for me" and the forms list (site-kit.ts) ──
  ...siteKitRoutes,

  // ── putting the site online (deploy.ts) ───────────────────────────────
  ...deployRoutes,
  ...redirectsRoutes,
  ...pluginRoutes,
  ...dataSourceRoutes,

  // ── multi-site: groups, bulk add, a site's own connections (multisite.ts)
  ...multiSiteRoutes,

  // ── search & AI visibility (visibility.ts) ────────────────────────────
  ...visibilityRoutes,

  // ── bringing a WordPress site over (import.ts) ────────────────────────
  ...importRoutes,

  // ── the site's brand (sitebrand.ts) ───────────────────────────────────
  ...siteBrandRoutes,

  // ── the hosted install: first run and the Install page (install-routes.ts)
  ...installRoutes,

  // ── the hosted install: people and their accounts (accounts-routes.ts) ─
  ...accountsRoutes,

  // ── "Host the editor online" (hosting-routes.ts) ──────────────────────
  ...hostingRoutes,

  // ── themes for the app (themes-routes.ts) ─────────────────────────────
  ...themeRoutes,

  // ── meta & auth ────────────────────────────────────────────────────────
  "GET /api/meta": async (c, ctx) => {
    const { brand, mode, version, desktop } = ctx.options;
    // The UI can also present the start-up token here. When it is served by
    // another origin (a dev server proxying /api), the server never sees the
    // page URL the token arrived on, so the page hands it over itself.
    const token = new URL(c.req.url).searchParams.get("token");
    const handedOff = token !== null && handOffToken(c, ctx, token);
    const authenticated = handedOff || isAuthenticated(c, ctx.session);
    // The sign-in screen needs the brand; nothing else is told to a stranger.
    const meta: MetaInfo = authenticated
      ? { version, brand, mode, authenticated, desktop, platform: process.platform }
      : { version: "", brand, mode, authenticated, desktop: false, platform: "" };

    // A hosted install: one site, and whether first run is over (its id only to someone signed in).
    if (mode === "hosted" && ctx.options.install) meta.install = ctx.options.install.meta(authenticated);
    // A hosted install: who is signed in, and whether "Forgot your password?" can e-mail a link (accounts-routes.ts).
    if (mode === "hosted" && ctx.options.install && meta.install) {
      const { account, passwordEmail } = accountsMeta(c, ctx);

      meta.install.passwordEmail = passwordEmail;
      if (account) meta.account = account;
    }
    // The default theme, so the sign-in screen and anyone who hasn't chosen show it: colours and switches only.
    const look = await (authenticated ? defaultLook(ctx) : publicLook(ctx)).catch(() => null);

    if (look) meta.look = look;
    return meta;
  },
  "POST /api/auth/login": async (c, ctx) => {
    // A hosted install: each person's own e-mail and password (accounts-routes.ts).
    if (ctx.options.mode === "hosted" && ctx.options.install) return signInWithAccount(c, ctx);
    if (ctx.options.mode !== "hosted" || (!ctx.options.password && !ctx.session.verifyPassword)) {
      throw invalid("This app doesn't use a password here. Open the link printed when it started.");
    }
    const client = clientAddress(c, Boolean(ctx.options.trustProxy));

    if (ctx.limiter.blocked(client)) throw new RateLimitError("Too many sign-in attempts. Wait a minute, then try again.");
    const { password } = await v.body(c, v.loginBody);

    if (!(ctx.session.verifyPassword ? await ctx.session.verifyPassword(password) : safeEqual(password, ctx.options.password ?? ""))) {
      ctx.limiter.fail(client);
      throw new AuthError("That password isn't right. Check it and try again.");
    }
    ctx.limiter.succeed(client);
    setSessionCookie(c, ctx, true);
    return ok;
  },
  "POST /api/auth/logout": async (c, ctx) => {
    // A hosted install writes a sign-out down only for a session that still counts (accounts-routes.ts).
    if (ctx.options.mode === "hosted" && ctx.options.install) return signOutThisBrowser(c, ctx);
    const nonce = sessionNonce(c, ctx.session);

    if (nonce) ctx.session.revoked.add(nonce);
    deleteCookie(c, ctx.session.cookieName, { path: "/", ...(ctx.session.secure ? { secure: true } : {}) });
    return ok;
  },
  "GET /api/events": async (c, ctx) => eventStream(c, ctx.services.events, ctx.streams, ctx.options.heartbeatMs, eventAccess(c, ctx), streamLimits(c, ctx)),

  // ── settings ───────────────────────────────────────────────────────────
  "GET /api/settings": async (_c, ctx) => publicSettings(await ctx.services.settings.get()),
  "PATCH /api/settings": async (c, ctx) => {
    const patch = await v.body(c, v.settingsPatchBody);

    await checkLookPatch(ctx, patch);
    const before = patch.appearance?.look !== undefined ? (await ctx.services.settings.get()).appearance.look : undefined;
    const settings = publicSettings(await ctx.services.settings.update(patch));

    // Open browsers that follow the default theme show the new one.
    if (patch.appearance?.look !== undefined && patch.appearance.look !== before) ctx.services.events.emit({ type: "themes.updated" });
    return settings;
  },
  "PUT /api/secrets/:name": async (c, ctx) => {
    const name = c.req.param("name") ?? "";
    const parsed = v.secretName.safeParse(name);

    if (!parsed.success) throw invalid(`“${name.slice(0, 40)}” isn't a key this app stores.`);
    const { value } = await v.body(c, v.secretBody);

    try {
      return secretStatus(await ctx.services.settings.setSecret(parsed.data, value));
    } catch (error) {
      throw value ? redacted(error, value) : error;
    }
  },
  "GET /api/usage": async (_c, ctx) => ctx.services.settings.usage(),

  // ── sites ──────────────────────────────────────────────────────────────
  "GET /api/sites": async (_c, ctx) => ctx.services.registry.list(),
  "POST /api/sites/open": async (c, ctx) => {
    const request = await v.body(c, v.openSiteBody);
    const path = await realDirectory(request.path, ctx.options.confineSitesTo ?? homedir());

    await confine(ctx, path);
    const site = await ctx.services.registry.open({ path });

    return site.detail();
  },
  "POST /api/sites/clone": async (c, ctx) => {
    const request = await v.body(c, v.cloneSiteBody);
    const directory = await confine(ctx, request.directory);

    return ctx.services.registry.clone(directory === undefined ? request : { ...request, directory });
  },
  "POST /api/sites/create": async (c, ctx) => {
    const request = await v.body(c, v.createSiteBody);
    const directory = await confine(ctx, request.directory);

    return ctx.services.registry.create(directory === undefined ? request : { ...request, directory });
  },
  "GET /api/starters": async (_c, ctx) => ctx.services.registry.starters(),
  "GET /api/starters/:starterId/preview": async (c, ctx) => {
    const { look } = v.query(c, v.starterPreviewQuery);
    const file = await ctx.services.registry.starterPreview(c.req.param("starterId") ?? "", look);

    if (!file) throw notFound("That starter has no such preview picture.");
    const info = await stat(file.path);

    return bytesResponse(Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>, file.type, info.size, "private, max-age=3600");
  },
  "GET /api/jobs/:jobId": async (c, ctx) => {
    // Deploy jobs are kept by the deploy service, so a page reload mid-deploy can still ask.
    const job = ctx.services.registry.job(c.req.param("jobId") ?? "") ?? ctx.services.deploy?.job(c.req.param("jobId") ?? "") ?? ctx.services.hosting?.job(c.req.param("jobId") ?? "") ?? ctx.services.redirects?.job(c.req.param("jobId") ?? "") ?? siteKitJob(ctx.services, c.req.param("jobId") ?? "") ?? ctx.services.siteBrand?.job(c.req.param("jobId") ?? "") ?? importsOf(ctx.services).job(c.req.param("jobId") ?? "") ?? null;

    if (!job) throw notFound("That task isn't known here. It may have finished before the app restarted.");
    return job;
  },
  "GET /api/open": async (c, ctx) => {
    // Behind the session check like every API route: without one the answer is
    // 401 and nothing about `root` is looked at. Nothing is opened or added here —
    // a link can be followed by any page, so registering stays a separate,
    // Origin-checked POST the person confirms.
    const { root, url } = v.query(c, v.openQuery);

    if (!isAbsolute(root)) throw invalid("Use the folder's full location, starting from the top of the disk.");
    let real: string;

    try {
      real = await realDirectory(root, ctx.options.confineSitesTo ?? homedir());
    } catch {
      throw invalid("That folder doesn't exist, so there's no site to open there.");
    }
    if (ctx.options.confineSitesTo) await confine(ctx, real).catch(() => {
      throw invalid("That folder is outside the folders this app can open.");
    });
    if (dirname(real) === real || real === (await realpath(homedir()).catch(() => homedir())) || !looksLikeSite(real)) {
      throw invalid("That folder doesn't look like a site, so it can't be opened here.");
    }
    const sites = await ctx.services.registry.list();
    const known = await Promise.all(sites.map(async (summary) => ((await realpath(summary.root).catch(() => summary.root)) === real ? summary : null)));
    const match = known.find((summary) => summary !== null);

    if (!match) return { state: "unregistered" as const, name: await siteNameAt(real).catch(() => basename(real)), root: real };
    const site = await ctx.services.registry.get(match.id);

    if (!site) throw notFound("That site isn't open here. Open it again from the Sites screen.");
    return { state: "ready" as const, siteId: site.id, entry: url === undefined ? null : await site.entryForUrl(url) };
  },
  "GET /api/fs/list": async (c, ctx) => listFolders(ctx.options.fsRoot, v.query(c, v.fsListQuery).path),

  "GET /api/sites/:siteId": async (c, ctx) => (await siteOf(c, ctx)).detail(),
  "DELETE /api/sites/:siteId": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    await ctx.services.registry.remove(site.id);
    // The site's own keys and author leave with it; its folder and files stay.
    // The site is already out of the list, so a failure here is logged, not thrown.
    try {
      await ctx.services.settings.forgetSite?.(site.id);
    } catch (error) {
      (ctx.options.log ?? ((line: string) => process.stderr.write(`${line}\n`)))(`Couldn't forget the keys kept for a removed site: ${error instanceof Error ? error.message : String(error)}`);
    }
    return ok;
  },
  "POST /api/sites/:siteId/refresh": async (c, ctx) => (await siteOf(c, ctx)).refresh(),
  "GET /api/sites/:siteId/config": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const [{ config, hash }, detected] = await Promise.all([readSettings(site), site.detected()]);

    return { config, detected, hash };
  },
  "PUT /api/sites/:siteId/config": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const raw = await v.readJson(c);

    if (!raw || typeof raw !== "object" || !("config" in raw)) throw invalid("“config” is missing.");
    const result = validateConfig((raw as { config: unknown }).config);

    if (!result.ok) throw invalid(`The site settings have ${result.errors.length === 1 ? "a problem" : `${result.errors.length} problems`}: ${result.errors.join(" ")}`);
    const baseHash = (raw as { baseHash?: unknown }).baseHash;

    if (baseHash !== undefined && baseHash !== null && typeof baseHash !== "string") throw invalid("“baseHash” isn't text.");
    // With the version the settings were opened with, when the caller says which: a file changed since is not replaced from the older read.
    return baseHash ? site.saveConfig(result.config, { baseHash }) : site.saveConfig(result.config);
  },

  // ── content ────────────────────────────────────────────────────────────
  "GET /api/sites/:siteId/entries": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { collection, ...rest } = v.query(c, v.entriesQuery);

    return site.listEntries(collection, rest);
  },
  "GET /api/sites/:siteId/entry": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return site.readEntry(v.query(c, v.pathQuery).path);
  },
  "PATCH /api/sites/:siteId/entry": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { path } = v.query(c, v.pathQuery);
    const { ops, baseHash } = await v.body(c, v.patchEntryBody);

    return site.updateEntry(path, ops, { baseHash, origin: "user" });
  },
  "POST /api/sites/:siteId/entries": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return site.createEntry(await v.body(c, v.createEntryBody), { origin: "user" });
  },
  "DELETE /api/sites/:siteId/entry": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    await site.deleteEntry(v.query(c, v.pathQuery).path, { origin: "user" });
    return ok;
  },
  "GET /api/sites/:siteId/search": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { q, collection, limit } = v.query(c, v.searchQuery);

    return site.search(q, { collection, limit });
  },
  "POST /api/sites/:siteId/resolve": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return site.resolveText(await v.body(c, v.resolveBody));
  },
  "GET /api/sites/:siteId/route": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return { entry: await site.entryForUrl(v.query(c, v.routeQuery).url) };
  },
  "POST /api/sites/:siteId/validate": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return { issues: await site.validate((await v.body(c, v.pathsBody)).paths) };
  },

  // ── files ──────────────────────────────────────────────────────────────
  "GET /api/sites/:siteId/files": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return { files: await site.listFiles(v.query(c, v.filesQuery)) };
  },
  "GET /api/sites/:siteId/file": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { path } = v.query(c, v.pathQuery);

    assertReadable(path);
    return site.readFile(path);
  },
  "PUT /api/sites/:siteId/file": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { path } = v.query(c, v.pathQuery);
    const { content, baseHash, mode } = await v.body(c, v.writeFileBody);

    await site.writeFile(path, content, { origin: "user", mode: mode ?? "content", baseHash });
    return ok;
  },

  // ── media ──────────────────────────────────────────────────────────────
  "GET /api/sites/:siteId/media": async (c, ctx) => ({ items: await (await siteOf(c, ctx)).listMedia() }),
  "POST /api/sites/:siteId/media": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { filename, directory, data } = await v.body(c, v.uploadBody);
    const decoded = decodeMediaDataUrl(data);
    const extension = extensionOf(filename);
    const known = new Set([...Object.values(UPLOAD_TYPES), "jpeg"]);

    if (extension && !known.has(extension)) throw invalid(`“${filename}” isn't an image, MP4 video, or PDF, so it can't be added to media.`);
    const name = extension ? filename : `${filename}.${UPLOAD_TYPES[decoded.mime]}`;

    return site.saveMedia({ filename: name, directory, data: decoded.data }, { origin: "user" });
  },
  "DELETE /api/sites/:siteId/media": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { path } = v.query(c, v.pathQuery);
    const extension = extensionOf(path);

    if (!Object.values(UPLOAD_TYPES).includes(extension) && extension !== "jpeg") throw invalid("Only images, videos, and PDFs can be removed from media.");
    await site.deleteFile(path, { origin: "user", mode: "content" });
    return ok;
  },
  "GET /api/sites/:siteId/raw": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { path, rev } = v.query(c, v.rawQuery);
    const type = rawContentTypeFor(path);

    assertReadable(path);
    if (rev === "base") {
      const bytes = await site.readBase(path);

      if (!bytes) throw notFound("That file has no published version yet.");
      return bytesResponse(bytes, type, bytes.byteLength, "no-cache");
    }
    const absolute = site.resolvePath(path);
    const info = await stat(absolute).catch(() => null);

    if (!info?.isFile()) throw notFound("That file doesn't exist.");
    return bytesResponse(Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>, type, info.size, "no-cache");
  },

  // ── image generation ───────────────────────────────────────────────────
  "GET /api/images/providers": async (_c, ctx) => ({ providers: await ctx.services.images.providers() }),
  "POST /api/sites/:siteId/images/generate": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    // The site travels with the request: reference pictures are files in it.
    return { candidates: await ctx.services.images.generate(await v.body(c, v.imageGenBody), { site, siteId: site.id }) };
  },
  "GET /api/images/candidates/:candidateId": async (c, ctx) => {
    const candidate = await ctx.services.images.read(c.req.param("candidateId") ?? "");

    if (!candidate) throw notFound("That image is no longer available. Generate it again.");
    const type = /^image\/[a-z0-9.+-]+$/i.test(candidate.mime) ? candidate.mime : "application/octet-stream";

    return bytesResponse(candidate.data, type, candidate.data.byteLength, "private, max-age=3600");
  },
  "POST /api/sites/:siteId/images/save": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return ctx.services.images.save(site, await v.body(c, v.imageSaveBody), "user");
  },
  "DELETE /api/images/candidates/:candidateId": async (c, ctx) => {
    await ctx.services.images.discard(c.req.param("candidateId") ?? "");
    return ok;
  },

  // ── proof & publish ────────────────────────────────────────────────────
  "GET /api/sites/:siteId/changes": async (c, ctx) => (await siteOf(c, ctx)).changes(),
  "GET /api/sites/:siteId/diff": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return withMediaUrls(site.id, await site.diff(v.query(c, v.pathQuery).path));
  },
  "POST /api/sites/:siteId/discard": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return site.discard((await v.body(c, v.pathsBody)).paths);
  },
  "POST /api/sites/:siteId/publish": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return site.publish(await v.body(c, v.publishBody));
  },
  "GET /api/sites/:siteId/history": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return { items: await site.history(v.query(c, v.historyQuery).limit) };
  },
  "POST /api/sites/:siteId/revert": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return site.revert((await v.body(c, v.revertBody)).commit);
  },
  "POST /api/sites/:siteId/send": async (c, ctx) => (await siteOf(c, ctx)).send(),
  "GET /api/sites/:siteId/git": async (c, ctx) => (await siteOf(c, ctx)).gitStatus(),
  "POST /api/sites/:siteId/git/check": async (c, ctx) => (await siteOf(c, ctx)).checkGit(),
  "POST /api/sites/:siteId/pull": async (c, ctx) => (await siteOf(c, ctx)).pull(),
  "POST /api/sites/:siteId/publish/message": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { paths } = await v.body(c, v.pathsBody);

    return { message: await ctx.services.agent.describeChanges(site.id, onlyPaths(await site.changes(), paths)) };
  },
  "POST /api/sites/:siteId/publish/check": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { paths } = await v.body(c, v.pathsBody);

    if (!ctx.services.plugins) return { warnings: [], refusal: null };
    return checkPublish(site, ctx.services.plugins, paths ? { paths } : {});
  },

  // ── preview & build ────────────────────────────────────────────────────
  "GET /api/sites/:siteId/preview": async (c, ctx) => (await siteOf(c, ctx)).preview().status(),
  "POST /api/sites/:siteId/preview/start": async (c, ctx) => (await siteOf(c, ctx)).preview().start(),
  "POST /api/sites/:siteId/preview/stop": async (c, ctx) => {
    const preview = (await siteOf(c, ctx)).preview();

    await preview.stop();
    return preview.status();
  },
  "POST /api/sites/:siteId/preview/restart": async (c, ctx) => (await siteOf(c, ctx)).preview().restart(),
  // Local: the proxies' own addresses. Hosted: one-use entry addresses on the preview gateway (preview-entry.ts).
  "POST /api/sites/:siteId/preview/entry": async (c, ctx) => previewEntry(c, ctx, (await siteOf(c, ctx)).preview().status()),
  "POST /api/sites/:siteId/build": async (c, ctx) => (await siteOf(c, ctx)).build(),

  // ── assistant ──────────────────────────────────────────────────────────
  "GET /api/sites/:siteId/threads": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return { threads: await ctx.services.agent.listThreads(site.id) };
  },
  "POST /api/sites/:siteId/threads": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return ctx.services.agent.createThread(site.id, await v.body(c, v.createThreadBody));
  },
  "GET /api/sites/:siteId/threads/:threadId": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const thread = await ctx.services.agent.getThread(site.id, c.req.param("threadId") ?? "");

    if (!thread) throw notFound("That conversation doesn't exist. It may have been deleted.");
    return thread;
  },
  "PATCH /api/sites/:siteId/threads/:threadId": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { title } = await v.body(c, v.renameThreadBody);

    return ctx.services.agent.renameThread(site.id, c.req.param("threadId") ?? "", title);
  },
  "DELETE /api/sites/:siteId/threads/:threadId": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    await ctx.services.agent.deleteThread(site.id, c.req.param("threadId") ?? "");
    return ok;
  },
  "POST /api/sites/:siteId/threads/:threadId/messages": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    return ctx.services.agent.send(site.id, c.req.param("threadId") ?? "", await v.body(c, v.sendMessageBody));
  },
  "POST /api/sites/:siteId/threads/:threadId/cancel": async (c, ctx) => {
    const site = await siteOf(c, ctx);

    await ctx.services.agent.cancel(site.id, c.req.param("threadId") ?? "");
    return ok;
  },
  "POST /api/sites/:siteId/threads/:threadId/undo": async (c, ctx) => {
    const site = await siteOf(c, ctx);
    const { turnId } = await v.body(c, v.undoBody);

    return ctx.services.agent.undoTurn(site.id, c.req.param("threadId") ?? "", turnId);
  },
};

