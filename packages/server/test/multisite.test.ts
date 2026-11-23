/**
 * Multi-site over HTTP, against the real engine: add sites from a folder,
 * group and pin them, a site's own keys and author (which never come back),
 * thumbnails, presence, and the site scope every site route runs in.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentSiteId } from "@galley/core/site";
import type { AddSitesResult, ScanSitesResult, SiteConnections, SiteGroup, SiteSummary } from "@galley/core/types";
import { startServer } from "../src/server";
import type { RunningServer } from "../src/types";
import { json, SITE_ID, testApp } from "./helpers";

const starter = fileURLToPath(new URL("../../../starters/astro-starter", import.meta.url));
const KEY = "sk-ant-api03-clientclientclientclient0000CLNT";

describe("multi-site over HTTP", () => {
  let tmp = "";
  let server: RunningServer;

  async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T; text: string; headers: Headers }> {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${server.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = null;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed as T, text, headers: response.headers };
  }

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), "galley-multi-http-")));
    for (const name of ["north-studio", "harbour-bakery"]) {
      const site = join(tmp, "clients", name);

      cpSync(starter, site, { recursive: true, filter: (source) => !["node_modules", ".astro", "dist"].includes(basename(source)) });
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: site });
      execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "add", "-A"], { cwd: site });
      execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "First"], { cwd: site });
    }
    mkdirSync(join(tmp, "clients", "node_modules", "not-this"), { recursive: true });
    writeFileSync(join(tmp, "clients", "node_modules", "not-this", "astro.config.mjs"), "");
    server = await startServer({ port: 0, home: join(tmp, "home"), webDir: join(tmp, "no-ui"), env: { PATH: process.env.PATH, HOME: tmp }, notice: () => {} });
  });

  afterAll(async () => {
    await server?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("finds and adds the sites in a folder without opening them, then files them", async () => {
    const scan = await api<ScanSitesResult>("POST", "/api/sites/scan", { path: join(tmp, "clients"), id: "scan-test-1" });

    expect(scan.status).toBe(200);
    expect(scan.body.sites.map((site) => basename(site.path))).toEqual(["harbour-bakery", "north-studio"]);
    expect(scan.body.sites.every((site) => site.framework.id === "astro" && !site.known)).toBe(true);
    const group = await api<SiteGroup>("POST", "/api/groups", { name: "Harbour clients", color: "sky" });

    expect(group.body).toMatchObject({ name: "Harbour clients", color: "sky", collapsed: false });
    const added = await api<AddSitesResult>("POST", "/api/sites/add", { paths: [...scan.body.sites.map((site) => site.path), "/no/such/folder"], group: group.body.id });

    expect(added.body.added).toHaveLength(2);
    expect(added.body.skipped).toEqual([{ path: "/no/such/folder", reason: "That folder doesn't exist." }]);
    const [first] = added.body.added;
    const listed = await api<SiteSummary>("PATCH", `/api/sites/${first!.id}/listing`, { pinned: true, note: "Launch in March" });

    expect(listed.body).toMatchObject({ pinned: true, note: "Launch in March", group: group.body.id });
    const sites = await api<SiteSummary[]>("GET", "/api/sites");

    expect(sites.body.map((site) => site.lastOpenedAt)).toEqual([0, 0]);
    expect((await api("PATCH", `/api/sites/${first!.id}/listing`, { group: "g-missing" })).status).toBe(404);
    // The rest of the group routes: list, rename, order, remove (its sites stay, ungrouped).
    const second = await api<SiteGroup>("POST", "/api/groups", { name: "Second" });
    expect((await api<SiteGroup>("PATCH", `/api/groups/${group.body.id}`, { name: "Harbourside", collapsed: true })).body).toMatchObject({ name: "Harbourside", collapsed: true });
    expect((await api<SiteGroup[]>("PUT", "/api/groups/order", { ids: [second.body.id, group.body.id] })).body.map((g) => g.name)).toEqual(["Second", "Harbourside"]);
    expect((await api<SiteGroup[]>("GET", "/api/groups")).body.map((g) => g.id)).toEqual([second.body.id, group.body.id]);
    expect((await api("DELETE", `/api/groups/${second.body.id}`)).status).toBe(200);
    expect((await api("DELETE", "/api/groups/g-missing")).status).toBe(404);
    expect((await api("POST", "/api/sites/scan", { path: "relative" })).status).toBe(404);
    expect((await api("POST", "/api/sites/scan/cancel", { id: "scan-test-1" })).status).toBe(200);
  });

  it("keeps a site's own key and author, and never sends a key back", async () => {
    const sites = (await api<SiteSummary[]>("GET", "/api/sites")).body;
    const id = sites[0]!.id;
    const put = await api<SiteConnections>("PUT", `/api/sites/${id}/secrets/anthropic`, { value: KEY });

    expect(put.status).toBe(200);
    expect(put.text).not.toContain("clientclient");
    expect(put.body.secrets.find((secret) => secret.name === "anthropic")).toMatchObject({ inUse: "site", hint: "CLNT", site: { configured: true, hint: "CLNT" } });
    const read = await api<SiteConnections>("GET", `/api/sites/${id}/connections`);

    expect(read.text).not.toContain("clientclient");
    // The app's own Settings still show the shared key (none).
    const shared = await api<{ secrets: Array<{ name: string; configured: boolean }> }>("GET", "/api/settings");

    expect(shared.body.secrets.find((secret) => secret.name === "anthropic")?.configured).toBe(false);
    expect(shared.text).not.toContain("clientclient");
    // A bad key is refused without echoing it.
    const bad = await api<{ error: { message: string } }>("PUT", `/api/sites/${id}/secrets/anthropic`, { value: "sk-ant-not a key at all" });

    expect(bad.status).toBe(400);
    expect(bad.text).not.toContain("not a key at all");
    expect((await api("PUT", `/api/sites/${id}/secrets/nope`, { value: KEY })).status).toBe(400);
    expect((await api("PUT", "/api/sites/unknown1234/secrets/anthropic", { value: KEY })).status).toBe(404);
    const author = await api<SiteConnections>("PUT", `/api/sites/${id}/author`, { author: { name: "Client Writer", email: "writer@client.example" } });

    expect(author.body.author).toMatchObject({ name: "Client Writer", inUse: "site" });
    expect((await api<{ last30: { turns: number } }>("GET", `/api/sites/${id}/usage`)).body.last30.turns).toBe(0);
    expect((await api<{ sites: unknown[] }>("GET", "/api/usage/sites")).body.sites).toEqual([]);
    // Removing the site from the list forgets its own key and author (its files stay).
    expect((await api("DELETE", `/api/sites/${id}`)).status).toBe(200);
    expect((await api("GET", `/api/sites/${id}/connections`)).status).toBe(404);
  });

  it("serves a site's own share image as a sandboxed file once its facts are read", async () => {
    const sites = (await api<SiteSummary[]>("GET", "/api/sites")).body;
    let withThumb: SiteSummary | undefined;

    for (let i = 0; i < 100 && !withThumb; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      withThumb = (await api<SiteSummary[]>("GET", "/api/sites")).body.find((site) => site.thumbnailUrl);
    }
    expect(withThumb?.facts).toMatchObject({ pendingChanges: 0, unsent: 0, unread: 0 });
    const image = await fetch(`${server.url}${withThumb!.thumbnailUrl}`, { headers: { authorization: `Bearer ${server.token}` } });

    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-security-policy")).toContain("sandbox");
    expect((await api("POST", `/api/sites/${sites[0]!.id}/presence`)).status).toBe(200);
  });
});

describe("the site scope", () => {
  it("runs every /api/sites/:siteId route inside its site's scope, and nothing else", async () => {
    const seen: Array<string | null> = [];
    const { call } = testApp({
      registry: { list: async () => [{ id: SITE_ID } as SiteSummary] },
      settings: {
        siteConnections: async (siteId) => {
          seen.push(currentSiteId());
          return { siteId, secrets: [], author: { name: "", email: "", inUse: "shared", site: null } };
        },
        get: async () => {
          seen.push(currentSiteId());
          return { secrets: [] } as never;
        },
      },
    });

    expect((await call("GET", `/api/sites/${SITE_ID}/connections`)).status).toBe(200);
    expect((await json(await call("GET", "/api/settings"))).secrets).toEqual([]);
    expect(seen).toEqual([SITE_ID, null]);
  });
});
