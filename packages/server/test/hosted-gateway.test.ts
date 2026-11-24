/**
 * One address is enough: a started hosted install serves its preview and
 * the live comparison through its one port, by hostname, to a signed-in
 * browser only — against the real engine, a real repository and a fake site
 * whose dev server is a tiny node http server.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { OVERLAY_SCRIPT_PATH, type CaptureSettings } from "@galley/core/api";
import { PRODUCT } from "@galley/core/brand";
import type { SetupStatus } from "@galley/core/install";
import type { PreviewStatus } from "@galley/core/types";
import { resolveConfig, StartupError } from "../src/server";
import { call, EDITOR, EDITOR_HOST, entryPath, git, LIVE_HOST, liveSite, PASSWORD, PREVIEW_HOST, sandbox, signIn, siteRepository, startHosted, upgrade, type Started } from "./hosted-helpers";

const box = sandbox("gateway-http");

afterAll(() => box.cleanup());

const VIEWER = `__Host-${PRODUCT.slug}_viewer`;
const SESSION = `__Host-${PRODUCT.slug}_session`;
const SCRIPT_TOKEN = "a-script-token-0123456789";

interface Ready {
  started: Started;
  port: number;
  siteId: string;
  site: string;
  live: { url: string; close(): Promise<void> };
}

async function readyInstall(): Promise<Ready> {
  const live = await liveSite();
  const home = box.folder("home");
  const bare = siteRepository(box, { liveUrl: live.url });
  const started = await startHosted(box, home, {
    GALLEY_PUBLIC_URL: EDITOR,
    GALLEY_PASSWORD: PASSWORD,
    GALLEY_SITE_REPOSITORY: bare,
    GALLEY_SITE_ACCESS: "token",
    GALLEY_SITE_TOKEN: "unused-for-a-folder-0000",
    GALLEY_AUTHOR_NAME: "Sam Editor",
    GALLEY_AUTHOR_EMAIL: "sam@example.com",
    GALLEY_TOKEN: SCRIPT_TOKEN,
  });

  await started.server.install!.idle();
  const siteId = started.server.install!.siteId()!;

  expect(siteId).toBeTruthy();
  return { started, port: started.port, siteId, site: started.server.install!.siteFolder(), live };
}

async function enter(ready: Ready, cookie: string): Promise<{ viewer: string; entry: { preview: string | null; baseline: string | null } }> {
  const entry = await call(ready.port, "POST", `/api/sites/${ready.siteId}/preview/entry`, { cookie });

  expect(entry.status).toBe(200);
  const answer = await call(ready.port, "GET", entryPath(entry.body.preview!, "/"), { host: PREVIEW_HOST });

  expect(answer.status).toBe(302);
  expect(answer.headers.location).toBe("/");
  const line = (answer.headers["set-cookie"] ?? [])[0]!;

  expect(line).toMatch(new RegExp(`^${VIEWER}=v1\\.`));
  expect(line).toMatch(/; Secure; HttpOnly; SameSite=None; Partitioned/);
  return { viewer: answer.cookies[0]!, entry: entry.body };
}

describe("the preview through the server's one address", () => {
  it(
    "sign in → start → entry → the page with the overlay, the live site beside it, hot reload piped; strangers and the editor's cookie are turned away",
    async () => {
      const ready = await readyInstall();
      const { port, siteId } = ready;
      const cookie = await signIn(port);

      expect(cookie.startsWith(`${SESSION}=`)).toBe(true);
      // Nothing outside the server's own listener may be opened from here on.
      const listens = vi.spyOn(net.Server.prototype, "listen");
      const started = await call<PreviewStatus>(port, "POST", `/api/sites/${siteId}/preview/start`, { cookie });

      expect(started.body).toMatchObject({ state: "ready", url: `https://${PREVIEW_HOST}`, baselineUrl: `https://${LIVE_HOST}`, baselineSource: "production" });
      expect(listens).not.toHaveBeenCalled();
      listens.mockRestore();

      // The entry route hands out one-use addresses on the gateway.
      const { viewer, entry } = await enter(ready, cookie);

      expect(entry.preview).toMatch(new RegExp(`^https://${PREVIEW_HOST.replace(/\./g, "\\.")}/.+\\?ticket=[A-Za-z0-9_-]{43}$`));
      expect(entry.baseline).toMatch(new RegExp(`^https://${LIVE_HOST.replace(/\./g, "\\.")}/.+\\?ticket=[A-Za-z0-9_-]{43}$`));

      // The page arrives through the same port, with the overlay.
      const page = await call(port, "GET", "/", { host: PREVIEW_HOST, cookie: viewer });

      expect(page.status).toBe(200);
      expect(page.text).toContain("the fake site");
      expect(page.text).toContain(OVERLAY_SCRIPT_PATH);
      expect(page.headers["x-robots-tag"]).toBe("noindex");

      // The live comparison, on its own name, let in by its own ticket.
      const liveEntry = await call(port, "GET", entryPath(entry.baseline!, "/"), { host: LIVE_HOST });
      const liveViewer = liveEntry.cookies[0]!;

      expect(liveEntry.status).toBe(302);
      expect((await call(port, "GET", "/", { host: LIVE_HOST, cookie: liveViewer })).text).toContain("the live site");

      // A ticket works once.
      const again = await call(port, "GET", entryPath(entry.preview!, "/"), { host: PREVIEW_HOST });

      expect(again.status).toBe(401);
      expect(again.cookies).toEqual([]);

      // Hot reload: a WebSocket upgrade on the preview name is piped to the dev server; without the cookie it is refused.
      expect(await upgrade(port, PREVIEW_HOST, viewer)).toEqual({ status: 101, echoed: true });
      expect((await upgrade(port, PREVIEW_HOST)).status).toBe(401);
      expect((await upgrade(port, PREVIEW_HOST, cookie)).status).toBe(401);

      // A stranger, and the editor's own session cookie sent to the preview's name, get 401 there.
      for (const presented of [undefined, cookie, `${VIEWER}=v1.0.forged.${"A".repeat(43)}`, `${VIEWER}=${cookie.split("=").slice(1).join("=")}`]) {
        const turned = await call(port, "GET", "/", { host: PREVIEW_HOST, ...(presented ? { cookie: presented } : {}) });

        expect(turned.status).toBe(401);
        expect(turned.text).toContain("Open this from the editor");
      }

      // The editor's session and the viewer cookie never reach the dev server; the site's own cookies do.
      const echo = await call(port, "GET", "/echo", { host: PREVIEW_HOST, cookie: `${viewer}; ${cookie}; theme=dark` });

      expect(echo.body.cookie).toBe("theme=dark");
      const seen = readFileSync(join(ready.site, ".seen.log"), "utf8");

      expect(seen).toContain("upgrade /hmr");
      expect(seen).not.toContain(SESSION);
      expect(seen).not.toContain(`${PRODUCT.slug}_viewer`);
      expect(seen).not.toContain(viewer.split("=")[1]!);

      // A script's token has no session: no preview entry for it.
      const scripted = await call(port, "POST", `/api/sites/${siteId}/preview/entry`, { bearer: SCRIPT_TOKEN, origin: null });

      expect(scripted.status).toBe(403);
      expect(scripted.body.error.message).toBe("A preview can only be opened from a signed-in browser, not with an access token. Sign in to the editor and open it there.");
      await ready.live.close();
    },
    180_000
  );

  it(
    "a request for a gateway name never reaches the app, whatever its path",
    async () => {
      const ready = await readyInstall();
      const cookie = await signIn(ready.port);

      for (const path of ["/", "/api/meta", "/setup", "/api/sites", "/healthz"]) {
        // Without the viewer cookie: the gateway's own page, never the app's JSON or its UI.
        for (const host of [PREVIEW_HOST, LIVE_HOST]) {
          const answer = await call(ready.port, "GET", path, { host, cookie });

          expect(answer.status, `${host}${path}`).toBe(401);
          expect(answer.headers["content-type"]).toMatch(/text\/html/);
          expect(answer.text).toContain("Open this from the editor");
          expect(answer.text).not.toContain("brand");
        }
      }
      // The entry route answers nothing while the preview isn't running.
      expect((await call(ready.port, "POST", `/api/sites/${ready.siteId}/preview/entry`, { cookie })).body).toEqual({ preview: null, baseline: null });
      await call(ready.port, "POST", `/api/sites/${ready.siteId}/preview/start`, { cookie });
      const { viewer } = await enter(ready, cookie);
      const meta = await call(ready.port, "GET", "/api/meta", { host: PREVIEW_HOST, cookie: viewer });

      // The dev server answers its own /api/meta: the app's meta (with its brand) never comes back on this name.
      expect(meta.text).not.toContain("productName");
      expect(meta.text).toContain("the fake site");
      await ready.live.close();
    },
    180_000
  );

  it(
    "the viewer cookie ends with the sign-in: signing out, signing out everywhere, a new password",
    async () => {
      const ready = await readyInstall();
      const { port, siteId } = ready;
      const first = await signIn(port);

      expect((await call<PreviewStatus>(port, "POST", `/api/sites/${siteId}/preview/start`, { cookie: first })).body.state).toBe("ready");
      const looks = async (viewer: string) => (await call(port, "GET", "/", { host: PREVIEW_HOST, cookie: viewer })).status;

      // Signing out.
      const a = await enter(ready, first);

      expect(await looks(a.viewer)).toBe(200);
      expect((await call(port, "POST", "/api/auth/logout", { cookie: first })).status).toBe(200);
      expect(await looks(a.viewer)).toBe(401);

      // Signing out everywhere.
      const second = await signIn(port);
      const b = await enter(ready, second);

      expect(await looks(b.viewer)).toBe(200);
      expect((await call(port, "POST", "/api/auth/logout-all", { cookie: second })).status).toBe(200);
      expect(await looks(b.viewer)).toBe(401);

      // A new password.
      const third = await signIn(port);
      const c = await enter(ready, third);

      expect(await looks(c.viewer)).toBe(200);
      const changed = await call(port, "POST", "/api/install/password", { cookie: third, body: { current: PASSWORD, next: "another long password" } });

      expect(changed.status).toBe(200);
      expect(await looks(c.viewer)).toBe(401);
      // The browser that changed it got a fresh session, and a fresh entry works for it.
      const d = await enter(ready, changed.cookies[0]!);

      expect(await looks(d.viewer)).toBe(200);
      await ready.live.close();
    },
    180_000
  );

  it("the editor's page lets only the two gateway origins be framed", async () => {
    const started = await startHosted(box, box.folder("home"), { GALLEY_PUBLIC_URL: EDITOR, GALLEY_PASSWORD: PASSWORD });
    const page = await call(started.port, "GET", "/", { host: EDITOR_HOST });
    const csp = String(page.headers["content-security-policy"]);

    expect(csp).toContain(`frame-src https://${PREVIEW_HOST} https://${LIVE_HOST};`);
    expect(csp).toContain("frame-ancestors 'self'");
    const none = await startHosted(box, box.folder("home"), { GALLEY_PASSWORD: PASSWORD });

    expect(String((await call(none.port, "GET", "/", { host: "anything.example" })).headers["content-security-policy"])).toContain("frame-src 'none';");
  });
});

describe("where previews are served", () => {
  it("works the two addresses out from the public address, or takes them as given", () => {
    expect(resolveConfig({ mode: "hosted", env: { GALLEY_PUBLIC_URL: "https://cms.example.com" } }).gateway).toEqual({ preview: "https://cms-preview.example.com", live: "https://cms-live.example.com" });
    expect(
      resolveConfig({ mode: "hosted", env: { GALLEY_PUBLIC_URL: "https://cms.example.com", GALLEY_PREVIEW_URL: "https://see.example.com", GALLEY_LIVE_VIEW_URL: "https://live.example.org" } }).gateway
    ).toEqual({ preview: "https://see.example.com", live: "https://live.example.org" });
    expect(resolveConfig({ mode: "hosted", previewUrl: "https://p.example.com", liveViewUrl: "https://l.example.com", env: { GALLEY_PUBLIC_URL: "https://203.0.113.9" } }).gateway).toEqual({ preview: "https://p.example.com", live: "https://l.example.com" });
    // Local mode is untouched: ports, as today.
    expect(resolveConfig({ env: { GALLEY_PREVIEW_PORTS: "4410-4429" } })).toMatchObject({ gateway: null, previewPorts: { from: 4410, to: 4429 } });
  });

  it("refuses in plain words: not a full address, another scheme, a shared hostname", () => {
    const refuse = (env: Record<string, string>) => {
      try {
        resolveConfig({ mode: "hosted", env: { GALLEY_PUBLIC_URL: "https://cms.example.com", ...env } });
      } catch (error) {
        expect(error).toBeInstanceOf(StartupError);
        return (error as Error).message;
      }
      throw new Error("not refused");
    };

    expect(refuse({ GALLEY_PREVIEW_URL: "cms-preview.example.com" })).toBe("GALLEY_PREVIEW_URL must be a full address like https://cms-preview.example.com, not “cms-preview.example.com”.");
    expect(refuse({ GALLEY_LIVE_VIEW_URL: "https://cms-live.example.com/path" })).toMatch(/^GALLEY_LIVE_VIEW_URL must be a full address like https:\/\/cms-live\.example\.com — https:\/\/ \(or http:\/\/\) and a hostname, nothing after it/);
    expect(refuse({ GALLEY_PREVIEW_URL: "ftp://cms-preview.example.com" })).toMatch(/must be a full address/);
    expect(refuse({ GALLEY_PREVIEW_URL: "http://cms-preview.example.com" })).toMatch(/GALLEY_PREVIEW_URL \(http:\/\/cms-preview\.example\.com\) must start with https:\/\/ like GALLEY_PUBLIC_URL/);
    expect(refuse({ GALLEY_PREVIEW_URL: "https://cms.example.com:8443" })).toMatch(/each need a hostname of their own/);
    expect(refuse({ GALLEY_PREVIEW_URL: "https://same.example.com", GALLEY_LIVE_VIEW_URL: "https://same.example.com" })).toMatch(/each need a hostname of their own/);
  });

  it("without an address for them the server starts, says how to give one, and ignores the preview ports", () => {
    const none = resolveConfig({ mode: "hosted", env: { GALLEY_PREVIEW_PORTS: "4410-4429" } });

    expect(none.gateway).toBeNull();
    expect(none.previewPorts).toBeNull();
    expect(none.warnings.join("\n")).toMatch(/GALLEY_PREVIEW_PORTS is ignored: a hosted install serves the preview through its one port, by hostname\./);
    expect(none.warnings.join("\n")).toMatch(/GALLEY_PUBLIC_URL isn't set.*GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL/);
    const ip = resolveConfig({ mode: "hosted", env: { GALLEY_PUBLIC_URL: "https://203.0.113.9" } });

    expect(ip.gateway).toBeNull();
    expect(ip.warnings.join("\n")).toMatch(/has no hostname the preview's addresses can be worked out from.*Set GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL/);
  });

  it(
    "without an address, starting the preview ends at once in a plain error and opens no port",
    async () => {
      const home = box.folder("home");
      const bare = siteRepository(box);
      const started = await startHosted(box, home, { GALLEY_PUBLIC_URL: "http://203.0.113.9", GALLEY_PASSWORD: PASSWORD, GALLEY_SITE_REPOSITORY: bare, GALLEY_SITE_ACCESS: "token", GALLEY_SITE_TOKEN: "unused-0000" });

      await started.server.install!.idle();
      expect(started.server.previews).toBeNull();
      expect(started.notices.join("\n")).toMatch(/GALLEY_PREVIEW_URL and GALLEY_LIVE_VIEW_URL/);
      const cookie = (await call(started.port, "POST", "/api/auth/login", { host: "203.0.113.9", origin: "http://203.0.113.9", body: { password: PASSWORD } })).cookies[0]!;
      const siteId = started.server.install!.siteId()!;
      const listens = vi.spyOn(net.Server.prototype, "listen");
      const status = await call<PreviewStatus>(started.port, "POST", `/api/sites/${siteId}/preview/start`, { host: "203.0.113.9", origin: "http://203.0.113.9", cookie });

      expect(listens).not.toHaveBeenCalled();
      listens.mockRestore();
      expect(status.body).toMatchObject({ state: "error", url: null, baselineUrl: null });
      expect(status.body.detail).toMatch(/^This editor has no address for the preview, so it can't be shown\. Whoever runs the server gives it one/);
      expect((await call(started.port, "POST", `/api/sites/${siteId}/preview/entry`, { host: "203.0.113.9", origin: "http://203.0.113.9", cookie })).body).toEqual({ preview: null, baseline: null });
      // Even the engine itself, asked directly, never opens a port for it: the preview ends in the same sentence.
      const site = await started.server.services.registry.get(siteId);
      const direct = await site!.preview().start();

      expect(direct.state).toBe("error");
      expect(direct.detail).toMatch(/no address for the preview/);
    },
    180_000
  );
});

describe("a hosted install leaves the site's files as the person left them", () => {
  it(
    "the live address lives in the install's state yet reaches the preview's baseline and the inbox; the preview's install adds no lockfile",
    async () => {
      const live = await liveSite();
      const home = box.folder("home");
      // No live address in the site's own settings, and no lockfile.
      const bare = siteRepository(box, { extra: { "package.json": `${JSON.stringify({ name: "harbour", private: true })}\n` } });
      // A package manager that writes down how it was started and leaves a lockfile unless told not to.
      const bin = box.folder("bin");
      const calls = join(bin, "calls.log");

      writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$*" >> "${calls}"\nfor a in "$@"; do [ "$a" = "--no-package-lock" ] && exit 0; done\necho '{"lockfileVersion":3}' > package-lock.json\n`);
      chmodSync(join(bin, "npm"), 0o755);
      const path = process.env.PATH;

      process.env.PATH = `${bin}:${path}`;
      try {
        const started = await startHosted(box, home, {
          GALLEY_PUBLIC_URL: EDITOR,
          GALLEY_PASSWORD: PASSWORD,
          GALLEY_SITE_REPOSITORY: bare,
          GALLEY_SITE_ACCESS: "token",
          GALLEY_SITE_TOKEN: "unused-for-a-folder-0000",
          GALLEY_AUTHOR_NAME: "Sam Editor",
          GALLEY_AUTHOR_EMAIL: "sam@example.com",
          GALLEY_SITE_LIVE_URL: live.url,
        });

        await started.server.install!.idle();
        const port = started.port;
        const siteId = started.server.install!.siteId()!;
        const site = started.server.install!.siteFolder();
        const cookie = await signIn(port);

        // Nothing written into the checkout: no unpublished change the person didn't make.
        expect(git(site, "status", "--porcelain")).toBe("");
        const setup = await call<SetupStatus>(port, "GET", "/api/setup", { cookie });

        expect(setup.body.liveUrl).toBe(live.url);
        expect(setup.body.fixed).not.toContain("liveUrl");
        const preview = await call<PreviewStatus>(port, "POST", `/api/sites/${siteId}/preview/start`, { cookie });

        expect(preview.body).toMatchObject({ state: "ready", baselineUrl: `https://${LIVE_HOST}`, baselineSource: "production" });
        expect(readFileSync(calls, "utf8")).toMatch(/^install --no-audit --no-fund --no-package-lock$/m);
        expect(existsSync(join(site, "package-lock.json"))).toBe(false);
        expect(git(site, "status", "--porcelain")).toBe("");
        // The inbox takes submissions from the live site.
        const capture = await call<CaptureSettings>(port, "GET", `/api/sites/${siteId}/capture`, { cookie });

        expect(capture.body.origins.site).toContain(live.url);
        const preflight = await call(port, "OPTIONS", `/f/${siteId}`, { origin: live.url, headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });

        expect(preflight.status).toBe(204);
        expect(preflight.headers["access-control-allow-origin"]).toBe(live.url);
        // Changed in the app: still nothing in the site's files, and every reader sees the new one.
        const changed = await call<SetupStatus>(port, "PUT", "/api/setup/details", { cookie, body: { liveUrl: "https://www.example.com" } });

        expect(changed.body.liveUrl).toBe("https://www.example.com");
        expect(git(site, "status", "--porcelain")).toBe("");
        expect((await call<CaptureSettings>(port, "GET", `/api/sites/${siteId}/capture`, { cookie })).body.origins.site).toEqual(["https://www.example.com", "https://example.com"]);
      } finally {
        process.env.PATH = path;
        await live.close();
      }
    },
    180_000
  );
});
