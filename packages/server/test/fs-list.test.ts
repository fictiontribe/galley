import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SiteService } from "@galley/core/types";
import { fake, json, testApp } from "./helpers";

const base = realpathSync(mkdtempSync(join(tmpdir(), "galley-server-fs-")));
const root = join(base, "root");
const outside = join(base, "outside");

afterAll(() => rmSync(base, { recursive: true, force: true }));

mkdirSync(join(root, "astro-site/src/content"), { recursive: true });
mkdirSync(join(root, "hugo-site"), { recursive: true });
writeFileSync(join(root, "hugo-site/hugo.toml"), "title = 'x'\n");
mkdirSync(join(root, "Just a folder/inner"), { recursive: true });
mkdirSync(join(root, ".hidden"), { recursive: true });
mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
writeFileSync(join(root, "a-file.txt"), "not a folder");
mkdirSync(join(outside, "secret"), { recursive: true });
symlinkSync(outside, join(root, "escape"));
symlinkSync(join(root, "hugo-site"), join(root, "inside-link"));

const list = (path?: string, fsRoot = root) =>
  testApp({}, { fsRoot }).call("GET", `/api/fs/list${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`);

describe("GET /api/fs/list", () => {
  it("lists folders only, hides dot-folders and node_modules, flags sites", async () => {
    const response = await list();
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.path).toBe(root);
    expect(body.parent).toBeNull();
    expect(body.entries).toEqual([
      { name: "astro-site", path: join(root, "astro-site"), isSite: true },
      { name: "hugo-site", path: join(root, "hugo-site"), isSite: true },
      { name: "inside-link", path: join(root, "inside-link"), isSite: true },
      { name: "Just a folder", path: join(root, "Just a folder"), isSite: false },
    ]);
  });

  it("lists a subfolder with its parent", async () => {
    const body = await json(await list(join(root, "Just a folder")));

    expect(body.parent).toBe(root);
    expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual(["inner"]);
  });

  it("refuses a path outside the root", async () => {
    const response = await list(outside);

    expect(response.status).toBe(403);
    expect((await json(response)).error.code).toBe("forbidden");
    expect((await list(join(root, ".."))).status).toBe(403);
    expect((await list("/")).status).toBe(403);
  });

  it("refuses a symlink that escapes the root, and doesn't list it", async () => {
    expect((await list(join(root, "escape"))).status).toBe(403);
    expect((await list(join(root, "escape", "secret"))).status).toBe(403);
  });

  it("404s a missing folder and a file", async () => {
    expect((await list(join(root, "nope"))).status).toBe(404);
    expect((await list(join(root, "a-file.txt"))).status).toBe(404);
  });

  it("requires a session", async () => {
    expect((await testApp({}, { fsRoot: root }).raw("GET", "/api/fs/list")).status).toBe(401);
  });
});

describe("POST /api/sites/open", () => {
  const opened: string[] = [];
  const site = fake<SiteService>("site", { id: "s", detail: async () => ({ id: "s" }) as never });
  const registry = {
    open: async ({ path }: { path: string }) => {
      opened.push(path);
      return site;
    },
  };

  it("opens a real folder by its real path", async () => {
    const response = await testApp({ registry }).call("POST", "/api/sites/open", { path: join(root, "inside-link") });

    expect(response.status).toBe(200);
    expect(opened.at(-1)).toBe(join(root, "hugo-site"));
  });

  it("404s a folder that doesn't exist", async () => {
    expect((await testApp({ registry }).call("POST", "/api/sites/open", { path: join(root, "missing") })).status).toBe(404);
  });

  it("hosted mode only opens sites inside the sites folder", async () => {
    const app = testApp({ registry }, { confineSitesTo: root });

    expect((await app.call("POST", "/api/sites/open", { path: join(root, "astro-site") })).status).toBe(200);
    expect((await app.call("POST", "/api/sites/open", { path: outside })).status).toBe(403);
    expect((await app.call("POST", "/api/sites/open", { path: join(root, "escape") })).status).toBe(403);
  });

  it("hosted mode keeps clone and create targets inside the sites folder", async () => {
    const app = testApp({ registry: { clone: async () => ({ id: "j" }) as never, create: async () => ({ id: "j" }) as never } }, { confineSitesTo: root });

    expect((await app.call("POST", "/api/sites/clone", { url: "https://example.com/a.git", directory: "/etc" })).status).toBe(403);
    expect((await app.call("POST", "/api/sites/create", { name: "x", starter: "s", directory: join(root, "escape", "new") })).status).toBe(403);
    expect((await app.call("POST", "/api/sites/create", { name: "x", starter: "s", directory: join(root, "new-site") })).status).toBe(200);
  });
});

describe("hosted paths", () => {
  it("relative clone/create folders are taken inside the sites folder", async () => {
    const received: unknown[] = [];
    const app = testApp(
      { registry: { create: async (request) => (received.push(request), { id: "j" }) as never, open: async () => fake<SiteService>("site", { detail: async () => ({}) as never }) } },
      { confineSitesTo: root }
    );

    expect((await app.call("POST", "/api/sites/create", { name: "x", starter: "s", directory: "new-site" })).status).toBe(200);
    expect(received[0]).toMatchObject({ directory: join(root, "new-site") });
    expect((await app.call("POST", "/api/sites/create", { name: "x", starter: "s", directory: "../outside" })).status).toBe(403);
    expect((await app.call("POST", "/api/sites/open", { path: "astro-site" })).status).toBe(200);
  });
});

describe("GET /api/open — the dev toolbar's deep link", () => {
  const astro = join(root, "astro-site");
  const entry = { path: "src/content/pages/about.md", collection: "pages", slug: "about", title: "About", titleSource: "field", url: "/about/", status: "clean", modifiedAt: 1 };
  const opened: string[] = [];
  const asked: string[] = [];
  const site = fake<SiteService>("site", { id: "astro-1", root: astro, entryForUrl: async (url: string) => (asked.push(url), url === "/about/" ? (entry as never) : null) });
  const registry = (known: Array<{ id: string; root: string }>) => ({
    list: async () => known.map((k) => ({ ...k, name: "Known", framework: { id: "astro", name: "Astro" }, lastOpenedAt: 1, pendingChanges: 0 })),
    get: async (id: string) => (id === "astro-1" ? site : null),
    open: async (request: { path: string }) => {
      opened.push(request.path);
      return site;
    },
  });
  const ask = (query: string, known: Array<{ id: string; root: string }> = [], headers?: Record<string, string>) => {
    const app = testApp({ registry: registry(known) as never }, { fsRoot: root });

    return headers ? app.raw("GET", `/api/open?${query}`, { headers }) : app.call("GET", `/api/open?${query}`);
  };

  it("finds a registered site by its real folder and the entry behind the page", async () => {
    // Registered through a symlink: the real paths match.
    const response = await ask(`root=${encodeURIComponent(astro)}&url=${encodeURIComponent("/about/?utm=x#team")}`, [{ id: "astro-1", root: astro }]);

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ state: "ready", siteId: "astro-1", entry });
    expect(asked.at(-1)).toBe("/about/");
    const noPage = await json(await ask(`root=${encodeURIComponent(join(root, "inside-link", "..", "astro-site"))}&url=/nothing-here/`, [{ id: "astro-1", root: astro }]));

    expect(noPage).toEqual({ state: "ready", siteId: "astro-1", entry: null });
    expect(opened).toEqual([]);
  });

  it("names an unregistered site and changes nothing", async () => {
    const hugo = join(root, "inside-link");
    const body = await json(await ask(`root=${encodeURIComponent(hugo)}&url=/`));

    expect(body).toEqual({ state: "unregistered", name: "hugo-site", root: join(root, "hugo-site") });
    expect(opened).toEqual([]);
  });

  it("refuses anything that isn't a site folder with a site path, in plain words", async () => {
    for (const query of [
      `root=relative/astro-site&url=/`,
      `root=${encodeURIComponent(join(root, "missing"))}`,
      `root=${encodeURIComponent(join(root, "Just a folder"))}`,
      `root=${encodeURIComponent(join(root, "a-file.txt"))}`,
      `root=${encodeURIComponent(astro)}&url=${encodeURIComponent("https://elsewhere.example/about/")}`,
      `root=${encodeURIComponent(astro)}&url=${encodeURIComponent("//elsewhere.example/")}`,
      `root=${encodeURIComponent(astro)}&url=about`,
      `root=${encodeURIComponent(astro)}&url=${encodeURIComponent(`/${"a".repeat(2050)}`)}`,
      `url=/`,
    ]) {
      const response = await ask(query, [{ id: "astro-1", root: astro }]);

      expect(response.status, query).toBe(400);
      expect((await json(response)).error.code, query).toBe("invalid");
    }
    expect(opened).toEqual([]);
  });

  it("answers 401 unauthorized without a session, and reveals nothing about the folder", async () => {
    const response = await ask(`root=${encodeURIComponent(astro)}&url=/`, [{ id: "astro-1", root: astro }], {});
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(JSON.stringify(body)).not.toContain("astro");
  });
});
